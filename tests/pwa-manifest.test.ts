import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("describes an installable local Seedance Studio app", () => {
    expect(manifest()).toEqual(
      expect.objectContaining({
        name: "Seedance Studio",
        short_name: "Seedance",
        description: "AI 视频生成工作台",
        start_url: "/",
        display: "standalone",
        background_color: "#d2d2d0",
        theme_color: "#111111",
        orientation: "portrait-primary",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      }),
    );
  });
});

function pngDimensions(path: string) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe("PWA icons", () => {
  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
  ])("ships %s as a valid square PNG", (name, size) => {
    expect(pngDimensions(`../public/icons/${name}`)).toEqual({
      width: size,
      height: size,
    });
  });
});
