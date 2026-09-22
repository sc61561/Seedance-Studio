import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type WorkerEnv } from "../workers/seedance-proxy/index";
import { buildWorkerUpload, getWorkerOrigin } from "@/lib/video/worker-upload";

const origin = "https://studio.example.com";
const key = "test-user-key-never-log";
const png = "iVBORw0KGgo=";
const metadata = {
  prompt: "猫在窗边", model: "doubao-seedance-2-5-260628",
  generationMode: "reference", generateAudio: false,
  duration: 5, resolution: "720p", aspectRatio: "16:9",
};
const environment = (): WorkerEnv => ({
  ALLOWED_ORIGINS: origin,
  GENERATION_LIMITER: { limit: async () => ({ success: true }) },
});

function uploadRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://upload.example.com/api/generate", {
    method: "POST", body,
    headers: {
      Origin: origin, "content-type": "application/x-seedance-upload",
      "x-seedance-api-key": key, "cf-connecting-ip": "192.0.2.1", ...headers,
    },
  });
}

function wireBody(base64 = png, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1, ...metadata,
    images: [{ mimeType: "image/png", byteLength: 8 }], ...overrides,
  }) + "\n" + base64;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("large image browser transport", () => {
  it("accepts only an explicit HTTPS origin, preventing URLs with credentials, paths or query data", () => {
    expect(getWorkerOrigin("https://upload.example.com/")).toBe("https://upload.example.com");
    for (const value of ["", "http://upload.example.com", "https://a:b@upload.example.com", "https://upload.example.com/path", "https://upload.example.com?key=secret", "javascript:alert(1)"]) {
      expect(getWorkerOrigin(value)).toBeUndefined();
    }
  });

  it("keeps API keys out of the streamed body and preserves native image order", async () => {
    const result = buildWorkerUpload({ ...metadata, generationMode: "first-last",
      aspectRatio: "adaptive", referenceImageDataUrls: [`data:image/png;base64,${png}`, `data:image/png;base64,${png}`],
    });
    const text = await result.text();
    const [head, images] = text.split("\n");
    expect(JSON.parse(head)).toMatchObject({ generationMode: "first-last", images: [
      { mimeType: "image/png", byteLength: 8 }, { mimeType: "image/png", byteLength: 8 },
    ] });
    expect(images).toBe(png + png);
    expect(text).not.toContain(key);
  });
});

