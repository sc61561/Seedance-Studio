import { describe, expect, it } from "vitest";

import { buildReferenceImagePayload, reorderReferenceImages } from "@/lib/video/reference-images";

describe("reorderReferenceImages", () => {
  it("按拖拽后的顺序重排参考图", () => {
    const images = [
      { id: "one", name: "f001.webp", dataUrl: "data:image/webp;base64,one", previewUrl: "blob:one", uploadStatus: "local" as const },
      { id: "two", name: "f003.webp", dataUrl: "data:image/webp;base64,two", previewUrl: "blob:two", uploadStatus: "local" as const },
      { id: "three", name: "f005.webp", dataUrl: "data:image/webp;base64,three", previewUrl: "blob:three", uploadStatus: "local" as const },
    ];

    expect(reorderReferenceImages(images, "three", "one").map((image) => image.name)).toEqual([
      "f005.webp",
      "f001.webp",
      "f003.webp",
    ]);
  });
});

describe("buildReferenceImagePayload", () => {
  it("仅在所有图片均已上传时使用远程 URL，以保持参考图顺序", () => {
    expect(
      buildReferenceImagePayload([
        {
          id: "one",
          name: "one.png",
          previewUrl: "blob:preview-one",
          dataUrl: "data:image/png;base64,one",
          remoteUrl: "https://blob.example.com/reference-images/one.png",
          uploadStatus: "uploaded",
        },
        {
          id: "two",
          name: "two.png",
          previewUrl: "blob:preview-two",
          dataUrl: "data:image/png;base64,two",
          uploadStatus: "local",
        },
      ]),
    ).toEqual({ referenceImageDataUrls: ["data:image/png;base64,one", "data:image/png;base64,two"] });
  });

  it("所有图片均已上传时使用远程 URL", () => {
    expect(buildReferenceImagePayload([
      {
        id: "one", name: "one.png", previewUrl: "blob:one", dataUrl: "data:image/png;base64,one",
        remoteUrl: "https://blob.example.com/reference-images/one.png", uploadStatus: "uploaded",
      },
    ])).toEqual({ referenceImageUrls: ["https://blob.example.com/reference-images/one.png"] });
  });
});
