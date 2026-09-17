import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  sessionMaxAgeSeconds,
  verifySessionToken,
} from "@/lib/auth/session";

describe("signed auth session", () => {
  const secret = "a-test-secret-that-never-leaves-the-server";
  const now = Date.UTC(2026, 8, 17, 0, 0, 0);

  it("accepts an untampered token inside its bounded lifetime", () => {
    const token = createSessionToken(secret, now);

    expect(verifySessionToken(token, secret, now + 1_000)).toBe(true);
    expect(verifySessionToken(token, secret, now + sessionMaxAgeSeconds * 1_000 - 1)).toBe(true);
  });

  it("rejects tampered, malformed, expired, and wrong-secret tokens", () => {
    const token = createSessionToken(secret, now);
    const [payload, signature] = token.split(".");

    expect(verifySessionToken(`${payload}.${signature.slice(0, -1)}x`, secret, now)).toBe(false);
    expect(verifySessionToken("not-a-session", secret, now)).toBe(false);
    expect(verifySessionToken(token, "another-secret", now)).toBe(false);
    expect(verifySessionToken(token, secret, now + sessionMaxAgeSeconds * 1_000)).toBe(false);
  });
});