describe("Worker generate endpoint", () => {
  it("handles metadata and Base64 split across arbitrary single-byte chunks", async () => {
    const bytes = new TextEncoder().encode(wireBody());
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
        else controller.close();
      },
    });
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      const sent = await new Response(init.body).json();
      expect(sent.content[1].image_url.url).toBe(`data:image/png;base64,${png}`);
      return Response.json({ id: "cgt-split" });
    });
    const req = new Request("https://upload.example.com/api/generate", {
      method: "POST", body: stream, duplex: "half",
      headers: { Origin: origin, "content-type": "application/x-seedance-upload", "x-seedance-api-key": key },
    } as RequestInit & { duplex: "half" });
    expect((await worker.fetch(req, environment())).status).toBe(200);
  });

  it("cancels a stalled metadata upload when the user aborts", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const req = new Request("https://upload.example.com/api/generate", {
      method: "POST", body: stream, duplex: "half", signal: controller.signal,
      headers: { Origin: origin, "content-type": "application/x-seedance-upload", "x-seedance-api-key": key },
    } as RequestInit & { duplex: "half" });
    const pending = worker.fetch(req, environment());
    setTimeout(() => controller.abort(), 5);
    expect((await pending).ok).toBe(false);
    expect(cancelled).toBe(true);
  }, 1000);

  it("never reports success if an upstream response arrives without consuming the validated upload", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ id: "cgt-premature" }));
    expect((await worker.fetch(uploadRequest(wireBody()), environment())).status).toBe(502);
  });

  it("streams a 15 MiB image without changing bytes, keeping the current task response contract", async () => {
    const bytes = Buffer.alloc(15 * 1024 * 1024, 0x42);
    Buffer.from(png, "base64").copy(bytes);
    const encoded = bytes.toString("base64");
    let actual: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
      expect(init.body).toBeInstanceOf(ReadableStream);
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${key}`);
      actual = await new Response(init.body).json();
      return Response.json({ id: "cgt-large-test" });
    });
    const body = buildWorkerUpload({ ...metadata, referenceImageDataUrls: [`data:image/png;base64,${encoded}`] });
    const response = await worker.fetch(uploadRequest(body), environment());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ taskId: "cgt-large-test" });
    expect(actual).toMatchObject({ model: metadata.model, duration: 5, generate_audio: false,
      content: [{ type: "text", text: metadata.prompt }, { type: "image_url", role: "reference_image", image_url: { url: `data:image/png;base64,${encoded}` } }],
    });
    expect(actual).not.toHaveProperty("generationMode");
  });

  it("validates native first/last roles and maps audio false", async () => {
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      sent = await new Response(init.body).json();
      return Response.json({ id: "cgt-native" });
    });
    const body = buildWorkerUpload({ ...metadata, generationMode: "first-last", aspectRatio: "adaptive",
      referenceImageDataUrls: [`data:image/png;base64,${png}`, `data:image/png;base64,${png}`],
    });
    expect((await worker.fetch(uploadRequest(body), environment())).status).toBe(200);
    expect(sent).toMatchObject({ ratio: "adaptive", generate_audio: false, content: [
      { type: "text" }, { role: "first_frame" }, { role: "last_frame" },
    ] });
  });

  it.each([
    [{ model: "not-an-allowed-model" }, "api.modelUnsupported"],
    [{ duration: 100 }, "api.durationInvalid"],
    [{ modelProfile: "doubao-seedance-2-0-260128" }, "api.modelProfileConflict"],
    [{ generationMode: "first-last", aspectRatio: "adaptive" }, "api.referenceCountInvalid"],
    [{ generateAudio: "false" }, "api.generateAudioInvalid"],
    [{ images: [{ mimeType: "image/png", byteLength: 15 * 1024 * 1024 + 1 }] }, "api.refTooLargeSingle"],
    [{ images: Array.from({ length: 4 }, () => ({ mimeType: "image/png", byteLength: 15 * 1024 * 1024 })) }, "api.refTooLargeTotal"],
  ])("rejects invalid metadata before making an upstream request: %j", async (overrides, code) => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(uploadRequest(wireBody(png, overrides)), environment());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["iVBORw0KGg!=", "iVBORw0KGgo", "iVBORw0KGgo=extra", "iVBORw0KGgp=", 'iVBORw0K\"},', "AAAAAAAAAAA="])("rejects malformed, truncated, noncanonical and injected image data", async (encoded) => {
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      await new Response(init.body).text();
      return Response.json({ id: "must-not-succeed" });
    });
    const response = await worker.fetch(uploadRequest(wireBody(encoded)), environment());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: expect.stringMatching(/^api\.refInvalid/) });
  });

  it("rejects other origins, missing keys, missing limiter and exhausted quota", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(uploadRequest(wireBody(), { Origin: "https://evil.example" }), environment())).status).toBe(403);
    expect((await worker.fetch(uploadRequest(wireBody(), { "x-seedance-api-key": "" }), environment())).status).toBe(401);
    expect((await worker.fetch(uploadRequest(wireBody()), { ALLOWED_ORIGINS: origin })).status).toBe(503);
    const limited = await worker.fetch(uploadRequest(wireBody()), {
      ...environment(), GENERATION_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("supports only the declared CORS preflight, never arbitrary routes or methods", async () => {
    const response = await worker.fetch(new Request("https://upload.example.com/api/generate", {
      method: "OPTIONS", headers: { Origin: origin, "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-seedance-api-key" },
    }), environment());
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect((await worker.fetch(new Request("https://upload.example.com/other", { headers: { Origin: origin } }), environment())).status).toBe(404);
  });

  it("bounds metadata and declared size before reading image bytes", async () => {
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    expect((await worker.fetch(uploadRequest("x".repeat(20_000)), environment())).status).toBe(413);
    expect((await worker.fetch(uploadRequest(wireBody(), { "content-length": "90000000" }), environment())).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns the product image count in the limit error", async () => {
    const response = await worker.fetch(uploadRequest(wireBody(png, {
      images: Array.from({ length: 11 }, () => ({ mimeType: "image/png", byteLength: 8 })),
    })), environment());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "api.refTooMany", params: { n: 10 } });
  });

  it("redacts upstream key echoes and rejects redirects without following them", async () => {
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      await new Response(init.body).text();
      return Response.json({ error: { code: "Unknown", message: `Authorization: Bearer ${key} data:image/png;base64,${png}` } }, { status: 400 });
    });
    const response = await worker.fetch(uploadRequest(wireBody()), environment());
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(key);
    expect(text).not.toContain(png);
  });

  it("maps an upstream redirect to a safe error without exposing or following its location", async () => {
    const upstream = vi.fn(async (_: string, init: RequestInit) => {
      await new Response(init.body).text();
      return new Response(null, { status: 302, headers: { Location: `https://other.example.com/${key}` } });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(uploadRequest(wireBody()), environment());
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain(key);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
