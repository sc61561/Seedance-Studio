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

  it("查询旧任务只需要 task ID 和当前 BYOK，不依赖 model/profile 或重新提交", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ id: "cgt-legacy", status: "queued" }));

    const response = await GET(new Request("http://localhost/api/task/cgt-legacy", {
      headers: { "x-seedance-api-key": "test-request-key" },
    }), {
      params: Promise.resolve({ id: "cgt-legacy" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taskId: "cgt-legacy", status: "queued" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-legacy",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("保留异步失败任务的已清洗 detail 和 requestId", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({
      id: "cgt-failed",
      status: "failed",
      error: {
        code: "InvalidParameter",
        message: "bad Bearer secret-token test-request-key data:image/png;base64,QUFBQUFBQUFBQUFBQUFBQUFB",
      },
      request_id: "request test-request-key",
    }));

    const response = await GET(new Request("http://localhost/api/task/cgt-failed", {
      headers: { "x-seedance-api-key": "test-request-key" },
    }), { params: Promise.resolve({ id: "cgt-failed" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskId: "cgt-failed",
      status: "failed",
      errorCode: "api.providerInvalidParameter",
      errorDetail: "InvalidParameter: bad Bearer [hidden] [api key hidden] [data hidden]",
      requestId: "request [api key hidden]",
    });
  });

  it("HTTP provider 错误响应附加已清洗的 requestId 且保留 403 分类", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: "AccessDenied", message: "forbidden" },
    }), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "x-request-id": "request test-request-key",
      },
    }));

    const response = await GET(new Request("http://localhost/api/task/cgt-denied", {
      headers: { "x-seedance-api-key": "test-request-key" },
    }), { params: Promise.resolve({ id: "cgt-denied" }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "api.providerPermissionDenied",
      requestId: "request [api key hidden]",
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
