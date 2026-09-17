import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/generate/route";

const requestFor = (body: unknown) =>
  new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/generate", () => {
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

  it("拒绝超过 8 MB 的参考图", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrl: `data:image/png;base64,${"a".repeat(
          Math.ceil((8 * 1024 * 1024 * 4) / 3) + 1,
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
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageUrls: ["https://blob.example.com/reference-images/safe-key.png"],
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.providerNoKey" });
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
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "ep-20260829185420-qnfvz",
        resolution: "1080p",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.providerNoKey" });
  });

  it("允许在 2 到 30 秒之间选择任意整数时长", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "ep-20260829185420-qnfvz",
        duration: 11,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.providerNoKey" });
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
