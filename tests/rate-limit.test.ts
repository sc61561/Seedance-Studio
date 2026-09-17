import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter, getClientIp } from "@/lib/security/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("enforces both minute and hour windows and reports a bounded retry delay", () => {
    const limiter = new InMemoryRateLimiter({ minuteLimit: 2, hourLimit: 3, maxKeys: 10 });
    const start = Date.UTC(2026, 8, 17, 0, 0, 0);

    expect(limiter.consume("203.0.113.10", start)).toEqual({ allowed: true });
    expect(limiter.consume("203.0.113.10", start + 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("203.0.113.10", start + 2_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 58,
    });
    expect(limiter.consume("203.0.113.10", start + 60_000)).toEqual({ allowed: true });
    expect(limiter.consume("203.0.113.10", start + 61_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 3_539,
    });
    expect(limiter.consume("203.0.113.10", start + 3_600_000)).toEqual({ allowed: true });
  });

  it("bounds tracked client keys", () => {
    const limiter = new InMemoryRateLimiter({ minuteLimit: 2, hourLimit: 3, maxKeys: 2 });

    limiter.consume("203.0.113.1", 0);
    limiter.consume("203.0.113.2", 1);
    limiter.consume("203.0.113.3", 2);

    expect(limiter.size).toBe(2);
  });
});

describe("getClientIp", () => {
  it("prefers the standard proxy address and falls back through platform headers", () => {
    expect(getClientIp(new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "198.51.100.3",
        "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1",
      },
    }))).toBe("198.51.100.3");

    expect(getClientIp(new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "not-an-ip",
        "x-vercel-forwarded-for": "198.51.100.8, 10.0.0.2",
      },
    }))).toBe("198.51.100.8");

    expect(getClientIp(new Request("http://localhost", {
      headers: { "x-real-ip": "2001:db8::4" },
    }))).toBe("2001:db8::4");
  });

  it("uses a stable anonymous bucket when no valid address exists", () => {
    expect(getClientIp(new Request("http://localhost", {
      headers: { "x-forwarded-for": "garbage" },
    }))).toBe("unknown");
  });
});
