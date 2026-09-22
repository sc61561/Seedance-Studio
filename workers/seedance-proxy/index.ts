import { readSeedanceApiKey } from "../../src/lib/security/api-key-core";
import { apiError } from "../../src/lib/video/errors";
import { errorForResponse, VideoProviderError } from "../../src/lib/video/providers/seedance-core";
import { maxWorkerRequestBytes, workerUploadContentType } from "../../src/lib/video/worker-upload";
import { prepareUpload } from "./upload-stream";

export type WorkerEnv = {
  ALLOWED_ORIGINS: string;
  GENERATION_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> };
};
const upstreamUrl = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

async function readUpstream(response: Response): Promise<Record<string, unknown> | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 64 * 1024) return undefined;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => undefined); }
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const origin = request.headers.get("origin");
    const allowed = Boolean(origin && origin !== "null" && env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).includes(origin));
    const headers = new Headers({ "cache-control": "no-store", Vary: "Origin" });
    if (allowed) headers.set("access-control-allow-origin", origin!);
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (!allowed) return json(apiError("api.workerOriginDenied"), 403);
    const url = new URL(request.url);
    if (url.pathname !== "/api/generate" || url.search) return json(apiError("api.invalidRequest"), 404);
    if (request.method === "OPTIONS") {
      const requested = request.headers.get("access-control-request-headers")?.toLowerCase().split(",").map((s) => s.trim()) ?? [];
      if (request.headers.get("access-control-request-method") !== "POST"
        || requested.some((s) => !["content-type", "x-seedance-api-key"].includes(s))) return json(apiError("api.invalidRequest"), 403);
      headers.set("access-control-allow-methods", "POST");
      headers.set("access-control-allow-headers", "content-type,x-seedance-api-key");
      headers.set("access-control-max-age", "600");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return json(apiError("api.invalidRequest"), 405);
    const key = readSeedanceApiKey(request);
    if (!key.ok) return json(apiError(key.code), key.code === "api.apiKeyRequired" ? 401 : 400);
    if (!env.GENERATION_LIMITER) return json(apiError("api.workerUnavailable"), 503);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 120_000);
    let upload: Awaited<ReturnType<typeof prepareUpload>> | undefined;
    try {
      const limit = await env.GENERATION_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
      if (!limit.success) {
        headers.set("retry-after", "60");
        return json(apiError("api.rateLimited"), 429);
      }
      if (request.headers.get("content-type")?.split(";")[0] !== workerUploadContentType || !request.body) return json(apiError("api.invalidRequest"), 400);
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxWorkerRequestBytes)) return json(apiError("api.requestTooLarge"), 413);
      upload = await prepareUpload(request.body, controller.signal);
      // Cloudflare requires FixedLengthStream to emit Content-Length. Node tests
      // use the original stream; production does not rely on chunked uploads.
      const FixedStream = (globalThis as unknown as {
        FixedLengthStream?: new (length: number) => ReadableWritablePair<Uint8Array, Uint8Array>;
      }).FixedLengthStream;
      const fixed = FixedStream ? new FixedStream(upload.byteLength) : undefined;
      const pumping = fixed ? upload.stream.pipeTo(fixed.writable, { signal: controller.signal }) : undefined;
      void pumping?.catch(() => undefined);
      const response = await fetch(upstreamUrl, {
        method: "POST", body: fixed?.readable ?? upload.stream,
        headers: { Authorization: `Bearer ${key.apiKey}`, "content-type": "application/json" },
        redirect: "manual", signal: controller.signal, duplex: "half",
      } as RequestInit & { duplex: "half" });
      // workerd does not implement redirect: "error". Reject 3xx explicitly;
      // never forward the user's Authorization header to a redirected host.
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new VideoProviderError("api.providerConnectFailed");
      }
      const payload = await readUpstream(response);
      if (!response.ok) throw errorForResponse(response, payload, key.apiKey);
      await pumping;
      if (!upload.complete()) throw new VideoProviderError("api.createFailed");
      const id = payload?.id;
      if (typeof id !== "string" || !/^cgt-[A-Za-z0-9_-]{1,120}$/.test(id) || id.includes(key.apiKey)) throw new VideoProviderError("api.createFailed");
      return json({ taskId: id });
    } catch (caught) {
      const error = upload?.error() ?? caught;
      if (error instanceof VideoProviderError) {
        const params = error.code === "api.refTooLargeSingle" ? { n: 15 }
          : error.code === "api.refTooLargeTotal" ? { n: 45 } : error.params;
        return json(apiError(error.code, params, error.detail, error.requestId), error.statusCode);
      }
      return json(apiError("api.workerUnavailable"), 502);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
      controller.abort();
      await upload?.cancel();
    }
  },
};

export default worker;
