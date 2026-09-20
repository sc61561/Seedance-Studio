import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/task/[id]/route";

const createResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("GET /api/task/[id]", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
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

    const response = await GET(new Request("http://localhost/api/task/cgt-complete", {
      headers: { "x-seedance-api-key": "test-request-key" },
    }), {
      params: Promise.resolve({ id: "cgt-complete" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskId: "cgt-complete",
      status: "succeeded",
      videoUrl: "https://example.com/video.mp4",
    });
  });

  it("限制公开任务轮询请求", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(createResponse({ id: "cgt-queued", status: "queued" })));
    const request = () => GET(new Request("http://localhost/api/task/cgt-queued", {
      headers: {
        "x-seedance-api-key": "test-request-key",
        "x-forwarded-for": "198.51.100.250",
      },
    }), { params: Promise.resolve({ id: "cgt-queued" }) });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(request()).resolves.toMatchObject({ status: 200 });
    }

    const blocked = await request();
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({ code: "api.rateLimited" });
  });
});
