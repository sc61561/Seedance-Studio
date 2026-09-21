import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/generate/route";

const officialModels = {
  seedance25: "doubao-seedance-2-5-260628",
  seedance20: "doubao-seedance-2-0-260128",
  fast20: "doubao-seedance-2-0-fast-260128",
  mini20: "doubao-seedance-2-0-mini-260615",
} as const;

const pngDataUrl = "data:image/png;base64,iVBORw0KGgo=";
const encoder = new TextEncoder();
let requestSequence = 0;

function nextIp(): string {
  requestSequence += 1;
  return `198.18.${Math.floor(requestSequence / 250)}.${(requestSequence % 250) + 1}`;
}

function requestFor(
  body: unknown,
  { ip = nextIp() }: { ip?: string } = {},
): Request {
  return rawRequest(JSON.stringify(body), ip);
}

function rawRequest(body: string, ip = nextIp()): Request {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-seedance-api-key": "test-request-key",
      "x-forwarded-for": ip,
    },
    body,
  });
}

function byteRequest(
  body: Uint8Array,
  {
    contentLength,
    ip = nextIp(),
  }: { contentLength?: string; ip?: string } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-seedance-api-key": "test-request-key",
    "x-forwarded-for": ip,
  });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  const bodyBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(bodyBuffer).set(body);

  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers,
    body: bodyBuffer,
  });
}

