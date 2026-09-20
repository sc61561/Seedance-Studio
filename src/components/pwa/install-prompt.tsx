"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";

import { useI18n } from "@/lib/i18n/context";

export type BeforeInstallPromptEventLike = {
  preventDefault: () => void;
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallOutcome = "accepted" | "dismissed" | "failed";

type IosSafariInstallContext = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  displayModeStandalone: boolean;
};

export function captureInstallPrompt<T extends BeforeInstallPromptEventLike>(event: T): T {
  event.preventDefault();
  return event;
}

export async function promptForInstall(
  event: BeforeInstallPromptEventLike,
): Promise<InstallOutcome> {
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "failed";
  }
}

export function detectIosSafariInstallContext(context: IosSafariInstallContext): boolean {
  const isIosDevice = /iPad|iPhone|iPod/i.test(context.platform)
    || (context.platform === "MacIntel" && context.maxTouchPoints > 1);
  const isSafari = /AppleWebKit/i.test(context.userAgent)
    && /Safari/i.test(context.userAgent)
    && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA)/i.test(context.userAgent);

  return isIosDevice
    && isSafari
    && !context.standalone
    && !context.displayModeStandalone;
}

function subscribeToInstallContext(): () => void {
  return () => undefined;
}

function getIosSafariInstallSnapshot(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return detectIosSafariInstallContext({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: navigatorWithStandalone.standalone === true,
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches === true,
  });
}

function getStandaloneInstallSnapshot(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return navigatorWithStandalone.standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

type InstallPromptViewProps = {
  isIosSafari: boolean;
  guideOpen: boolean;
  status?: InstallOutcome | "installed";
  onInstall: () => void;
  onDismissGuide: () => void;
};

export function InstallPromptView({
  isIosSafari,
  guideOpen,
  status,
  onInstall,
  onDismissGuide,
}: InstallPromptViewProps) {
  const { t } = useI18n();

  return (
    <div className="studio-install-wrap">
      <button
        className="studio-install-button"
        type="button"
        onClick={onInstall}
        aria-label={t("install.action")}
        aria-expanded={guideOpen}
        aria-controls="install-guide"
        title={t("install.action")}
      >
        <Download className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{t("install.action")}</span>
      </button>

      {guideOpen && (
        <div className="studio-install-guide" id="install-guide" role="status">
          <span>{t(isIosSafari ? "install.iosGuide" : "install.browserGuide")}</span>
          <button
            className="studio-install-guide-close"
            type="button"
            onClick={onDismissGuide}
            aria-label={t("install.dismissGuide")}
            title={t("install.dismissGuide")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {status && (
        <span className="studio-install-status" role="status" aria-live="polite">
          {t(`install.${status}`)}
        </span>
      )}
    </div>
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [status, setStatus] = useState<InstallOutcome | "installed">();
  const isIosSafari = useSyncExternalStore(
    subscribeToInstallContext,
    getIosSafariInstallSnapshot,
    () => false,
  );
  const isStandalone = useSyncExternalStore(
    subscribeToInstallContext,
    getStandaloneInstallSnapshot,
    () => false,
  );

  useEffect(() => {
    const handleBeforeInstallPrompt = (rawEvent: Event) => {
      const event = captureInstallPrompt(rawEvent as Event & BeforeInstallPromptEventLike);
      setDeferredPrompt(event);
      setStatus(undefined);
    };
    const handleInstalled = () => {
      setDeferredPrompt(undefined);
      setGuideOpen(false);
      setStatus("installed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handleInstall() {
    if (deferredPrompt) {
      const outcome = await promptForInstall(deferredPrompt);
      setDeferredPrompt(undefined);
      setStatus(outcome);
      return;
    }

    setGuideOpen(true);
  }

  if (isStandalone) return null;

  return (
    <InstallPromptView
      isIosSafari={isIosSafari}
      guideOpen={guideOpen}
      status={status}
      onInstall={() => void handleInstall()}
      onDismissGuide={() => {
        setGuideOpen(false);
      }}
    />
  );
}
