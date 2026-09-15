import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VideoGenerator } from "@/components/studio/video-generator";

describe("VideoGenerator", () => {
  it("初始状态要求填写提示词才能生成", () => {
    const markup = renderToStaticMarkup(<VideoGenerator />);

    expect(markup).toContain("请输入你想生成的视频内容");
    expect(markup).toContain('maxLength="4000"');
    expect(markup).toContain("已配置模型");
    expect(markup).toContain("火山方舟接入点已配置");
    expect(markup).not.toContain("选择模型");
    expect(markup).toContain("分辨率");
    expect(markup).toContain("画面比例");
    expect(markup).toContain("视频时长");
    expect(markup).toContain('type="range"');
    expect(markup).toContain('min="2"');
    expect(markup).toContain('max="30"');
    expect(markup).toContain('step="1"');
    expect(markup).toContain('multiple=""');
    expect(markup).toContain("最多 10 张");
    expect(markup).toContain("生成模式");
    expect(markup).toContain("连续关键帧");
    expect(markup).toContain("高级设置");
    expect(markup).toContain("镜头");
    expect(markup).toContain("运动幅度");
    expect(markup).toContain("一致性");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });
});
