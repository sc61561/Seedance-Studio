import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  captureInstallPrompt,
  detectIosSafariInstallContext,
  InstallPromptView,
  promptForInstall,
  type BeforeInstallPromptEventLike,
} from "@/components/pwa/install-prompt";
import { I18nProvider } from "@/lib/i18n/context";

describe("PWA install prompt", () => {
  it("captures the Chromium install event without prompting automatically", () => {
    const event = {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    };

    expect(captureInstallPrompt(event)).toBe(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it("prompts only after an explicit action and reports accepted or dismissed", async () => {
    const accepted = createInstallEvent("accepted");
    const dismissed = createInstallEvent("dismissed");

    await expect(promptForInstall(accepted.event)).resolves.toBe("accepted");
    await expect(promptForInstall(dismissed.event)).resolves.toBe("dismissed");
    expect(accepted.prompt).toHaveBeenCalledOnce();
    expect(dismissed.prompt).toHaveBeenCalledOnce();
  });

  it("shows iOS guidance only for standalone-ineligible iOS Safari", () => {
    const iphoneSafari = {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
      standalone: false,
      displayModeStandalone: false,
    };
    const iphoneChrome = { ...iphoneSafari, userAgent: `${iphoneSafari.userAgent} CriOS/128.0` };

    expect(detectIosSafariInstallContext(iphoneSafari)).toBe(true);
    expect(detectIosSafariInstallContext({ ...iphoneSafari, standalone: true })).toBe(false);
    expect(detectIosSafariInstallContext(iphoneChrome)).toBe(false);
    expect(detectIosSafariInstallContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 0,
      standalone: false,
      displayModeStandalone: false,
    })).toBe(false);
  });

  it("renders localized, dismissible iOS instructions only when explicitly expanded", () => {
    const closed = renderToStaticMarkup(
      <I18nProvider>
        <InstallPromptView
          canPrompt={false}
          isIosSafari
          guideOpen={false}
          onInstall={() => undefined}
          onDismissGuide={() => undefined}
        />
      </I18nProvider>,
    );
    const open = renderToStaticMarkup(
      <I18nProvider>
        <InstallPromptView
          canPrompt={false}
          isIosSafari
          guideOpen
          onInstall={() => undefined}
          onDismissGuide={() => undefined}
        />
      </I18nProvider>,
    );
    const unsupported = renderToStaticMarkup(
      <I18nProvider>
        <InstallPromptView
          canPrompt={false}
          isIosSafari={false}
          guideOpen={false}
          onInstall={() => undefined}
          onDismissGuide={() => undefined}
        />
      </I18nProvider>,
    );

    expect(closed).toContain("安装应用");
    expect(closed).not.toContain("添加到主屏幕");
    expect(open).toContain('role="status"');
    expect(open).toContain("点击 Safari 的分享按钮，然后选择“添加到主屏幕”");
    expect(open).toContain('aria-label="关闭安装说明"');
    expect(unsupported).toBe("");
  });

  it("announces a dismissed install request as visible non-blocking status", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <InstallPromptView
          canPrompt={false}
          isIosSafari={false}
          guideOpen={false}
          status="dismissed"
          onInstall={() => undefined}
          onDismissGuide={() => undefined}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("已取消安装");
    expect(markup).not.toContain('class="sr-only"');
  });
});

function createInstallEvent(outcome: "accepted" | "dismissed"): {
  event: BeforeInstallPromptEventLike;
  prompt: ReturnType<typeof vi.fn>;
} {
  const prompt = vi.fn().mockResolvedValue(undefined);
  return {
    prompt,
    event: {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome }),
    },
  };
}
