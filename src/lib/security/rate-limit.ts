import "server-only";

import { isIP } from "node:net";

import { apiError } from "@/lib/video/errors";

type RateLimitOptions = {
  minuteLimit: number;
  hourLimit: number;
  maxKeys: number;
};

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;

export class InMemoryRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly options: RateLimitOptions) {}

  get size(): number {
    return this.attempts.size;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    this.pruneExpired(now);
    const timestamps = (this.attempts.get(key) ?? []).filter((value) => value > now - hourMs);
    const minuteAttempts = timestamps.filter((value) => value > now - minuteMs);

    if (timestamps.length >= this.options.hourLimit) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntil(timestamps[0] + hourMs, now),
      };
    }

    if (minuteAttempts.length >= this.options.minuteLimit) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntil(minuteAttempts[0] + minuteMs, now),
      };
    }

    timestamps.push(now);
    this.attempts.delete(key);
    this.attempts.set(key, timestamps);
    this.enforceKeyBound();
    return { allowed: true };
  }

  private pruneExpired(now: number) {
    for (const [key, values] of this.attempts) {
      const active = values.filter((value) => value > now - hourMs);
      if (active.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, active);
    }
  }

  private enforceKeyBound() {
    while (this.attempts.size > this.options.maxKeys) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.attempts.delete(oldestKey);
    }
  }
}

// MVP-only protection. Each serverless instance owns its own bucket; distributed
// deployments should replace this with a shared store when stronger guarantees are needed.
const generationLimiter = new InMemoryRateLimiter({
  minuteLimit: 3,
  hourLimit: 20,
  maxKeys: 5_000,
});

export function getClientIp(request: Request): string {
  const candidates = [
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-vercel-forwarded-for"),
    request.headers.get("x-real-ip"),
    request.headers.get("cf-connecting-ip"),
  ];

  for (const candidateList of candidates) {
    for (const candidate of candidateList?.split(",") ?? []) {
      const value = candidate.trim();
      if (isIP(value)) return value;
    }
  }

  return "unknown";
}

export function enforceGenerationRateLimit(request: Request): Response | null {
  const result = generationLimiter.consume(getClientIp(request));
  if (result.allowed) return null;

  return Response.json(apiError("api.rateLimited"), {
    status: 429,
    headers: { "Retry-After": String(result.retryAfterSeconds) },
  });
}

function secondsUntil(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1_000));
}
