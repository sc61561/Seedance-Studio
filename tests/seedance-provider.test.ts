import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";

const createResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const requestKey = "test-request-key";

describe("SeedanceProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("将文生视频请求映射到方舟任务接口", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-text" }));

    const result = await new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: "",
      prompt: "一只橘猫在窗边打盹",
      duration: 10,
      resolution: "1080p",
      aspectRatio: "9:16",
    });

    expect(result).toEqual({ taskId: "cgt-text" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${requestKey}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "ep-20260829185420-qnfvz",
          content: [{ type: "text", text: "一只橘猫在窗边打盹" }],
          ratio: "9:16",
          resolution: "1080p",
          duration: 10,
          watermark: false,
        }),
      }),
    );
  });

  it("只使用当前请求传入的 Key，而不读取部署端环境变量", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-request-key" }));

    await new SeedanceProvider("request-scoped-key").createTask({
      provider: "seedance",
      model: "",
      prompt: "请求级密钥测试",
    });

    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer request-scoped-key",
      }),
    }));
  });

  it("使用配置好的火山方舟推理接入点", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-selected-model" }));

    await new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: "ep-20260829185420-qnfvz",
      prompt: "海边日落",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "ep-20260829185420-qnfvz",
    });
  });

  it("将参考图 data URL 映射为图生视频内容", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-image" }));
    const referenceImageUrl = "data:image/png;base64,aGVsbG8=";

    await new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: "",
      prompt: "让画面中的猫眨眼",
      referenceImageUrl,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        body: JSON.stringify({
          model: "ep-20260829185420-qnfvz",
          content: [
            { type: "text", text: "让画面中的猫眨眼" },
            {
              type: "image_url",
              image_url: { url: referenceImageUrl },
              role: "reference_image",
            },
          ],
          ratio: "16:9",
          resolution: "720p",
          duration: 5,
          watermark: false,
        }),
      }),
    );
  });

  it("将多张图片映射为方舟参考图内容", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-multi-image" }));
    const imageUrls = [
      "data:image/png;base64,Zmlyc3Q=",
      "data:image/png;base64,c2Vjb25k",
    ];

    await new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: "ep-20260829185420-qnfvz",
      prompt: "让两个角色在雨中相遇",
      referenceImageUrls: imageUrls,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      content: [
        { type: "text", text: "让两个角色在雨中相遇" },
        { type: "image_url", image_url: { url: imageUrls[0] }, role: "reference_image" },
        { type: "image_url", image_url: { url: imageUrls[1] }, role: "reference_image" },
      ],
    });
  });

  it("展示方舟参数错误的状态码与安全错误详情", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: "InvalidParameter",
        message: "The prompt is too long.",
      },
    }, 400));

    await expect(
      new SeedanceProvider(requestKey).createTask({
        provider: "seedance",
        model: "",
        prompt: "测试",
      }),
    ).rejects.toEqual(
      new VideoProviderError(
        "api.providerHttpError",
        400,
        { label: "HTTP 400, InvalidParameter" },
        ": The prompt is too long.",
      ),
    );
  });

  it("从上游错误详情中移除 Base64 图片内容", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: "InvalidParameter",
        message: "bad image data:image/png;base64,c2VjcmV0LWltYWdlLWRhdGE= in request",
      },
    }, 400));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: "",
      prompt: "测试",
    })).rejects.toMatchObject({
      detail: ": bad image [image data hidden] in request",
    });
  });

  it("从上游错误详情中移除当前请求的 API Key", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      error: {
        code: "InvalidParameter",
        message: `the request included ${requestKey}`,
      },
    }, 400));

    await expect(new SeedanceProvider(requestKey).createTask({
      provider: "seedance",
      model: "",
      prompt: "测试",
    })).rejects.toMatchObject({
      detail: ": the request included [api key hidden]",
    });
  });

  it("将成功任务响应规范化为视频 URL", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        id: "cgt-complete",
        status: "succeeded",
        content: { video_url: "https://example.com/video.mp4" },
      }),
    );

    await expect(new SeedanceProvider(requestKey).getTask("cgt-complete")).resolves.toEqual({
      taskId: "cgt-complete",
      status: "succeeded",
      videoUrl: "https://example.com/video.mp4",
    });
  });

  it("拒绝成功状态却缺少视频地址的任务响应", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        id: "cgt-incomplete",
        status: "succeeded",
        content: {},
      }),
    );

    await expect(new SeedanceProvider(requestKey).getTask("cgt-incomplete")).rejects.toEqual(
      new VideoProviderError("api.providerNoVideoUrl"),
    );
  });

  it("拒绝成功状态却返回空视频地址的任务响应", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        id: "cgt-empty-url",
        status: "succeeded",
        content: { video_url: "   " },
      }),
    );

    await expect(new SeedanceProvider(requestKey).getTask("cgt-empty-url")).rejects.toEqual(
      new VideoProviderError("api.providerNoVideoUrl"),
    );
  });
});
