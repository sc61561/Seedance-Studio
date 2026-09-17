import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/upload/route";

const requestFor = (file?: File) => {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
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

  it("拒绝大于 8 MB 的图片", async () => {
    const response = await POST(
      requestFor(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "reference.png", { type: "image/png" })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "api.refTooLargeSingle" });
  });

  it("存储未配置时返回明确错误", async () => {
    const response = await POST(requestFor(new File(["png"], "reference.png", { type: "image/png" })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "api.storageNotConfigured" });
  });
});
