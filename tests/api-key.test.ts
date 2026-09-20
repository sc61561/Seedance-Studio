import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as generate } from "@/app/api/generate/route";
import { GET as getTask } from "@/app/api/task/[id]/route";
import {
  maxSeedanceApiKeyLength,
  readSeedanceApiKey,
  seedanceApiKeyHeader,
} from "@/lib/security/api-key";

const requestWithKey = (url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set(seedanceApiKeyHeader, "ark-request-key");
  return new Request(url, { ...init, headers });
};

describe("Seedance BYOK request key", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires a non-empty request header", () => {
    const missing = readSeedanceApiKey(new Request("http://localhost"));
    const blank = readSeedanceApiKey(new Request("http://localhost", {
      headers: { [seedanceApiKeyHeader]: "   " },
    }));

    expect(missing).toEqual({ ok: false, code: "api.apiKeyRequired" });
    expect(blank).toEqual({ ok: false, code: "api.apiKeyRequired" });
  });

  it("trims a valid key but rejects control characters and oversized values", () => {
    expect(readSeedanceApiKey(new Request("http://localhost", {
      headers: { [seedanceApiKeyHeader]: "  ark-valid-key  " },
    }))).toEqual({ ok: true, apiKey: "ark-valid-key" });

    expect(readSeedanceApiKey(new Request("http://localhost", {
      headers: { [seedanceApiKeyHeader]: "ark-key\u007f" },
    }))).toEqual({ ok: false, code: "api.apiKeyInvalid" });

    expect(readSeedanceApiKey(new Request("http://localhost", {
      headers: { [seedanceApiKeyHeader]: `ark-${"x".repeat(maxSeedanceApiKeyLength)}` },
    }))).toEqual({ ok: false, code: "api.apiKeyInvalid" });
  });

  it("passes the current user's key to the generate provider request", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "cgt-byok" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await generate(requestWithKey("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "一只猫在窗边打盹" }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ark-request-key",
        }),
      }),
    );
    const requestInit = (fetchMock.mock.calls[0] as unknown as [unknown, RequestInit] | undefined)?.[1];
    expect(String(requestInit?.body)).not.toContain("ark-request-key");
  });

  it("passes the current user's key to task polling", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      id: "cgt-byok",
      status: "queued",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTask(
      requestWithKey("http://localhost/api/task/cgt-byok"),
      { params: Promise.resolve({ id: "cgt-byok" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-byok",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ark-request-key",
        }),
      }),
    );
  });

  it("rejects generation before contacting the provider when the key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await generate(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "测试" }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "api.apiKeyRequired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
