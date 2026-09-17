import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  canShareVideo,
  shareVideoResult,
  VideoSuccessResult,
} from "@/components/studio/video-generator";
import { I18nProvider } from "@/lib/i18n/context";

describe("video result actions", () => {
  it("detects Web Share support without requiring browser globals", () => {
    expect(canShareVideo(undefined)).toBe(false);
    expect(canShareVideo({})).toBe(false);
    expect(canShareVideo({ share: vi.fn() })).toBe(true);
  });

  it("shares the successful video URL with concise localized context", async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(shareVideoResult({
      videoUrl: "https://cdn.example.com/result.mp4",
      title: "Seedance Studio",
      text: "查看我用 Seedance Studio 生成的视频",
      share,
    })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Seedance Studio",
      text: "查看我用 Seedance Studio 生成的视频",
      url: "https://cdn.example.com/result.mp4",
    });
  });

  it("returns non-blocking fallback outcomes when sharing is unavailable or rejected", async () => {
    await expect(shareVideoResult({
      videoUrl: "https://cdn.example.com/result.mp4",
      title: "Seedance Studio",
      text: "Video created with Seedance Studio",
    })).resolves.toBe("unavailable");

    await expect(shareVideoResult({
      videoUrl: "https://cdn.example.com/result.mp4",
      title: "Seedance Studio",
      text: "Video created with Seedance Studio",
      share: vi.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" })),
    })).resolves.toBe("dismissed");

    await expect(shareVideoResult({
      videoUrl: "https://cdn.example.com/result.mp4",
      title: "Seedance Studio",
      text: "Video created with Seedance Studio",
      share: vi.fn().mockRejectedValue({ name: "AbortError" }),
    })).resolves.toBe("dismissed");

    await expect(shareVideoResult({
      videoUrl: "https://cdn.example.com/result.mp4",
      title: "Seedance Studio",
      text: "Video created with Seedance Studio",
      share: vi.fn().mockRejectedValue(new Error("blocked")),
    })).resolves.toBe("failed");
  });

  it("keeps direct open and download fallbacks in server-rendered output", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <VideoSuccessResult videoUrl="https://cdn.example.com/result.mp4" />
      </I18nProvider>,
    );

    expect(markup).toContain('src="https://cdn.example.com/result.mp4"');
    expect(markup).toMatch(/href="https:\/\/cdn\.example\.com\/result\.mp4"[^>]*target="_blank"/);
    expect(markup).toMatch(/href="https:\/\/cdn\.example\.com\/result\.mp4"[^>]*download=""/);
    expect(markup).toContain("打开视频");
    expect(markup).toContain("下载视频");
  });
});
