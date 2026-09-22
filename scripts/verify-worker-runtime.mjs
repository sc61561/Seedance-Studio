// Runs the deployed bundle in Cloudflare's local workerd runtime. The ONLY
// outbound service is a local Ark stub: no real API keys, video jobs or charges.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

// Use the exact Miniflare version shipped with our pinned Wrangler CLI.
const requireWrangler = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = requireWrangler("miniflare");

test("workerd: 15 MiB original data, fixed-length upstream, CORS and native rate limiting", async () => {
  const origin = "https://studio.example.com";
  const apiKey = "local-test-key-no-real-account";
  const bytes = Buffer.alloc(15 * 1024 * 1024, 0x42);
  Buffer.from("iVBORw0KGgo=", "base64").copy(bytes);
  const base64 = bytes.toString("base64");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  let upstreamCalls = 0;
  let upstreamFailure;
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: "seedance-runtime-test", modules: true, host: "127.0.0.1", port: 0,
    compatibilityDate: "2026-09-22", cf: false,
    log: new Log(LogLevel.NONE),
    scriptPath: resolve("workers/seedance-proxy/.wrangler/seedance-proxy/index.js"),
    bindings: { ALLOWED_ORIGINS: origin },
    ratelimits: { GENERATION_LIMITER: { namespace_id: "1001", simple: { limit: 3, period: 60 } } },
    outboundService: async (request) => {
      try {
      upstreamCalls++;
      assert.equal(request.url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
      assert.equal(request.headers.get("authorization"), `Bearer ${apiKey}`);
      const raw = await request.text();
      assert.equal(Number(request.headers.get("content-length")), Buffer.byteLength(raw));
      assert.equal(raw.includes(apiKey), false);
      const body = JSON.parse(raw);
      assert.equal(body.generate_audio, false);
      if (upstreamCalls === 1) {
        assert.equal(hash(body.content[1].image_url.url), hash(`data:image/png;base64,${base64}`));
        return new Response(JSON.stringify({ id: "cgt-runtime-test" }), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { code: "Unknown", message: `Bearer ${apiKey}` } }), { status: 400, headers: { "content-type": "application/json" } });
      } catch (error) { upstreamFailure = error; throw error; }
    },
  }));
  const metadata = {
    version: 1, prompt: "测试原图", model: "doubao-seedance-2-5-260628", generationMode: "reference",
    duration: 5, resolution: "720p", aspectRatio: "16:9", generateAudio: false,
    images: [{ mimeType: "image/png", byteLength: bytes.length }],
  };
  const send = (body, overrideHeaders = {}) => mf.dispatchFetch("https://upload.example.com/api/generate", {
    method: "POST", body,
    headers: { Origin: origin, "content-type": "application/x-seedance-upload", "x-seedance-api-key": apiKey, ...overrideHeaders },
  });
  try {
    const response = await send(new Blob([JSON.stringify(metadata), "\n", base64]));
    if (upstreamFailure) throw upstreamFailure;
    if (response.status !== 200) assert.fail(`Worker returned ${response.status}: ${await response.text()}; upstream calls: ${upstreamCalls}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { taskId: "cgt-runtime-test" });
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const invalid = await send(JSON.stringify({ ...metadata, duration: 100 }) + "\n");
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "api.durationInvalid");
    assert.equal(upstreamCalls, 1);

    const rejected = await send("ignored", { Origin: "https://other.example.com" });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    await rejected.text();

    const small = JSON.stringify({ ...metadata, images: [{ mimeType: "image/png", byteLength: 8 }] }) + "\niVBORw0KGgo=";
    const upstreamError = await send(small);
    assert.equal(upstreamError.status, 400);
    assert.equal((await upstreamError.text()).includes(apiKey), false);
    const limited = await send(small);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "api.rateLimited");
    assert.equal(upstreamCalls, 2);
  } finally {
    await mf.dispose();
  }
});