function streamRequest(
  body: ReadableStream<Uint8Array>,
  ip = nextIp(),
): Request {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-seedance-api-key": "test-request-key",
      "x-forwarded-for": ip,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function jsonBytesWithUtf8Length(byteLength: number): Uint8Array {
  const prefix = encoder.encode('{"prompt":"中","padding":"');
  const suffix = encoder.encode('"}');
  const paddingLength = byteLength - prefix.byteLength - suffix.byteLength;
  if (paddingLength < 0) throw new Error("target body is too small");

  const body = new Uint8Array(byteLength);
  body.set(prefix, 0);
  body.fill("a".charCodeAt(0), prefix.byteLength, prefix.byteLength + paddingLength);
  body.set(suffix, prefix.byteLength + paddingLength);
  return body;
}

async function expectApiError(
  body: unknown,
  expected: Record<string, unknown>,
  status = 400,
): Promise<void> {
  const response = await POST(requestFor(body));
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(expected);
}

describe("POST /api/generate", () => {
  const fetchMock = vi.fn<(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>>(async () => Response.json({ id: "cgt-test" }));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("拒绝非对象 JSON、空提示词和超过 4000 字符的最终提示词", async () => {
    await expectApiError([], { code: "api.invalidRequest" });
    await expectApiError({ prompt: "   " }, { code: "api.promptRequired" });
    await expectApiError(
      { prompt: "a".repeat(4_001) },
      { code: "api.promptTooLong", params: { n: 4000 } },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [officialModels.seedance25, 4, 30],
    [officialModels.seedance20, 4, 15],
    [officialModels.fast20, 4, 15],
    [officialModels.mini20, 4, 15],
  ])("%s 接受 profile 的时长边界 %i..%i", async (model, min, max) => {
    expect((await POST(requestFor({ prompt: "视频", model, duration: min }))).status).toBe(200);
    expect((await POST(requestFor({ prompt: "视频", model, duration: max }))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [officialModels.seedance25, 4, 30],
    [officialModels.seedance20, 4, 15],
    [officialModels.fast20, 4, 15],
    [officialModels.mini20, 4, 15],
  ])("%s 拒绝 profile 时长边界外和非整数", async (model, min, max) => {
    for (const duration of [min - 1, max + 1, 4.5]) {
      await expectApiError(
        { prompt: "视频", model, duration },
        { code: "api.durationInvalid", params: { min, max } },
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [officialModels.seedance25, ["480p", "720p", "1080p"]],
    [officialModels.seedance20, ["480p", "720p", "1080p", "4k"]],
    [officialModels.fast20, ["480p", "720p"]],
    [officialModels.mini20, ["480p", "720p"]],
  ])("%s 只接受 registry 声明的分辨率", async (model, accepted) => {
    for (const resolution of accepted) {
      expect((await POST(requestFor({ prompt: "视频", model, resolution }))).status).toBe(200);
    }

    for (const resolution of ["480p", "720p", "1080p", "4k", "1440p"].filter(
      (candidate) => !accepted.includes(candidate),
    )) {
      await expectApiError(
        { prompt: "视频", model, resolution },
        { code: "api.resolutionUnsupportedByModel" },
      );
    }
  });

  it.each(Object.values(officialModels))("%s 接受 registry 的 21:9 和 adaptive", async (model) => {
    for (const aspectRatio of ["21:9", "adaptive"]) {
      expect((await POST(requestFor({ prompt: "视频", model, aspectRatio }))).status).toBe(200);
    }
  });

  it.each([
    [officialModels.seedance25, 10],
    [officialModels.seedance20, 9],
    [officialModels.fast20, 9],
    [officialModels.mini20, 9],
  ])("%s 对普通参考图使用 profile 与产品共同上限 %i", async (model, cap) => {
    const atCap = await POST(requestFor({
      prompt: "视频",
      model,
      referenceImageUrls: Array.from({ length: cap }, (_, index) => `https://example.com/${index}.png`),
    }));
    expect(atCap.status).toBe(200);

    for (const count of new Set([cap + 1, 11])) {
      await expectApiError(
        {
          prompt: "视频",
          model,
          referenceImageUrls: Array.from({ length: count }, (_, index) => `https://example.com/${index}.png`),
        },
        { code: "api.refTooMany", params: { n: cap } },
      );
    }
  });

  it.each([
    [officialModels.seedance25, 10],
    [officialModels.seedance20, 9],
    [officialModels.fast20, 9],
    [officialModels.mini20, 9],
  ])("Data URL 数组对 %s 使用相同的有效上限 %i", async (model, cap) => {
    const accepted = await POST(requestFor({
      prompt: "视频",
      model,
      referenceImageDataUrls: Array.from({ length: cap }, () => pngDataUrl),
    }));
    expect(accepted.status).toBe(200);

    for (const count of new Set([cap + 1, 11])) {
      const rejected = await POST(requestFor({
        prompt: "视频",
        model,
        referenceImageDataUrls: Array.from({ length: count }, () => pngDataUrl),
      }));
      expect(rejected.status).toBe(400);
      await expect(rejected.json()).resolves.toEqual({
        code: "api.refTooMany",
        params: { n: cap },
      });
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["reference", 0, true],
    ["reference", 1, true],
    ["reference", 2, true],
    ["reference", 10, true],
    ["reference", 11, false],
    ["ordered-reference", 0, false],
    ["ordered-reference", 1, false],
    ["ordered-reference", 2, true],
    ["ordered-reference", 10, true],
    ["ordered-reference", 11, false],
    ["first-frame", 0, false],
    ["first-frame", 1, true],
    ["first-frame", 2, false],
    ["first-frame", 10, false],
    ["first-frame", 11, false],
    ["first-last", 0, false],
    ["first-last", 1, false],
    ["first-last", 2, true],
    ["first-last", 10, false],
    ["first-last", 11, false],
  ])("模式 %s 对 %i 张图片的校验结果为 %s", async (generationMode, count, valid) => {
    const body = {
      prompt: "视频",
      generationMode,
      aspectRatio: generationMode === "first-frame" || generationMode === "first-last"
        ? "adaptive"
        : "16:9",
      referenceImageUrls: Array.from({ length: count }, (_, index) => `https://example.com/${index}.png`),
    };
    const response = await POST(requestFor(body));

    expect(response.status).toBe(valid ? 200 : 400);
    if (!valid) {
      const generalMode = generationMode === "reference" || generationMode === "ordered-reference";
      const expected = generalMode && count > 10
        ? { code: "api.refTooMany", params: { n: 10 } }
        : { code: "api.referenceCountInvalid" };
      await expect(response.json()).resolves.toEqual(expected);
    }
  });

  it("Seedance 2.5 原生帧模式默认 adaptive、接受 adaptive 并拒绝固定比例", async () => {
    for (const generationMode of ["first-frame", "first-last"] as const) {
      const images = generationMode === "first-frame"
        ? ["https://example.com/first.png"]
        : ["https://example.com/first.png", "https://example.com/last.png"];

      expect((await POST(requestFor({
        prompt: "视频",
        generationMode,
        referenceImageUrls: images,
      }))).status).toBe(200);
      const defaultBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
      expect(defaultBody.ratio).toBe("adaptive");

      expect((await POST(requestFor({
        prompt: "视频",
        generationMode,
        aspectRatio: "adaptive",
        referenceImageUrls: images,
      }))).status).toBe(200);

      await expectApiError(
        { prompt: "视频", generationMode, aspectRatio: "16:9", referenceImageUrls: images },
        { code: "api.aspectInvalid" },
      );
    }
  });

  it("官方模型允许缺少或匹配 profile，并拒绝冲突 profile", async () => {
    expect((await POST(requestFor({ prompt: "视频", model: officialModels.seedance20 }))).status).toBe(200);
    expect((await POST(requestFor({
      prompt: "视频",
      model: officialModels.seedance20,
      modelProfile: officialModels.seedance20,
    }))).status).toBe(200);

    await expectApiError(
      {
        prompt: "视频",
        model: officialModels.seedance20,
        modelProfile: officialModels.seedance25,
      },
      { code: "api.modelProfileConflict" },
    );
  });

  it("自定义 Endpoint 需要显式有效 profile，并把 Endpoint 原样交给 provider", async () => {
    await expectApiError(
      { prompt: "视频", model: "ep-team-video" },
      { code: "api.clientUpgradeRequired" },
    );
    await expectApiError(
      { prompt: "视频", model: "ep-team-video", modelProfile: "unknown-profile" },
      { code: "api.modelProfileInvalid" },
    );

    const response = await POST(requestFor({
      prompt: "视频",
      model: "ep-team-video",
      modelProfile: officialModels.seedance20,
      resolution: "4k",
    }));
    expect(response.status).toBe(200);
    const arkBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(arkBody.model).toBe("ep-team-video");
    expect(arkBody).not.toHaveProperty("modelProfile");
  });

  it.each([
    [{ model: 25 }, "api.modelUnsupported"],
    [{ model: "unapproved-model" }, "api.modelUnsupported"],
    [{ model: "EP-UPPERCASE", modelProfile: officialModels.seedance25 }, "api.modelUnsupported"],
    [{ modelProfile: 25 }, "api.modelProfileInvalid"],
    [{ modelProfile: "unknown-profile" }, "api.modelProfileInvalid"],
    [{ generationMode: 1 }, "api.generationModeInvalid"],
    [{ generationMode: "keyframes" }, "api.generationModeInvalid"],
    [{ generateAudio: "true" }, "api.generateAudioInvalid"],
  ])("拒绝畸形字段 %#", async (fields, code) => {
    await expectApiError({ prompt: "视频", ...fields }, { code });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["generationMode", "api.generationModeInvalid", undefined],
    ["generateAudio", "api.generateAudioInvalid", undefined],
    ["duration", "api.durationInvalid", { min: 4, max: 30 }],
    ["resolution", "api.resolutionUnsupportedByModel", undefined],
    ["aspectRatio", "api.aspectInvalid", undefined],
  ])("字段 %s 只有真正缺失时才采用默认值", async (field, code, params) => {
    for (const malformed of [null, [], {}]) {
      await expectApiError(
        { prompt: "视频", [field]: malformed },
        { code, ...(params ? { params } : {}) },
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["model", "api.modelUnsupported"],
    ["modelProfile", "api.modelProfileInvalid"],
  ])("model/profile 字段 %s 的 null/array/object 不被视为缺失", async (field, code) => {
    for (const malformed of [null, [], {}]) {
      await expectApiError({ prompt: "视频", [field]: malformed }, { code });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("缺少旧版字段时使用默认模型、reference 模式和开启音频", async () => {
    const response = await POST(requestFor({ prompt: "  最终提示词  ", model: "   " }));
    expect(response.status).toBe(200);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: officialModels.seedance25,
      ratio: "16:9",
      resolution: "720p",
      duration: 5,
      generate_audio: true,
      content: [{ type: "text", text: "  最终提示词  " }],
    });
  });

  it("显式 false 的 generateAudio 被保留", async () => {
    expect((await POST(requestFor({ prompt: "视频", generateAudio: false }))).status).toBe(200);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.generate_audio).toBe(false);
  });

  it.each([
    ["URL 数组和 Data URL 数组", { referenceImageUrls: [], referenceImageDataUrls: [] }],
    ["URL 数组和单 Data URL", { referenceImageUrls: [], referenceImageDataUrl: pngDataUrl }],
    ["Data URL 数组和单 Data URL", { referenceImageDataUrls: [], referenceImageDataUrl: pngDataUrl }],
    ["全部三个字段", { referenceImageUrls: [], referenceImageDataUrls: [], referenceImageDataUrl: pngDataUrl }],
  ])("按字段存在性拒绝图片来源冲突：%s", async (_label, sources) => {
    await expectApiError({ prompt: "视频", ...sources }, { code: "api.refSourceConflict" });
  });

  it.each([
    ["referenceImageUrls", ["https://example.com/only.png"]],
    ["referenceImageDataUrls", [pngDataUrl]],
    ["referenceImageDataUrl", pngDataUrl],
  ])("图片来源 %s 经过相同的模式数量校验", async (field, value) => {
    await expectApiError(
      { prompt: "视频", generationMode: "ordered-reference", [field]: value },
      { code: "api.referenceCountInvalid" },
    );
  });

  it.each([
    ["ordered-reference", 1, false],
    ["ordered-reference", 2, true],
    ["first-frame", 0, false],
    ["first-frame", 1, true],
    ["first-frame", 2, false],
    ["first-last", 1, false],
    ["first-last", 2, true],
  ])("Data URL 数组模式 %s 对 %i 张图片保持统一数量语义", async (
    generationMode,
    count,
    valid,
  ) => {
    const response = await POST(requestFor({
      prompt: "视频",
      generationMode,
      referenceImageDataUrls: Array.from({ length: count }, () => pngDataUrl),
    }));

    expect(response.status).toBe(valid ? 200 : 400);
    if (valid) {
      expect(fetchMock).toHaveBeenCalledOnce();
    } else {
      await expect(response.json()).resolves.toEqual({ code: "api.referenceCountInvalid" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["reference", true],
    ["ordered-reference", false],
    ["first-frame", true],
    ["first-last", false],
  ])("legacy 单 Data URL 在 %s 模式保留一张图片可表达边界", async (
    generationMode,
    valid,
  ) => {
    const response = await POST(requestFor({
      prompt: "视频",
      generationMode,
      referenceImageDataUrl: pngDataUrl,
    }));

    expect(response.status).toBe(valid ? 200 : 400);
    if (valid) {
      expect(fetchMock).toHaveBeenCalledOnce();
    } else {
      await expect(response.json()).resolves.toEqual({ code: "api.referenceCountInvalid" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it.each([
    "http://blob.example.com/image.png",
    "file:///tmp/image.png",
    "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=",
    "ftp://blob.example.com/image.png",
    "not a url",
  ])("拒绝不安全或无效的参考图 URL：%s", async (referenceImageUrl) => {
    await expectApiError(
      { prompt: "视频", referenceImageUrls: [referenceImageUrl] },
      { code: "api.refInvalidUrl" },
    );
  });

  it("拒绝不支持、畸形或伪装的图片 Data URL", async () => {
    await expectApiError(
      { prompt: "视频", referenceImageDataUrl: "data:text/plain;base64,aGVsbG8=" },
      { code: "api.refUnsupportedType" },
    );
    await expectApiError(
      { prompt: "视频", referenceImageDataUrl: "data:image/png;base64,not_base64" },
      { code: "api.refUnsupportedType" },
    );
    await expectApiError(
      { prompt: "视频", referenceImageDataUrl: "data:image/png;base64,aGVsbG8=" },
      { code: "api.refInvalidContent" },
    );
  });

  it("只接受 canonical Base64 padding bits 和 padding 长度", async () => {
    const canonical = await POST(requestFor({
      prompt: "视频",
      referenceImageDataUrl: pngDataUrl,
    }));
    expect(canonical.status).toBe(200);

    for (const value of [
      "data:image/png;base64,iVBORw0KGgp=",
      "data:image/png;base64,iVBORw0KGgo==",
    ]) {
      const response = await POST(requestFor({
        prompt: "视频",
        referenceImageDataUrl: value,
      }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ code: "api.refInvalidFormat" });
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [3_999_999, 200],
    [4_000_000, 200],
    [4_000_001, 413],
  ])("忽略过小 Content-Length，按原始 UTF-8 字节校验 body 边界 %i", async (byteLength, status) => {
    const response = await POST(byteRequest(
      jsonBytesWithUtf8Length(byteLength),
      { contentLength: "1" },
    ));
    expect(response.status).toBe(status);
    if (status === 413) {
      await expect(response.json()).resolves.toEqual({ code: "api.requestTooLarge" });
      expect(fetchMock).not.toHaveBeenCalled();
    } else {
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it("缺失或过大的 Content-Length 不改变实际 body 边界", async () => {
    const withoutHeader = await POST(byteRequest(jsonBytesWithUtf8Length(4_000_000)));
    expect(withoutHeader.status).toBe(200);

    const lyingLargeHeader = await POST(byteRequest(
      encoder.encode('{"prompt":"视频"}'),
      { contentLength: "4000001" },
    ));
    expect(lyingLargeHeader.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("拒绝宽松解码后本可成为合法 JSON 的非法 UTF-8", async () => {
    const prefix = encoder.encode('{"prompt":"');
    const suffix = encoder.encode('"}');
    const malformed = new Uint8Array(prefix.byteLength + 1 + suffix.byteLength);
    malformed.set(prefix, 0);
    malformed[prefix.byteLength] = 0x80;
    malformed.set(suffix, prefix.byteLength + 1);

    const response = await POST(byteRequest(malformed, { contentLength: "1" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.invalidRequest" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("读取第 4,000,001 个字节后立即取消 stream 且不生成后续大块", async () => {
    let pulls = 0;
    let cancelled = false;
    let laterChunkMaterialized = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array(4_000_000));
          return;
        }
        if (pulls === 2) {
          controller.enqueue(new Uint8Array([0]));
          return;
        }
        laterChunkMaterialized = true;
        controller.enqueue(new Uint8Array(8_000_000));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    const response = await POST(streamRequest(body));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ code: "api.requestTooLarge" });
    expect({ pulls, cancelled, laterChunkMaterialized }).toEqual({
      pulls: 2,
      cancelled: true,
      laterChunkMaterialized: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("无 body、stream read 异常和 cancel 异常均稳定返回", async () => {
    const noBody = await POST(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "x-seedance-api-key": "test-request-key",
        "x-forwarded-for": nextIp(),
      },
    }));
    expect(noBody.status).toBe(400);
    await expect(noBody.json()).resolves.toEqual({ code: "api.invalidRequest" });

    const readFailure = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("read failed");
      },
    }, { highWaterMark: 0 });
    const readFailureResponse = await POST(streamRequest(readFailure));
    expect(readFailureResponse.status).toBe(400);
    await expect(readFailureResponse.json()).resolves.toEqual({ code: "api.invalidRequest" });

    let pulls = 0;
    let cancelAttempted = false;
    const cancelFailure = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(4_000_000));
        else if (pulls === 2) controller.enqueue(new Uint8Array([0]));
        else controller.close();
      },
      cancel() {
        cancelAttempted = true;
        throw new Error("cancel failed");
      },
    }, { highWaterMark: 0 });
    const cancelFailureResponse = await POST(streamRequest(cancelFailure));
    expect(cancelFailureResponse.status).toBe(413);
    await expect(cancelFailureResponse.json()).resolves.toEqual({ code: "api.requestTooLarge" });
    expect(cancelAttempted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("whole-request 上限先于 JSON 解析和图片解码错误", async () => {
    const oversizedImageBody = JSON.stringify({
      prompt: "视频",
      referenceImageDataUrl: `data:image/png;base64,${"a".repeat(4_000_000)}`,
    });
    expect(encoder.encode(oversizedImageBody).byteLength).toBeGreaterThan(4_000_000);

    const response = await POST(rawRequest(oversizedImageBody));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ code: "api.requestTooLarge" });
    expect(fetchMock).not.toHaveBeenCalled();

    const invalidJsonResponse = await POST(rawRequest(`{${"a".repeat(4_000_000)}`));
    expect(invalidJsonResponse.status).toBe(413);
    await expect(invalidJsonResponse.json()).resolves.toEqual({ code: "api.requestTooLarge" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalid/upgrade/413 不消耗 fresh IP bucket，三个 valid 后第四个才 429", async () => {
    const ip = nextIp();
    const oversized = await POST(byteRequest(jsonBytesWithUtf8Length(4_000_001), { ip }));
    expect(oversized.status).toBe(413);

    const invalidBodies = [
      { prompt: "视频", referenceImageUrls: [], referenceImageDataUrls: [] },
      { prompt: "视频", generationMode: "ordered-reference", referenceImageUrls: ["https://example.com/1.png"] },
      { prompt: "视频", model: officialModels.seedance25, modelProfile: officialModels.seedance20 },
      { prompt: "视频", model: "ep-team-video" },
    ];
    for (const body of invalidBodies) {
      expect((await POST(requestFor(body, { ip }))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await POST(requestFor({ prompt: "视频" }, { ip }))).status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const blocked = await POST(requestFor({ prompt: "视频" }, { ip }));
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({ code: "api.rateLimited" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("HTTP provider 错误可附加已清洗的 requestId", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(
      { error: { code: "Unauthorized", message: "invalid upstream key" } },
      { status: 401, headers: { "x-request-id": "request test-request-key" } },
    ));

    const response = await POST(requestFor({ prompt: "视频" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "api.providerAuthFailed",
      requestId: "request [api key hidden]",
    });
  });
});
