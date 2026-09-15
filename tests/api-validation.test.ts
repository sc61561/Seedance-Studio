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
    await expect(response.json()).resolves.toEqual({ error: "请输入提示词。" });
  });

  it("拒绝不支持的参考图 data URL", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrl: "data:text/plain;base64,aGVsbG8=",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "参考图仅支持 PNG、JPEG 或 WebP 格式。",
    });
  });

  it("拒绝伪装成图片的内容", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        referenceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "参考图内容不是有效的 PNG、JPEG 或 WebP 图片。",
    });
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
    await expect(response.json()).resolves.toEqual({
      error: "参考图不能超过 8 MB。",
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
    await expect(response.json()).resolves.toEqual({
      error: "请选择支持的官方 Seedance 模型。",
    });
  });

  it("拒绝已停止服务的 Lite 图生视频模型", async () => {
    const response = await POST(
      requestFor({
        prompt: "生成一段视频",
        model: "doubao-seedance-1-0-lite-i2v-250428",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "请选择支持的官方 Seedance 模型。",
    });
  });
});
