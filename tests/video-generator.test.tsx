import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VideoGenerator } from "@/components/studio/video-generator";
import { I18nProvider } from "@/lib/i18n/context";

describe("VideoGenerator", () => {
  it("初始状态要求填写提示词才能生成（默认中文）", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <VideoGenerator />
      </I18nProvider>,
    );

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
    expect(markup).toContain("AI VIDEO GENERATOR");
    expect(markup).toContain("结果预览区");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("提供中英双语切换入口", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <VideoGenerator />
      </I18nProvider>,
    );

    expect(markup).toContain("English");
    expect(markup).toContain("简体中文");
  });

  it("认证启用但未登录时只显示访问密码门禁", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <VideoGenerator initialAuthState="unauthenticated" />
      </I18nProvider>,
    );

    expect(markup).toContain("访问密码");
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain("请输入你想生成的视频内容");
  });

  it("生产环境认证未配置时显示明确的服务器配置错误", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <VideoGenerator initialAuthState="unconfigured" />
      </I18nProvider>,
    );

    expect(markup).toContain("访问保护尚未配置");
    expect(markup).not.toContain('type="password"');
  });
});
