import { describe, expect, it } from "vitest";

import { reorderReferenceImages } from "@/lib/video/reference-images";

describe("reorderReferenceImages", () => {
  it("按拖拽后的顺序重排参考图", () => {
    const images = [
      { id: "one", name: "f001.webp", dataUrl: "data:image/webp;base64,one" },
      { id: "two", name: "f003.webp", dataUrl: "data:image/webp;base64,two" },
      { id: "three", name: "f005.webp", dataUrl: "data:image/webp;base64,three" },
    ];

    expect(reorderReferenceImages(images, "three", "one").map((image) => image.name)).toEqual([
      "f005.webp",
      "f001.webp",
      "f003.webp",
    ]);
  });
});
