import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";

const loginRequest = (body: unknown, ip?: string) =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify(body),
  });

describe("password auth routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets a signed HttpOnly session cookie for the configured password", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct horse battery staple");
    vi.stubEnv("SESSION_SECRET", "server-only-session-secret");
    vi.stubEnv("NODE_ENV", "production");

    const response = await login(loginRequest({ password: "correct horse battery staple" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^seedance_session=[A-Za-z0-9._-]+;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("correct horse battery staple");
    expect(cookie).not.toContain("server-only-session-secret");
  });

  it("rejects a wrong password without setting a cookie", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "expected-password");
    vi.stubEnv("SESSION_SECRET", "server-only-session-secret");

    const response = await login(loginRequest({ password: "wrong-password" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "api.invalidPassword" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("treats the configured password as an exact value", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "  spaced password  ");
    vi.stubEnv("SESSION_SECRET", "server-only-session-secret");

    const response = await login(loginRequest({ password: "  spaced password  " }));

    expect(response.status).toBe(200);
  });

  it("returns stable errors for malformed and missing passwords", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "expected-password");
    vi.stubEnv("SESSION_SECRET", "server-only-session-secret");

    const malformed = await login(new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: "not-json",
    }));
    const missing = await login(loginRequest({}));

    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ code: "api.invalidRequest" });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ code: "api.passwordRequired" });
  });

  it("fails closed when production auth credentials are not configured", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    const response = await login(loginRequest({ password: "anything" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.authNotConfigured" });
  });

  it("rate limits login attempts without revealing whether the next password is correct", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "expected-password");
    vi.stubEnv("SESSION_SECRET", "server-only-session-secret");
    const ip = "198.51.100.77";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(loginRequest({ password: "wrong-password" }, ip));
      expect(response.status).toBe(401);
    }

    const blockedCorrectPassword = await login(loginRequest({ password: "expected-password" }, ip));

    expect(blockedCorrectPassword.status).toBe(429);
    await expect(blockedCorrectPassword.json()).resolves.toEqual({ code: "api.rateLimited" });
    expect(Number(blockedCorrectPassword.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blockedCorrectPassword.headers.get("set-cookie")).toBeNull();
  });

  it("clears the session cookie idempotently", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await logout();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("seedance_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });
});
