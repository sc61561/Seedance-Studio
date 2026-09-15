import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VideoGenerator } from "@/components/studio/video-generator";

describe("VideoGenerator", () => {
  it("初始状态要求填写提示词才能生成", () => {
    const markup = renderToStaticMarkup(<VideoGenerator />);

    expect(markup).toContain("请输入你想生成的视频内容");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });
});
