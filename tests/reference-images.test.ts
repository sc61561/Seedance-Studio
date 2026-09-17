import { describe, expect, it } from "vitest";

import {
  applyReferenceImageUploadResult,
  buildReferenceImagePayload,
  moveReferenceImage,
  prepareReferenceImage,
  referenceImagesReadyForGeneration,
  reorderReferenceImages,
  resolveReferenceImageUpload,
} from "@/lib/video/reference-images";

const images = [
  { id: "one", name: "f001.webp", size: 3, dataUrl: "data:image/webp;base64,one", previewUrl: "blob:one", uploadStatus: "local" as const },
  { id: "two", name: "f003.webp", size: 3, dataUrl: "data:image/webp;base64,two", previewUrl: "blob:two", uploadStatus: "local" as const },
  { id: "three", name: "f005.webp", size: 5, dataUrl: "data:image/webp;base64,three", previewUrl: "blob:three", uploadStatus: "local" as const },
];

describe("reorderReferenceImages", () => {
  it("按拖拽后的顺序重排参考图", () => {
    expect(reorderReferenceImages(images, "three", "one").map((image) => image.name)).toEqual([
      "f005.webp",
      "f001.webp",
      "f003.webp",
    ]);
  });
});

describe("moveReferenceImage", () => {
  it("按一个位置向左或向右移动参考图", () => {
    expect(moveReferenceImage(images, "two", -1).map((image) => image.id)).toEqual([
      "two",
      "one",
      "three",
    ]);
    expect(moveReferenceImage(images, "two", 1).map((image) => image.id)).toEqual([
      "one",
      "three",
      "two",
    ]);
  });

  it("在列表边界或图片不存在时保持原数组不变", () => {
    expect(moveReferenceImage(images, "one", -1)).toBe(images);
    expect(moveReferenceImage(images, "three", 1)).toBe(images);
    expect(moveReferenceImage(images, "missing", 1)).toBe(images);
  });
});

describe("buildReferenceImagePayload", () => {
  it("所有图片均已上传时使用远程 URL", () => {
    expect(buildReferenceImagePayload([
      {
        id: "one", name: "one.png", size: 8, previewUrl: "blob:one",
        remoteUrl: "https://blob.example.com/reference-images/one.png", uploadStatus: "uploaded",
      },
    ])).toEqual({ referenceImageUrls: ["https://blob.example.com/reference-images/one.png"] });
  });

  it("仅显式存储未配置回退才发送 Data URL", () => {
    expect(buildReferenceImagePayload(images.slice(0, 2))).toEqual({
      referenceImageDataUrls: ["data:image/webp;base64,one", "data:image/webp;base64,two"],
    });
  });
});

describe("reference image upload lifecycle", () => {
  it("选择文件后立即创建 uploading 预览，尚不读取 Base64", () => {
    const file = new File(["image"], "FRAME.PNG", { type: "image/png" });

    const image = prepareReferenceImage(file, "image-1", "blob:image-1");

    expect(image).toMatchObject({
      id: "image-1",
      name: "FRAME.PNG",
      size: 5,
      previewUrl: "blob:image-1",
      uploadStatus: "uploading",
      file,
    });
    expect(image.dataUrl).toBeUndefined();
  });

  it("上传完成只更新对应图片，并且成功上传不保留 File 或 Base64", () => {
    const first = prepareReferenceImage(
      new File(["one"], "one.png", { type: "image/png" }),
      "one",
      "blob:one",
    );
    const second = prepareReferenceImage(
      new File(["two"], "two.png", { type: "image/png" }),
      "two",
      "blob:two",
    );

    const updated = applyReferenceImageUploadResult([first, second], "one", {
      status: "uploaded",
      remoteUrl: "https://blob.example.com/reference-images/one.png",
    });

    expect(updated[0]).toEqual({
      id: "one",
      name: "one.png",
      size: 3,
      previewUrl: "blob:one",
      uploadStatus: "uploaded",
      remoteUrl: "https://blob.example.com/reference-images/one.png",
    });
    expect(updated[1]).toBe(second);
  });

  it("只在 503 storageNotConfigured 时读取 Data URL 回退", async () => {
    const file = new File(["image"], "one.png", { type: "image/png" });
    const readDataUrl = async () => "data:image/png;base64,aW1hZ2U=";

    await expect(resolveReferenceImageUpload(
      file,
      async () => Response.json({ code: "api.storageNotConfigured" }, { status: 503 }),
      readDataUrl,
    )).resolves.toEqual({ status: "local", dataUrl: "data:image/png;base64,aW1hZ2U=" });

    await expect(resolveReferenceImageUpload(
      file,
      async () => Response.json({ code: "api.uploadFailed" }, { status: 502 }),
      async () => {
        throw new Error("must not read Base64");
      },
    )).resolves.toEqual({ status: "failed", error: { code: "api.uploadFailed" }, httpStatus: 502 });
  });

  it("上传中、失败或混合回退状态都会阻止生成", () => {
    const uploaded = {
      id: "uploaded",
      name: "uploaded.png",
      size: 4,
      previewUrl: "blob:uploaded",
      remoteUrl: "https://blob.example.com/reference-images/uploaded.png",
      uploadStatus: "uploaded" as const,
    };

    expect(referenceImagesReadyForGeneration([{ ...uploaded, remoteUrl: undefined, uploadStatus: "uploading" }])).toBe(false);
    expect(referenceImagesReadyForGeneration([{ ...uploaded, remoteUrl: undefined, uploadStatus: "failed" }])).toBe(false);
    expect(referenceImagesReadyForGeneration([uploaded, images[0]])).toBe(false);
    expect(referenceImagesReadyForGeneration([uploaded])).toBe(true);
    expect(referenceImagesReadyForGeneration(images.slice(0, 2))).toBe(true);
  });
});
