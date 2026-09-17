import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { AuthGateState } from "@/lib/auth/types";

export const sessionCookieName = "seedance_session";
export const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

type AuthConfiguration =
  | { mode: "disabled" }
  | { mode: "unconfigured" }
  | { mode: "required"; password: string; secret: string };

export function getAuthConfiguration(): AuthConfiguration {
  const password = process.env.APP_ACCESS_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (password && secret) {
    return { mode: "required", password, secret };
  }

  if (!password && !secret && process.env.NODE_ENV !== "production") {
    return { mode: "disabled" };
  }

  return { mode: "unconfigured" };
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1_000) + sessionMaxAgeSeconds;
  const payload = Buffer.from(`v1:${expiresAt}`).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !secret) return false;

  const [payload, signature] = parts;
  if (!constantTimeEqual(signature, sign(payload, secret))) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return false;
  }

  const match = /^v1:(\d+)$/.exec(decoded);
  if (!match) return false;

  const expiresAt = Number(match[1]) * 1_000;
  const remaining = expiresAt - now;
  return Number.isSafeInteger(expiresAt) && remaining > 0 && remaining <= sessionMaxAgeSeconds * 1_000;
}

export function passwordMatches(candidate: string, expected: string): boolean {
  return constantTimeEqual(hash(candidate), hash(expected));
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== sessionCookieName) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function serializeSessionCookie(token: string): string {
  return [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    `Max-Age=${sessionMaxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function serializeClearedSessionCookie(): string {
  return [
    `${sessionCookieName}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function resolveAuthGateState(cookieValue?: string): AuthGateState {
  const config = getAuthConfiguration();
  if (config.mode === "disabled") return "disabled";
  if (config.mode === "unconfigured") return "unconfigured";
  return cookieValue && verifySessionToken(cookieValue, config.secret)
    ? "authenticated"
    : "unauthenticated";
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
