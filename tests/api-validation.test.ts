import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/generate/route";

const requestFor = (body: unknown) =>
  new Request("http://localhost/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-seedance-api-key": "test-request-key",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/generate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("拒绝空提示词", async () => {
    const response = await POST(requestFor({ prompt: "   " }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.promptRequired" });
  });

  it("拒绝超过 4000 字符的最终提示词", async () => {
    const response = await POST(requestFor({ prompt: "a".repeat(4_001) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "api.promptTooLong",
      params: { n: 4000 },
    });
  });

  it("拒绝不支持的参考图 data URL", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrl: "data:text/plain;base64,aGVsbG8=",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refUnsupportedType" });
  });

  it("拒绝伪装成图片的内容", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refInvalidContent" });
  });

  it("拒绝超过 3 MB 的参考图以保证 Base64 JSON 低于 Vercel 请求上限", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrl: `data:image/png;base64,${"a".repeat(
          4 * Math.ceil((3 * 1024 * 1024 + 1) / 3),
        )}`,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refTooLargeSingle" });
  });

  it("拒绝超过十张的参考图", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrls: Array.from({ length: 11 }, () => "data:image/png;base64,iVBORw0KGgo="),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "api.refTooMany",
      params: { n: 10 },
    });
  });

  it("接受 HTTPS 上传后的参考图 URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "cgt-https-ref" })));
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageUrls: ["https://blob.example.com/reference-images/safe-key.png"],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taskId: "cgt-https-ref" });
  });

  it("保留上游鉴权错误码，供客户端区别于本地会话过期", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "Unauthorized", message: "invalid upstream key" },
    }, { status: 401 })));
    const response = await POST(new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seedance-api-key": "test-request-key",
        "x-forwarded-for": "203.0.113.123",
      },
      body: JSON.stringify({ prompt: "生成一段视频" }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "api.providerAuthFailed" });
  });

  it.each([
    "http://blob.example.com/image.png",
    "file:///tmp/image.png",
    "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=",
    "ftp://blob.example.com/image.png",
    "not a url",
  ])("拒绝不安全或无效的参考图 URL：%s", async (referenceImageUrl) => {
    const response = await POST(
      requestFor({ prompt: "生成一段视频", referenceImageUrls: [referenceImageUrl] }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refInvalidUrl" });
  });

  it("拒绝超过十张的参考图 URL", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageUrls: Array.from({ length: 11 }, (_, index) => `https://blob.example.com/${index}.png`),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "api.refTooMany",
      params: { n: 10 },
    });
  });

  it("拒绝非官方的模型标识", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "unapproved-model",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.modelUnsupported" });
  });

  it("拒绝已移出 MVP 的旧版模型", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "doubao-seedance-1-0-lite-i2v-250428",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.modelUnsupported" });
  });

  it("拒绝非当前配置的推理接入点", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "ep-another-endpoint",
        resolution: "1080p",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.modelUnsupported" });
  });

  it("允许为已配置的推理接入点选择 1080p", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "cgt-1080p" })));
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "ep-20260829185420-qnfvz",
        resolution: "1080p",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taskId: "cgt-1080p" });
  });

  it("允许在 2 到 30 秒之间选择任意整数时长", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "cgt-duration" })));
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "ep-20260829185420-qnfvz",
        duration: 11,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taskId: "cgt-duration" });
  });

  it.each([1, 31, 2.5])("拒绝范围外或非整数的视频时长 %s", async (duration) => {
    const response = await POST(requestFor({ prompt: "生成一段视频", duration }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "api.durationInvalid",
      params: { min: 2, max: 30 },
    });
  });

  it("拒绝不支持的分辨率", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        resolution: "4k",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.resolutionInvalid" });
  });
});
