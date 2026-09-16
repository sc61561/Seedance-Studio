import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/task/[id]/route";

describe("GET /api/task/[id]", () => {
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

  it("返回标准化的视频任务状态", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "cgt-complete",
          status: "succeeded",
          content: { video_url: "https://example.com/video.mp4" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await GET(new Request("http://localhost/api/task/cgt-complete"), {
      params: Promise.resolve({ id: "cgt-complete" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskId: "cgt-complete",
      status: "succeeded",
      videoUrl: "https://example.com/video.mp4",
    });
  });
});
