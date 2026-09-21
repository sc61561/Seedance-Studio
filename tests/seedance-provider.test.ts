import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";
import type { CreateVideoInput } from "@/lib/video/types";

const createResponse = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers },
});

const createRawResponse = (
  body: string,
  status = 200,
  headers: HeadersInit = {},
) => new Response(body, {
  status,
  headers: { "content-type": "application/json", ...headers },
});

const requestKey = "test-request-key";
const officialModel = "doubao-seedance-2-5-260628";

describe("SeedanceProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  async function createTask(overrides: Partial<CreateVideoInput> = {}) {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-created" }));
    const result = await new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "一只橘猫在窗边打盹",
      ...overrides,
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    return { result, body: JSON.parse(request.body as string) as Record<string, unknown> };
  }

  it("精确映射文生视频请求，并默认发送官方模型与音频", async () => {
    const { result, body } = await createTask({
      model: "",
      duration: 10,
      resolution: "1080p",
      aspectRatio: "9:16",
    });

    expect(result).toEqual({ taskId: "cgt-created" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${requestKey}`,
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(body).toEqual({
      model: officialModel,
      content: [{ type: "text", text: "一只橘猫在窗边打盹" }],
      ratio: "9:16",
      resolution: "1080p",
      duration: 10,
      generate_audio: true,
    });
    expect(body).not.toHaveProperty("watermark");
    expect(body).not.toHaveProperty("modelProfile");
  });

  it("只使用当前请求传入的 Key，而不读取部署端环境变量", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-request-key" }));

    await new SeedanceProvider("request-scoped-key").createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "请求级密钥测试",
    });

    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer request-scoped-key",
      }),
    }));
  });

  it("只将自定义 Endpoint 发送为 model，不转发能力 profile", async () => {
    const { body } = await createTask({
      model: "ep-customer-seedance",
      modelProfile: "doubao-seedance-2-0-260128",
    });

    expect(body).toEqual({
      model: "ep-customer-seedance",
      content: [{ type: "text", text: "一只橘猫在窗边打盹" }],
      ratio: "16:9",
      resolution: "720p",
      duration: 5,
      generate_audio: true,
    });
  });

  it.each([
    ["reference", ["reference_image", "reference_image"]],
    ["ordered-reference", ["reference_image", "reference_image"]],
    ["first-frame", ["first_frame"]],
    ["first-last", ["first_frame", "last_frame"]],
  ] as const)("把 %s 图片依次映射为方舟角色", async (generationMode, roles) => {
    const imageUrls = roles.map((_, index) => `https://images.example.com/${index + 1}.png`);
    const { body } = await createTask({ generationMode, referenceImageUrls: imageUrls });

    expect(body).toEqual({
      model: officialModel,
      content: [
        { type: "text", text: "一只橘猫在窗边打盹" },
        ...imageUrls.map((url, index) => ({
          type: "image_url",
          image_url: { url },
          role: roles[index],
        })),
      ],
      ratio: "16:9",
      resolution: "720p",
      duration: 5,
      generate_audio: true,
    });
  });

  it("保留单张 referenceImageUrl 内部兼容输入", async () => {
    const referenceImageUrl = "data:image/png;base64,aGVsbG8=";
    const { body } = await createTask({ referenceImageUrl });

    expect(body.content).toEqual([
      { type: "text", text: "一只橘猫在窗边打盹" },
      {
        type: "image_url",
        image_url: { url: referenceImageUrl },
        role: "reference_image",
      },
    ]);
  });

  it.each([true, false])("显式发送 generate_audio=%s", async (generateAudio) => {
    const { body } = await createTask({ generateAudio });
    expect(body).toEqual({
      model: officialModel,
      content: [{ type: "text", text: "一只橘猫在窗边打盹" }],
      ratio: "16:9",
      resolution: "720p",
      duration: 5,
      generate_audio: generateAudio,
    });
  });

  it.each([
    ["null root", null],
    ["array root", []],
    ["number root", 42],
    ["numeric id", { id: 123 }],
    ["object id", { id: { nested: "bad" } }],
    ["null id", { id: null }],
    ["blank id", { id: "   " }],
  ])("创建任务把畸形成功响应 %s 归一为 api.createFailed", async (_label, body) => {
    fetchMock.mockResolvedValueOnce(createResponse(body));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toEqual(new VideoProviderError("api.createFailed"));
  });

  it("创建任务把无效 JSON 成功响应归一为 api.createFailed", async () => {
    fetchMock.mockResolvedValueOnce(createRawResponse("{not-json"));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toEqual(new VideoProviderError("api.createFailed"));
  });

  it.each([
    ["ordered-reference", []],
    ["ordered-reference", ["https://images.example.com/1.png"]],
    ["first-frame", []],
    ["first-frame", ["https://images.example.com/1.png", "https://images.example.com/2.png"]],
    ["first-last", []],
    ["first-last", ["https://images.example.com/1.png"]],
    ["first-last", [
      "https://images.example.com/1.png",
      "https://images.example.com/2.png",
      "https://images.example.com/3.png",
    ]],
  ] as const)("拒绝 %s 的错误图片数量，不降级或丢图", async (generationMode, referenceImageUrls) => {
    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
      generationMode,
      referenceImageUrls: [...referenceImageUrls],
    })).rejects.toMatchObject({ code: "api.referenceCountInvalid", statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["InvalidAPIKey", 500, "api.providerAuthFailed"],
    ["AccessDenied", 400, "api.providerPermissionDenied"],
    ["EndpointNotFound", 401, "api.providerUnavailable"],
    ["InsufficientBalance", 400, "api.providerQuotaExceeded"],
    ["RateLimitExceeded", 400, "api.providerBusy"],
    ["InvalidParameter", 503, "api.providerInvalidParameter"],
  ])("优先按上游代码 %s 归类，而非 HTTP %d", async (upstreamCode, status, appCode) => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: upstreamCode, message: "safe detail" },
    }, status));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({ code: appCode, statusCode: status });
  });

  it.each([
    ["OperationDenied.ServiceNotOpen", 403, "api.providerUnavailable"],
    ["InvalidEndpoint.ClosedEndpoint", 401, "api.providerUnavailable"],
    ["ModelIDAccessDisabled", 401, "api.providerUnavailable"],
    ["MissingParameter", 429, "api.providerInvalidParameter"],
    ["RequestBurstTooFast", 401, "api.providerBusy"],
    ["SetLimitExceeded", 401, "api.providerBusy"],
    ["InflightBatchsizeExceeded", 401, "api.providerBusy"],
  ])("官方上游代码 %s 优先于 HTTP %d 映射为 %s", async (
    upstreamCode,
    status,
    appCode,
  ) => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: upstreamCode, message: "safe detail" },
    }, status));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({ code: appCode, statusCode: status });
  });

  it.each([
    [401, "api.providerAuthFailed"],
    [403, "api.providerPermissionDenied"],
    [429, "api.providerBusy"],
  ])("未知上游代码才回退到 HTTP %d 分类", async (status, appCode) => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: "NewFailure", message: `safe ${requestKey}` },
      request_id: `request ${requestKey}`,
    }, status));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({
      code: appCode,
      statusCode: status,
      params: { label: `HTTP ${status}, NewFailure` },
      detail: ": safe [api key hidden]",
      requestId: "request [api key hidden]",
    });
  });

  it("查询接口的 HTTP 错误也使用同一上游代码分类", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: "ModelPermissionDenied", message: "safe detail" },
    }, 500));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-query-error")).rejects.toMatchObject({
      code: "api.providerPermissionDenied",
      statusCode: 500,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-query-error",
    );
  });

  it("未知错误保留稳定应用代码，并清理标签、详情和请求 ID", async () => {
    const bearer = "bearer-secret-123";
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: `Mystery\nCode ${requestKey}`,
        message: `bad\u0000  Bearer ${bearer}\n${requestKey} data:text/plain;base64,c2VjcmV0LWRhdGE= raw c2VjcmV0MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=`,
      },
      request_id: ` req\n${requestKey} `,
    }, 418, { "x-request-id": "header-id-must-not-win" }));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({
      code: "api.providerHttpError",
      params: { label: "HTTP 418, Mystery Code [api key hidden]" },
      detail: ": bad Bearer [hidden] [api key hidden] [data hidden] raw [base64 hidden]",
      requestId: "req [api key hidden]",
    });
  });

  it("从 code、message 和 request ID 中移除纯字母 Base64、URL-safe Base64 与长 token", async () => {
    const alphabetOnlyBase64 = "QUFBQUFBQUFBQUFBQUFBQUFB";
    const urlSafeBase64 = "eyJhbGciOiJIUzI1NiJ9_e30-signature";
    const longToken = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_";
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: alphabetOnlyBase64,
        message: `tokens ${alphabetOnlyBase64} ${urlSafeBase64} ${longToken}`,
      },
      request_id: `request-${alphabetOnlyBase64}-${urlSafeBase64}-${longToken}`,
    }, 418));

    let caught: VideoProviderError | undefined;
    try {
      await new SeedanceProvider(requestKey).createTask({
        provider: "seedance",
        model: officialModel,
        prompt: "测试",
      });
    } catch (error) {
      caught = error as VideoProviderError;
    }

    expect(caught).toMatchObject({ code: "api.providerHttpError", statusCode: 418 });
    const exposed = JSON.stringify({
      params: caught?.params,
      detail: caught?.detail,
      requestId: caught?.requestId,
    });
    expect(exposed).toContain("[base64 hidden]");
    expect(exposed).not.toContain(alphabetOnlyBase64);
    expect(exposed).not.toContain(urlSafeBase64);
    expect(exposed).not.toContain("e30-signature");
    expect(exposed).not.toContain(longToken);
  });

  it("移除 code、message 与 payload request ID 中按空白分段的 Base64", async () => {
    const splitStandard = "QUFB\nQUFB QUFB\tQUFB QUFB QUFB";
    const splitUrlSafe = "eyJh bGci OiJI UzI1 NiJ9 X2Uz MC1z aWdu YXR1 cmU";
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: splitStandard,
        message: `bad data:image/png;base64,${splitStandard} url ${splitUrlSafe}`,
      },
      request_id: splitUrlSafe,
    }, 418));

    let caught: VideoProviderError | undefined;
    try {
      await new SeedanceProvider(requestKey).createTask({
        provider: "seedance",
        model: officialModel,
        prompt: "测试",
      });
    } catch (error) {
      caught = error as VideoProviderError;
    }

    expect(caught).toMatchObject({ code: "api.providerHttpError", statusCode: 418 });
    const exposed = JSON.stringify({
      params: caught?.params,
      detail: caught?.detail,
      requestId: caught?.requestId,
    });
    expect(exposed).toContain("[base64 hidden]");
    expect(exposed).not.toContain("QUFB");
    expect(exposed).not.toContain("eyJh");
    expect(exposed).not.toContain("cmU");
    expect(exposed).not.toContain("data:image/png;base64");
  });

  it("移除 header request ID 中按空格分段的 Base64", async () => {
    const splitHeaderToken = "QUFB QUFB QUFB QUFB QUFB QUFB";
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: "UnknownFailure", message: "safe" },
    }, 500, { "x-tt-logid": `prefix ${splitHeaderToken}` }));

    let caught: VideoProviderError | undefined;
    try {
      await new SeedanceProvider(requestKey).createTask({
        provider: "seedance",
        model: officialModel,
        prompt: "测试",
      });
    } catch (error) {
      caught = error as VideoProviderError;
    }

    expect(caught?.requestId).toContain("[base64 hidden]");
    expect(caught?.requestId).not.toContain("QUFB");
  });

  it("移除 standalone code/message 与 payload ID 中的 8/16/76 字符 Base64 块", async () => {
    const codeWithEightCharacterChunks = "QUFBQUFB QUFBQUFB QUFBQUFB";
    const messageWithUrlSafeSixteenCharacterChunks =
      "AbCdEfGh_IjKlMnO PqRsTuVw_XyZ0123";
    const seventySixCharacterChunk = "QUFB".repeat(19);
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: codeWithEightCharacterChunks,
        message: `tokens ${messageWithUrlSafeSixteenCharacterChunks}`,
      },
      request_id: `${seventySixCharacterChunk}\n${seventySixCharacterChunk}`,
    }, 418));

    let caught: VideoProviderError | undefined;
    try {
      await new SeedanceProvider(requestKey).createTask({
        provider: "seedance",
        model: officialModel,
        prompt: "测试",
      });
    } catch (error) {
      caught = error as VideoProviderError;
    }

    const exposed = JSON.stringify({
      params: caught?.params,
      detail: caught?.detail,
      requestId: caught?.requestId,
    });
    expect(exposed).toContain("[base64 hidden]");
    expect(exposed).not.toContain("QUFBQUFB");
    expect(exposed).not.toContain("AbCdEfGh_IjKlMnO");
    expect(exposed).not.toContain(seventySixCharacterChunk);
  });

  it.each([
    ["x-request-id", { "x-request-id": "Q UFBQUFBQUFBQUFBQUFBQUFB" }],
    ["x-tt-logid", { "x-tt-logid": "QUFBQUFB QUFBQUFB QUFBQUFB" }],
  ])("移除 %s 中的长块或短首段 Base64", async (_label, headers) => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: "UnknownFailure", message: "safe" },
    }, 500, headers));

    let caught: VideoProviderError | undefined;
    try {
      await new SeedanceProvider(requestKey).createTask({
        provider: "seedance",
        model: officialModel,
        prompt: "测试",
      });
    } catch (error) {
      caught = error as VideoProviderError;
    }

    expect(caught?.requestId).toContain("[base64 hidden]");
    expect(caught?.requestId).not.toContain("QUFB");
    expect(caught?.requestId).not.toContain("UFB");
  });

  it("保留由普通英文单词组成的上游诊断信息", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: "UnclassifiedFailure",
        message: "Service unavailable due to invalid parameter",
      },
    }, 418));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({
      code: "api.providerHttpError",
      detail: ": Service unavailable due to invalid parameter",
    });
  });

  it.each([
    [{ code: 123, message: { nested: "unsafe" } }, { value: "request" }],
    [{ code: { nested: "unsafe" }, message: 42 }, 987],
    [{ code: null, message: null }, null],
  ])("非字符串上游字段稳定降级为通用 HTTP 错误", async (error, requestId) => {
    fetchMock.mockResolvedValueOnce(createResponse({ error, request_id: requestId }, 418));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({
      code: "api.providerHttpError",
      statusCode: 418,
      params: { label: "HTTP 418" },
      detail: "",
      requestId: undefined,
    });
  });

  it("当 payload 无请求 ID 时使用并清理 x-request-id 响应头", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: "UnknownFailure", message: "safe" },
    }, 500, { "x-request-id": `header ${requestKey}` }));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({ requestId: "header [api key hidden]" });
  });

  it.each([
    [
      { request_id: "payload-request-id" },
      { "x-request-id": "header-request-id", "x-tt-logid": "log-request-id" },
      "payload-request-id",
    ],
    [
      {},
      { "x-request-id": "header-request-id", "x-tt-logid": "log-request-id" },
      "header-request-id",
    ],
    [
      {},
      { "x-tt-logid": `log ${requestKey} QUFBQUFBQUFBQUFBQUFBQUFB` },
      "log [api key hidden] [base64 hidden]",
    ],
  ])("request ID 优先级为 payload > x-request-id > x-tt-logid", async (
    payload,
    headers,
    expectedRequestId,
  ) => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: { code: "UnknownFailure", message: "safe" },
      ...payload,
    }, 500, headers));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: officialModel,
      prompt: "测试",
    })).rejects.toMatchObject({ requestId: expectedRequestId });
  });

  it("将异步 failed 状态规范化，而不仅因失败状态抛错", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      id: "cgt-failed",
      status: "failed",
      error: {
        code: "InvalidParameter",
        message: `bad\nBearer bearer-token ${requestKey} data:image/png;base64,c2VjcmV0 [base64 c2VjcmV0MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=]`,
      },
      request_id: " req-123\n",
    }));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-failed")).resolves.toEqual({
      taskId: "cgt-failed",
      status: "failed",
      errorCode: "api.providerInvalidParameter",
      errorDetail: "InvalidParameter: bad Bearer [hidden] [api key hidden] [data hidden] [base64 [base64 hidden]]",
      requestId: "req-123",
    });
  });

  it("异步未知失败保留通用错误与安全的上游细节", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      id: "cgt-unknown-failure",
      status: "failed",
      error: { code: "NewUpstreamFailure", message: "concise detail" },
    }, 200, { "x-request-id": "header-request-456" }));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-unknown-failure")).resolves.toEqual({
      taskId: "cgt-unknown-failure",
      status: "failed",
      errorCode: "api.providerGenerationFailed",
      errorDetail: "NewUpstreamFailure: concise detail",
      requestId: "header-request-456",
    });
  });

  it("异步失败中的非字符串错误与 request ID 不会抛异常", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      id: "cgt-malformed-failure",
      status: "failed",
      error: { code: { nested: "unsafe" }, message: 42 },
      request_id: { nested: "unsafe" },
    }));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-malformed-failure")).resolves.toEqual({
      taskId: "cgt-malformed-failure",
      status: "failed",
      errorCode: "api.providerGenerationFailed",
    });
  });

  it.each([
    ["null root", null],
    ["array root", []],
    ["number root", 42],
  ])("查询任务把畸形成功响应 %s 归一为 api.queryFailed", async (_label, body) => {
    fetchMock.mockResolvedValueOnce(createResponse(body));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-requested")).rejects.toEqual(
      new VideoProviderError("api.queryFailed"),
    );
  });

  it("查询任务把无效 JSON 成功响应归一为 api.queryFailed", async () => {
    fetchMock.mockResolvedValueOnce(createRawResponse("{not-json"));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-requested")).rejects.toEqual(
      new VideoProviderError("api.queryFailed"),
    );
  });

  it.each([
    ["numeric id", 123],
    ["object id", { nested: "bad" }],
    ["null id", null],
    ["blank id", "   "],
  ])("查询任务忽略畸形响应 %s 并保留请求 task id", async (_label, id) => {
    fetchMock.mockResolvedValueOnce(createResponse({ id, status: "queued" }));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-requested")).resolves.toEqual({
      taskId: "cgt-requested",
      status: "queued",
    });
  });

  it("将成功任务响应规范化为视频 URL，且不添加失败字段", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      id: "cgt-complete",
      status: "succeeded",
      content: { video_url: "https://example.com/video.mp4" },
    }));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-complete")).resolves.toEqual({
      taskId: "cgt-complete",
      status: "succeeded",
      videoUrl: "https://example.com/video.mp4",
    });
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
  ])("拒绝成功状态却返回 %s 视频地址的任务响应", async (_label, videoUrl) => {
    fetchMock.mockResolvedValueOnce(createResponse({
      id: "cgt-incomplete",
      status: "succeeded",
      content: videoUrl === undefined ? {} : { video_url: videoUrl },
    }));

    await expect(new SeedanceProvider(requestKey).getTask("cgt-incomplete")).rejects.toEqual(
      new VideoProviderError("api.providerNoVideoUrl"),
    );
  });
});
