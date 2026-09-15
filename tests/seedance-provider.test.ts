import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeedanceProvider } from "@/lib/video/providers/seedance";

const createResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("SeedanceProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.SEEDANCE_API_KEY = "test-server-only-key";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.SEEDANCE_API_KEY;
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("将文生视频请求映射到方舟任务接口", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-text" }));

    const result = await new SeedanceProvider().createTask({
      provider: "seedance",
      model: "",
      prompt: "一只橘猫在窗边打盹",
    });

    expect(result).toEqual({ taskId: "cgt-text" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-server-only-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "doubao-seedance-1-0-pro-250528",
          content: [{ type: "text", text: "一只橘猫在窗边打盹" }],
          ratio: "16:9",
          duration: 5,
          watermark: false,
        }),
      }),
    );
  });

  it("将参考图 data URL 映射为图生视频内容", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-image" }));
    const referenceImageUrl = "data:image/png;base64,aGVsbG8=";

    await new SeedanceProvider().createTask({
      provider: "seedance",
      model: "",
      prompt: "让画面中的猫眨眼",
      referenceImageUrl,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      expect.objectContaining({
        body: JSON.stringify({
          model: "doubao-seedance-1-0-lite-i2v-250428",
          content: [
            { type: "text", text: "让画面中的猫眨眼" },
            { type: "image_url", image_url: { url: referenceImageUrl } },
          ],
          ratio: "adaptive",
          duration: 5,
          watermark: false,
        }),
      }),
    );
  });

  it("将成功任务响应规范化为视频 URL", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        id: "cgt-complete",
        status: "succeeded",
        content: { video_url: "https://example.com/video.mp4" },
      }),
    );

    await expect(new SeedanceProvider().getTask("cgt-complete")).resolves.toEqual({
      taskId: "cgt-complete",
      status: "succeeded",
      videoUrl: "https://example.com/video.mp4",
    });
  });
});
