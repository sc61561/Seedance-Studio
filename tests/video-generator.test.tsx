import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  NetworkStatusBanner,
  ReferenceImageControls,
  TaskRecoveryNotice,
  VideoSuccessResult,
  VideoGenerator,
} from "@/components/studio/video-generator";
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
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('class="studio-advanced-content mt-4 grid gap-4 sm:grid-cols-3" hidden=""');
    expect(markup).toContain("镜头");
    expect(markup).toContain("运动幅度");
    expect(markup).toContain("一致性");
    expect(markup).toContain("AI VIDEO GENERATOR");
    expect(markup).toContain("结果预览区");
    expect(markup).toContain("studio-mobile-submit-bar");
    expect(markup).toContain("has-mobile-action");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("为触屏参考图提供有边界状态的移动和删除控件", () => {
    const firstMarkup = renderToStaticMarkup(
      <I18nProvider>
        <ReferenceImageControls
          imageName="one.png"
          index={0}
          total={2}
          disabled={false}
          onMove={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const lastMarkup = renderToStaticMarkup(
      <I18nProvider>
        <ReferenceImageControls
          imageName="two.png"
          index={1}
          total={2}
          disabled={false}
          onMove={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );

    expect(firstMarkup).toMatch(/aria-label="向左移动 one\.png"[^>]*disabled/);
    expect(firstMarkup).toMatch(/aria-label="向右移动 one\.png"/);
    expect(firstMarkup).toMatch(/aria-label="删除 one\.png"/);
    expect(firstMarkup).toContain("studio-reference-delete");
    expect(lastMarkup).toMatch(/aria-label="向右移动 two\.png"[^>]*disabled/);
  });

  it("仅在离线时显示安静的网络状态提示", () => {
    const onlineMarkup = renderToStaticMarkup(
      <I18nProvider><NetworkStatusBanner isOnline /></I18nProvider>,
    );
    const offlineMarkup = renderToStaticMarkup(
      <I18nProvider><NetworkStatusBanner isOnline={false} /></I18nProvider>,
    );

    expect(onlineMarkup).toBe("");
    expect(offlineMarkup).toContain('role="status"');
    expect(offlineMarkup).toContain("当前离线，视频生成需要网络连接");
  });

  it("恢复本地任务后显示明确的继续查询状态", () => {
    const inactiveMarkup = renderToStaticMarkup(
      <I18nProvider><TaskRecoveryNotice restored={false} /></I18nProvider>,
    );
    const activeMarkup = renderToStaticMarkup(
      <I18nProvider><TaskRecoveryNotice restored /></I18nProvider>,
    );

    expect(inactiveMarkup).toBe("");
    expect(activeMarkup).toContain('role="status"');
    expect(activeMarkup).toContain("已恢复上次的视频任务，正在继续查询进度");
  });

  it("恢复成功后将任务返回的视频地址渲染到播放和打开入口", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <VideoSuccessResult videoUrl="https://cdn.example.com/recovered.mp4" />
      </I18nProvider>,
    );

    expect(markup).toContain('src="https://cdn.example.com/recovered.mp4"');
    expect(markup).toContain('href="https://cdn.example.com/recovered.mp4"');
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
