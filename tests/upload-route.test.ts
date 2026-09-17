import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/upload/route";

const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let requestSequence = 0;

const requestFor = (file?: File) => {
  const form = new FormData();
  if (file) form.set("file", file);
  requestSequence += 1;
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { "x-forwarded-for": `198.51.100.${requestSequence}` },
    body: form,
  });
};

describe("POST /api/upload", () => {
  it("拒绝缺少文件", async () => {
    const response = await POST(requestFor());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.uploadFileRequired" });
  });

  it("拒绝不支持的图片类型", async () => {
    const response = await POST(requestFor(new File(["hello"], "reference.gif", { type: "image/gif" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refUnsupportedType" });
  });

  it("拒绝伪装成 PNG 的非图片内容", async () => {
    const response = await POST(
      requestFor(new File(["not an image"], "reference.png", { type: "image/png" })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refInvalidContent" });
  });

  it("拒绝大于 3 MB 的图片以适配 Vercel 请求上限", async () => {
    const response = await POST(
      requestFor(new File([new Uint8Array(3 * 1024 * 1024 + 1)], "reference.png", { type: "image/png" })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refTooLargeSingle" });
  });

  it.each([
    ["reference.jpg", "image/png"],
    ["reference.png", "image/jpeg"],
    ["reference.webp.exe", "image/webp"],
    ["reference", "image/png"],
  ])("拒绝扩展名与 MIME 不匹配的文件 %s (%s)", async (name, type) => {
    const response = await POST(requestFor(new File([pngSignature], name, { type })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refUnsupportedType" });
  });

  it("大小写不敏感地接受与 MIME 匹配的扩展名", async () => {
    const response = await POST(requestFor(new File([pngSignature], "REFERENCE.PNG", { type: "image/png" })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.storageNotConfigured" });
  });

  it("存储未配置时返回明确错误", async () => {
    const response = await POST(requestFor(new File([pngSignature], "reference.png", { type: "image/png" })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.storageNotConfigured" });
  });
});
