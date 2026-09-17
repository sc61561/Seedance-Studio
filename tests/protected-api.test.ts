import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as generate } from "@/app/api/generate/route";
import { GET as getTask } from "@/app/api/task/[id]/route";
import { POST as upload } from "@/app/api/upload/route";
import { createSessionToken, sessionCookieName } from "@/lib/auth/session";

const configuredPassword = "access-password";
const configuredSecret = "server-only-session-secret";

function configureAuth() {
  vi.stubEnv("APP_ACCESS_PASSWORD", configuredPassword);
  vi.stubEnv("SESSION_SECRET", configuredSecret);
}

function authenticatedHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("cookie", `${sessionCookieName}=${createSessionToken(configuredSecret)}`);
  return headers;
}

describe("protected API routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated upload, generate, and task requests", async () => {
    configureAuth();

    const generateResponse = await generate(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "测试" }),
    }));
    const uploadResponse = await upload(new Request("http://localhost/api/upload", {
      method: "POST",
      body: new FormData(),
    }));
    const taskResponse = await getTask(new Request("http://localhost/api/task/cgt-1"), {
      params: Promise.resolve({ id: "cgt-1" }),
    });

    for (const response of [generateResponse, uploadResponse, taskResponse]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ code: "api.unauthorized" });
    }
  });

  it("rejects malformed cookies but preserves normal validation after valid auth", async () => {
    configureAuth();

    const malformed = await generate(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${sessionCookieName}=malformed.token`,
      },
      body: JSON.stringify({ prompt: "测试" }),
    }));
    const authenticated = await generate(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: authenticatedHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ prompt: "   " }),
    }));

    expect(malformed.status).toBe(401);
    await expect(malformed.json()).resolves.toEqual({ code: "api.unauthorized" });
    expect(authenticated.status).toBe(400);
    await expect(authenticated.json()).resolves.toEqual({ code: "api.promptRequired" });
  });

  it("allows local development without auth env vars but fails closed in production", async () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");

    const localResponse = await generate(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    }));

    vi.stubEnv("NODE_ENV", "production");
    const productionResponse = await generate(new Request("https://example.com/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    }));

    expect(localResponse.status).toBe(400);
    await expect(localResponse.json()).resolves.toEqual({ code: "api.promptRequired" });
    expect(productionResponse.status).toBe(503);
    await expect(productionResponse.json()).resolves.toEqual({ code: "api.authNotConfigured" });
  });

  it("rate limits repeated authenticated generation attempts", async () => {
    configureAuth();
    const request = () => new Request("http://localhost/api/generate", {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json",
        "x-vercel-forwarded-for": "203.0.113.99",
      }),
      body: JSON.stringify({ prompt: "生成一段海边日落视频" }),
    });

    const responses = await Promise.all([
      generate(request()),
      generate(request()),
      generate(request()),
    ]);
    const blocked = await generate(request());

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({ code: "api.rateLimited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rate limits authenticated image uploads before parsing repeated multipart bodies", async () => {
    configureAuth();
    const request = () => new Request("http://localhost/api/upload", {
      method: "POST",
      headers: authenticatedHeaders({ "x-forwarded-for": "203.0.113.88" }),
      body: new FormData(),
    });

    // One generation can upload 10 references; leave room for a full retry set.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await upload(request());
      expect(response.status).toBe(400);
    }

    const blocked = await upload(request());
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({ code: "api.rateLimited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
