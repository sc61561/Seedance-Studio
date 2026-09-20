"use client";

import type { DragEvent, FormEvent } from "react";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  GripVertical,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  Move,
  Play,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";

import {
  buildFinalPrompt,
  maxFinalPromptLength,
  resolveGenerationMode,
  type CameraMode,
  type ConsistencyLevel,
  type GenerationMode,
  type MotionLevel,
} from "@/lib/video/prompt-compiler";
import {
  applyReferenceImageUploadResult,
  buildReferenceImagePayload,
  moveReferenceImage,
  prepareReferenceImage,
  referenceImagesReadyForGeneration,
  reorderReferenceImages,
  resolveReferenceImageUpload,
  type ReferenceImage,
} from "@/lib/video/reference-images";
import {
  acceptedReferenceImageTypes,
  hasMatchingReferenceImageExtension,
  maxReferenceImageBytes,
  maxReferenceImages,
} from "@/lib/video/reference-image-limits";
import {
  aspectRatioOptions,
  defaultDuration,
  defaultSeedanceModel,
  maxDuration,
  minDuration,
  resolutionOptions,
} from "@/lib/video/models";
import {
  clearActiveVideoTask,
  persistActiveVideoTask,
  type PersistedVideoTask,
  type PersistedVideoTaskStatus,
} from "@/lib/video/task-storage";
import {
  recoverActiveVideoTask,
  isTransientTaskPollingResponse,
  type RecoveredVideoTask,
  type RecoveryApiErrorBody,
} from "@/lib/video/task-recovery";
import { useI18n } from "@/lib/i18n/context";
import {
  clearStoredSeedanceApiKey,
  getStoredSeedanceApiKeySnapshot,
  saveStoredSeedanceApiKey,
  subscribeToStoredSeedanceApiKey,
} from "@/lib/client/api-key-storage";
import { LanguageSwitcher } from "@/components/studio/language-switcher";
import { InstallPrompt } from "@/components/pwa/install-prompt";

type VideoTaskState = "idle" | "submitting" | "queued" | "processing" | "succeeded" | "failed";
type VideoTask = { taskId: string; status: VideoTaskState; videoUrl?: string; error?: string };

type ApiErrorBody = { code?: string; params?: Record<string, string | number>; detail?: string };

const desktopMediaQuery = "(min-width: 640px)";

function subscribeToOnlineStatus(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function subscribeToDesktopViewport(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(desktopMediaQuery);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getDesktopSnapshot(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(desktopMediaQuery).matches);
}

function getCurrentTimestamp(): number {
  return Date.now();
}

export function VideoGenerator() {
  const { t } = useI18n();

  // Localize an API error body ({ code, params, detail }) using the shared dictionary.
  const localizeApiError = (body: ApiErrorBody | undefined, fallbackKey: string): string => {
    if (body?.code) {
      return t(body.code, { ...(body.params ?? {}), detail: body.detail ?? "" });
    }
    return t(fallbackKey);
  };

  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<(typeof resolutionOptions)[number]>("720p");
  const [aspectRatio, setAspectRatio] = useState<(typeof aspectRatioOptions)[number]>("16:9");
  const [duration, setDuration] = useState(defaultDuration);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("keyframes");
  const [cameraMode, setCameraMode] = useState<CameraMode>("auto");
  const [motionLevel, setMotionLevel] = useState<MotionLevel>("auto");
  const [consistencyLevel, setConsistencyLevel] = useState<ConsistencyLevel>("high");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [referenceError, setReferenceError] = useState<string>();
  const [draggedImageId, setDraggedImageId] = useState<string>();
  const [task, setTask] = useState<VideoTask>({ taskId: "", status: "idle" });
  const apiKey = useSyncExternalStore(
    subscribeToStoredSeedanceApiKey,
    getStoredSeedanceApiKeySnapshot,
    () => "",
  );
  const [apiKeyDraft, setApiKeyDraft] = useState<string>();
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyNotice, setApiKeyNotice] = useState<string>();
  const [apiKeyError, setApiKeyError] = useState<string>();
  const [advancedOpenPreference, setAdvancedOpenPreference] = useState<boolean | null>(null);
  const [restoredTask, setRestoredTask] = useState(false);
  const isOnline = useSyncExternalStore(subscribeToOnlineStatus, getOnlineSnapshot, () => true);
  const isDesktop = useSyncExternalStore(subscribeToDesktopViewport, getDesktopSnapshot, () => false);
  const advancedOpen = advancedOpenPreference ?? isDesktop;
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const referenceImagesRef = useRef<ReferenceImage[]>([]);
  const activeTaskCreatedAtRef = useRef<number | undefined>(undefined);
  const resultPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    referenceImagesRef.current = referenceImages;
  }, [referenceImages]);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  };

  const clearTrackedActiveTask = () => {
    clearActiveVideoTask();
    activeTaskCreatedAtRef.current = undefined;
    setRestoredTask(false);
  };

  const handlePersistTrackedActiveTask = (taskId: string, status: PersistedVideoTaskStatus) => {
    const createdAt = activeTaskCreatedAtRef.current;
    if (createdAt === undefined) return;
    persistActiveVideoTask({
      taskId,
      status,
      createdAt,
      model: defaultSeedanceModel(),
      resolution,
      aspectRatio,
      duration,
    });
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopPolling();
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
      referenceImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  function handleApiKeySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedKey = (apiKeyDraft ?? apiKey).trim();
    if (!normalizedKey) {
      setApiKeyError(t("api.apiKeyRequired"));
      setApiKeyNotice(undefined);
      return;
    }

    if (!saveStoredSeedanceApiKey(normalizedKey)) {
      setApiKeyError(t("api.apiKeyStorageFailed"));
      setApiKeyNotice(undefined);
      return;
    }

    setApiKeyDraft(undefined);
    setApiKeyError(undefined);
    setApiKeyNotice(t("apiKey.saved"));
  }

  function handleApiKeyClear() {
    stopPolling();
    submitAbortRef.current?.abort();
    clearTrackedActiveTask();
    clearStoredSeedanceApiKey();
    setApiKeyDraft(undefined);
    setTask({ taskId: "", status: "idle" });
    setApiKeyError(undefined);
    setApiKeyNotice(t("apiKey.cleared"));
  }

  const isGenerating = task.status === "submitting" || task.status === "queued" || task.status === "processing";
  const referenceImagesReady = referenceImagesReadyForGeneration(referenceImages);
  const modeHint = generationMode === "first-last" && referenceImages.length < 2
    ? t("hint.firstLastNeedTwo")
    : generationMode === "keyframes" && referenceImages.length < 2
      ? t("hint.keyframesNeedTwo")
      : generationMode === "keyframes"
        ? t("hint.keyframesOrder")
        : t("hint.referenceOrder");

  async function handleReferenceImageChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    const currentImages = referenceImagesRef.current;
    if (currentImages.length + selectedFiles.length > maxReferenceImages) {
      setReferenceError(t("err.tooManyImages", { n: maxReferenceImages }));
      return;
    }
    if (selectedFiles.some((file) => (
      !acceptedReferenceImageTypes.has(file.type)
      || !hasMatchingReferenceImageExtension(file.name, file.type)
    ))) {
      setReferenceError(t("err.unsupportedType"));
      return;
    }
    const existingBytes = currentImages.reduce((total, image) => total + image.size, 0);
    const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    if (
      selectedFiles.some((file) => file.size > maxReferenceImageBytes)
      || existingBytes + selectedBytes > maxReferenceImageBytes
    ) {
      setReferenceError(t("err.totalTooLarge"));
      return;
    }

    const pendingImages = selectedFiles.map((file, index) => prepareReferenceImage(
      file,
      createReferenceImageId(index),
      URL.createObjectURL(file),
    ));
    updateReferenceImages(() => [...currentImages, ...pendingImages]);
    setReferenceError(undefined);
    pendingImages.forEach((image) => {
      if (image.file) void uploadReferenceImage(image.id, image.file);
    });
  }

  async function uploadReferenceImage(id: string, file: File) {
    const result = await resolveReferenceImageUpload(file);
    if (!isMountedRef.current) return;
    updateReferenceImages((images) => applyReferenceImageUploadResult(images, id, result));
  }

  function retryReferenceImage(id: string) {
    const image = referenceImagesRef.current.find((item) => item.id === id);
    if (!image?.file || image.uploadStatus !== "failed") return;
    updateReferenceImages((images) => images.map((item) => (
      item.id === id ? { ...item, uploadStatus: "uploading", error: undefined } : item
    )));
    void uploadReferenceImage(id, image.file);
  }

  function updateReferenceImages(updater: (images: ReferenceImage[]) => ReferenceImage[]) {
    const nextImages = updater(referenceImagesRef.current);
    referenceImagesRef.current = nextImages;
    setReferenceImages(nextImages);
  }

  function removeReferenceImage(id: string) {
    updateReferenceImages((images) => {
      const image = images.find((item) => item.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return images.filter((image) => image.id !== id);
    });
    setReferenceError(undefined);
  }

  function handleImageDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (draggedImageId) {
      updateReferenceImages((images) => reorderReferenceImages(images, draggedImageId, targetId));
    }
    setDraggedImageId(undefined);
  }

  function moveReferenceImageBy(id: string, offset: -1 | 1) {
    updateReferenceImages((images) => moveReferenceImage(images, id, offset));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating || !isOnline || !prompt.trim() || !referenceImagesReady || !apiKey) {
      if (!apiKey) {
        setApiKeyError(t("api.apiKeyRequired"));
      }
      return;
    }
    stopPolling();
    clearTrackedActiveTask();
    setTask({ taskId: "", status: "submitting" });
    const controller = new AbortController();
    submitAbortRef.current = controller;
    const effectiveGenerationMode = resolveGenerationMode(generationMode, referenceImages.length);
    const finalPrompt = buildFinalPrompt({
      userPrompt: prompt,
      referenceImageCount: referenceImages.length,
      generationMode: effectiveGenerationMode,
      cameraMode,
      motionLevel,
      consistencyLevel,
    });
    if (finalPrompt.length > maxFinalPromptLength) {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
      setTask({
        taskId: "",
        status: "failed",
        error: t("err.promptWithControlsTooLong", { n: maxFinalPromptLength }),
      });
      return;
    }
    const imagesForGeneration = effectiveGenerationMode === "first-last" && referenceImages.length > 2
      ? [referenceImages[0], referenceImages[referenceImages.length - 1]]
      : referenceImages;
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-seedance-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: finalPrompt,
          model: defaultSeedanceModel(),
          resolution,
          aspectRatio,
          duration,
          ...buildReferenceImagePayload(imagesForGeneration),
        }),
      });
      const payload = (await response.json()) as { taskId?: string } & ApiErrorBody;
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !payload.taskId) {
        throw new Error(localizeApiError(payload, "api.createFailed"));
      }
      const nextTask = { taskId: payload.taskId, status: "queued" as const };
      activeTaskCreatedAtRef.current = getCurrentTimestamp();
      handlePersistTrackedActiveTask(nextTask.taskId, nextTask.status);
      setTask(nextTask);
      await pollTask(nextTask.taskId);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      setTask({
        taskId: "",
        status: "failed",
        error: error instanceof Error ? error.message : t("api.createFailed"),
      });
    } finally {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
    }
  }

  async function pollTask(taskId: string) {
    if (!isMountedRef.current) return;
    if (!apiKey) return;
    if (pollAbortRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      scheduleTaskPoll(taskId);
      return;
    }
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const response = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        headers: { "x-seedance-api-key": apiKey },
        signal: controller.signal,
      });
      let payload: ({
        taskId: string;
        status: VideoTaskState;
        videoUrl?: string;
        errorCode?: string;
      } & ApiErrorBody) | undefined;
      try {
        payload = await response.json() as typeof payload;
      } catch {
        if (isTransientTaskPollingResponse(response.status)) {
          scheduleTaskPoll(taskId);
          return;
        }
        clearTrackedActiveTask();
        setTask({ taskId, status: "failed", error: t("api.queryFailed") });
        stopPolling();
        return;
      }
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        if (isTransientTaskPollingResponse(response.status, payload?.code)) {
          setTask((currentTask) => currentTask.taskId === taskId
            ? { ...currentTask, error: localizeApiError(payload, "api.queryFailed") }
            : currentTask);
          scheduleTaskPoll(taskId);
          return;
        }
        clearTrackedActiveTask();
        setTask({ taskId, status: "failed", error: localizeApiError(payload, "api.queryFailed") });
        stopPolling();
        return;
      }
      if (
        !payload
        || typeof payload.taskId !== "string"
        || !["queued", "processing", "succeeded", "failed"].includes(payload.status)
      ) {
        scheduleTaskPoll(taskId);
        return;
      }
      const nextTask = {
        taskId: payload.taskId,
        status: payload.status,
        videoUrl: payload.videoUrl,
        error: payload.errorCode ? t(payload.errorCode) : undefined,
      };
      setTask(nextTask);
      if (payload.status === "succeeded" || payload.status === "failed") {
        clearTrackedActiveTask();
        stopPolling();
        return;
      }
      if (payload.status !== "queued" && payload.status !== "processing") {
        clearTrackedActiveTask();
        setTask({ taskId, status: "failed", error: t("api.queryFailed") });
        stopPolling();
        return;
      }
      handlePersistTrackedActiveTask(payload.taskId, payload.status);
      scheduleTaskPoll(taskId);
    } catch {
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        scheduleTaskPoll(taskId);
        return;
      }
      scheduleTaskPoll(taskId);
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
    }
  }

  function scheduleTaskPoll(taskId: string) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      if (isMountedRef.current) void pollTask(taskId);
    }, 5_000);
  }

  const recoverStoredTask = useEffectEvent(async () => {
    if (!apiKey) return;
    const controller = new AbortController();
    pollAbortRef.current = controller;

    try {
      await recoverActiveVideoTask({
        signal: controller.signal,
        online: typeof navigator === "undefined" || navigator.onLine,
        fetchTask: (input, init) => {
          const headers = new Headers(init.headers);
          headers.set("x-seedance-api-key", apiKey);
          return fetch(input, { ...init, headers });
        },
        onRestore: (storedTask: PersistedVideoTask) => {
          if (!isMountedRef.current || controller.signal.aborted) return;
          activeTaskCreatedAtRef.current = storedTask.createdAt;
          if (storedTask.resolution && (resolutionOptions as readonly string[]).includes(storedTask.resolution)) {
            setResolution(storedTask.resolution as (typeof resolutionOptions)[number]);
          }
          if (storedTask.aspectRatio && (aspectRatioOptions as readonly string[]).includes(storedTask.aspectRatio)) {
            setAspectRatio(storedTask.aspectRatio as (typeof aspectRatioOptions)[number]);
          }
          if (
            storedTask.duration !== undefined
            && storedTask.duration >= minDuration
            && storedTask.duration <= maxDuration
          ) {
            setDuration(storedTask.duration);
          }
          setTask({ taskId: storedTask.taskId, status: storedTask.status });
          setRestoredTask(true);
        },
        onTask: (recoveredTask: RecoveredVideoTask) => {
          if (!isMountedRef.current || controller.signal.aborted) return;
          setTask({
            taskId: recoveredTask.taskId,
            status: recoveredTask.status,
            videoUrl: recoveredTask.videoUrl,
            error: recoveredTask.errorCode ? t(recoveredTask.errorCode) : undefined,
          });
          if (recoveredTask.status === "succeeded" || recoveredTask.status === "failed") {
            activeTaskCreatedAtRef.current = undefined;
            setRestoredTask(false);
          }
        },
        onSchedule: (taskId) => {
          if (isMountedRef.current && !controller.signal.aborted) scheduleTaskPoll(taskId);
        },
        onUnauthorized: () => {
          if (isMountedRef.current && !controller.signal.aborted) {
            setApiKeyError(t("api.apiKeyRequired"));
          }
        },
        onTransientError: (body, error) => {
          if (!isMountedRef.current || controller.signal.aborted) return;
          setRestoredTask(true);
          setTask((currentTask) => ({
            ...currentTask,
            error: error instanceof Error ? t("api.queryFailed") : localizeApiError(body, "api.queryFailed"),
          }));
        },
        onError: (body?: RecoveryApiErrorBody, error?: unknown) => {
          if (!isMountedRef.current || controller.signal.aborted) return;
          activeTaskCreatedAtRef.current = undefined;
          setRestoredTask(false);
          setTask({
            taskId: "",
            status: "failed",
            error: error instanceof Error ? error.message : localizeApiError(body, "api.queryFailed"),
          });
        },
      });
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
    }
  });

  useEffect(() => {
    stopPolling();
    if (apiKey) void recoverStoredTask();
  }, [apiKey]);

  return (
    <main className="studio-shell app-shell has-mobile-action text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1320px]">
        <header className="studio-topbar mb-9 flex items-center justify-between gap-4 pb-5 sm:mb-12">
          <div className="flex items-center gap-3">
            <div className="studio-mark flex size-9 items-center justify-center" aria-hidden="true">
              <Clapperboard className="size-4" strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-sm font-medium tracking-tight text-[var(--text)]">Seedance Studio</p>
              <p className="mt-0.5 text-xs text-[var(--text-3)]">{t("topbar.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="studio-status hidden items-center gap-2 sm:flex">
              <span className="studio-status-dot" aria-hidden="true" />
              <span>{t("topbar.status")}</span>
            </div>
            <InstallPrompt />
            <LanguageSwitcher />
          </div>
        </header>

        <NetworkStatusBanner isOnline={isOnline} />
        <TaskRecoveryNotice restored={restoredTask} />

        <ApiKeySettings
          value={apiKeyDraft ?? apiKey}
          visible={apiKeyVisible}
          notice={apiKeyNotice}
          error={apiKeyError}
          hasSavedKey={Boolean(apiKey)}
          onChange={(value) => {
            setApiKeyDraft(value);
            setApiKeyNotice(undefined);
            setApiKeyError(undefined);
          }}
          onToggleVisibility={() => setApiKeyVisible((current) => !current)}
          onSubmit={handleApiKeySave}
          onClear={handleApiKeyClear}
        />

        <div className="mb-9 max-w-3xl sm:mb-11">
          <p className="studio-eyebrow mb-3">{t("hero.eyebrow")}</p>
          <h1 className="studio-title">{t("hero.title")}</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--text-2)] sm:text-base">
            {t("hero.subtitle")}
          </p>
        </div>

        <div className="mx-auto grid w-full max-w-[660px] items-start gap-[18px]">
          <section className="studio-panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-[22px]">
              <h2 className="studio-panel-title">{t("input.heading")}</h2>
              <span className="studio-index">01</span>
            </div>

            <form className="space-y-0" onSubmit={handleSubmit}>
              <div className="studio-form-section">
                <div className="mb-3 flex items-end justify-between gap-4">
                  <label className="studio-label" htmlFor="video-prompt">{t("prompt.label")}</label>
                  <span className="studio-counter" aria-live="polite">{prompt.length} / {maxFinalPromptLength}</span>
                </div>
                <textarea
                  id="video-prompt"
                  className="studio-textarea min-h-44"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t("prompt.placeholder")}
                  maxLength={maxFinalPromptLength}
                  disabled={isGenerating}
                  required
                />
                <p className="mt-2 text-xs text-[var(--text-3)]">{t("prompt.hint")}</p>
              </div>

              <div className="studio-model-row flex items-center justify-between gap-4 px-5 py-4 sm:px-7">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="studio-model-icon flex size-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
                    <Film className="size-4" strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0">
                    <p className="studio-label">{t("model.configured")}</p>
                    <p className="mt-1 truncate text-sm text-[var(--text)]">{t("model.name")}</p>
                  </div>
                </div>
                <span className="studio-chip shrink-0"><Check className="size-3" /> {t("model.chip")}</span>
              </div>

              <div className="studio-form-section border-t border-[var(--line)]">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="studio-panel-title">{t("output.heading")}</h2>
                  <span className="studio-index">02</span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label={t("field.resolution")} value={resolution} onChange={(value) => setResolution(value as typeof resolution)} disabled={isGenerating} options={resolutionOptions} />
                  <SelectField label={t("field.aspectRatio")} value={aspectRatio} onChange={(value) => setAspectRatio(value as typeof aspectRatio)} disabled={isGenerating} options={aspectRatioOptions} />
                </div>

                <label className="mt-5 block" htmlFor="video-duration">
                  <span className="mb-3 flex items-center justify-between gap-4">
                    <span className="studio-label">{t("field.duration")}</span>
                    <span className="studio-value">{t("duration.value", { n: duration })}</span>
                  </span>
                  <input
                    id="video-duration"
                    className="studio-range"
                    type="range"
                    min={minDuration}
                    max={maxDuration}
                    step={1}
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                    disabled={isGenerating}
                    aria-label={t("field.duration")}
                  />
                  <span className="mt-2 flex justify-between text-[11px] text-[var(--text-3)]"><span>{t("duration.min", { n: minDuration })}</span><span>{t("duration.max", { n: maxDuration })}</span></span>
                </label>

                <div className="mt-5">
                  <SelectField label={t("field.generationMode")} value={generationMode} onChange={(value) => setGenerationMode(value as GenerationMode)} disabled={isGenerating} options={[["reference", t("mode.reference")], ["keyframes", t("mode.keyframes")], ["first-last", t("mode.first-last")]]} />
                </div>

                <div className="studio-details mt-5">
                  <button
                    className="flex w-full cursor-pointer items-center justify-between gap-4 text-left"
                    type="button"
                    aria-expanded={advancedOpen}
                    aria-controls="advanced-settings"
                    onClick={() => setAdvancedOpenPreference(!advancedOpen)}
                  >
                    <span className="flex items-center gap-2"><SlidersHorizontal className="size-3.5 text-[var(--text-3)]" /> {t("advanced.toggle")}</span>
                    <ChevronDown className={`size-4 text-[var(--text-3)] transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  </button>
                  <div className="studio-advanced-content mt-4 grid gap-4 sm:grid-cols-3" hidden={!advancedOpen} id="advanced-settings">
                    <SelectField label={t("field.camera")} value={cameraMode} onChange={(value) => setCameraMode(value as CameraMode)} disabled={isGenerating} options={[["auto", t("camera.auto")], ["locked", t("camera.locked")], ["push-in", t("camera.push-in")], ["pull-back", t("camera.pull-back")]]} />
                    <SelectField label={t("field.motion")} value={motionLevel} onChange={(value) => setMotionLevel(value as MotionLevel)} disabled={isGenerating} options={[["auto", t("motion.auto")], ["low", t("motion.low")], ["medium", t("motion.medium")], ["high", t("motion.high")]]} />
                    <SelectField label={t("field.consistency")} value={consistencyLevel} onChange={(value) => setConsistencyLevel(value as ConsistencyLevel)} disabled={isGenerating} options={[["normal", t("consistency.normal")], ["high", t("consistency.high")], ["very-high", t("consistency.very-high")]]} />
                  </div>
                </div>
              </div>

              <div className="studio-form-section border-t border-[var(--line)]">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="studio-panel-title">{t("ref.heading")}</h2>
                  <span className="studio-index">{referenceImages.length}/{maxReferenceImages}</span>
                </div>

                <label className="studio-upload group block" htmlFor="reference-images" aria-disabled={isGenerating || !isOnline}>
                  <input
                    id="reference-images"
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(event) => void handleReferenceImageChange(event.target.files)}
                    disabled={isGenerating || !isOnline}
                  />
                  <span className="studio-upload-icon"><ImagePlus className="size-5" strokeWidth={1.6} /></span>
                  <span className="mt-3 block text-sm font-medium text-[var(--text)]">{t("ref.addTitle")}</span>
                  <span className="mt-1 block text-xs text-[var(--text-3)]">{t("ref.addDesc")}</span>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-2)] transition-colors group-hover:text-[var(--text)]"><Upload className="size-3.5" /> {t("ref.choose")}</span>
                </label>

                <p className="mt-3 text-xs leading-5 text-[var(--text-3)]">{modeHint}</p>
                {referenceError && <p className="mt-2 text-xs text-red-600" role="alert">{referenceError}</p>}

                {referenceImages.length > 0 && (
                  <ol className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label={t("ref.listLabel")}>
                    {referenceImages.map((image, index) => (
                      <li
                        key={image.id}
                        draggable={!isGenerating}
                        onDragStart={() => setDraggedImageId(image.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleImageDrop(event, image.id)}
                        onDragEnd={() => setDraggedImageId(undefined)}
                        className="studio-reference-card group relative cursor-grab overflow-hidden active:cursor-grabbing"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="aspect-[4/3] w-full object-cover" src={image.previewUrl} alt={t("ref.alt", { n: index + 1 })} />
                        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-2.5 py-2">
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-2)]"><GripVertical className="size-3 shrink-0 text-[var(--text-3)]" /> {String(index + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 truncate text-[11px] text-[var(--text-3)]" title={image.name}>{image.name}</span>
                        </div>
                        <div className="border-t border-[var(--line)] px-2.5 py-2 text-[11px] text-[var(--text-3)]">
                          {image.uploadStatus === "uploading" && t("ref.status.uploading")}
                          {image.uploadStatus === "uploaded" && t("ref.status.uploaded")}
                          {image.uploadStatus === "local" && t("ref.status.local")}
                          {image.uploadStatus === "failed" && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 text-red-600">
                                {localizeApiError(image.error, "api.uploadFailed")}
                              </span>
                              <button
                                className="shrink-0 underline underline-offset-2"
                                type="button"
                                onClick={() => retryReferenceImage(image.id)}
                                disabled={!image.file || !isOnline}
                              >
                                {t("ref.retry")}
                              </button>
                            </div>
                          )}
                        </div>
                        <ReferenceImageControls
                          imageName={image.name}
                          index={index}
                          total={referenceImages.length}
                          disabled={isGenerating}
                          onMove={(offset) => moveReferenceImageBy(image.id, offset)}
                          onRemove={() => removeReferenceImage(image.id)}
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="studio-mobile-submit-bar border-t border-[var(--line)]">
                <MobileSubmitAction
                  status={task.status}
                  disabled={!prompt.trim() || isGenerating || !isOnline || !referenceImagesReady || !apiKey}
                  onViewResult={() => resultPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                />
              </div>
            </form>
          </section>

          <section ref={resultPanelRef} className="studio-result-panel lg:sticky lg:top-8" aria-live="polite">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-5 sm:px-7">
              <h2 className="studio-panel-title">{t("result.heading")}</h2>
              <TaskBadge status={task.status} />
            </div>

            <div className="p-4 sm:p-6">
              {task.status === "succeeded" && task.videoUrl ? (
                <VideoSuccessResult videoUrl={task.videoUrl} />
              ) : (
                <div className={`studio-empty-state ${isGenerating ? "is-active" : ""} ${task.status === "failed" ? "is-error" : ""}`}>
                  <div className="studio-empty-icon" aria-hidden="true">
                    {isGenerating ? <LoaderCircle className="size-6 animate-spin" /> : task.status === "failed" ? <CircleAlert className="size-6" /> : <Play className="ml-0.5 size-6" />}
                  </div>
                  <p className="mt-5 text-sm font-medium text-[var(--text)]">
                    {task.status === "idle" && t("state.idle.title")}
                    {task.status === "submitting" && t("state.submitting.title")}
                    {task.status === "queued" && t("state.queued.title")}
                    {task.status === "processing" && t("state.processing.title")}
                    {task.status === "failed" && t("state.failed.title")}
                  </p>
                  <p className="mt-2 max-w-xs text-center text-xs leading-5 text-[var(--text-3)]">
                    {task.status === "idle" && t("state.idle.desc")}
                    {isGenerating && <GeneratingStateDescription error={task.error} />}
                    {task.status === "failed" && task.error}
                  </p>
                  {task.status === "idle" && (
                    <div className="mt-6 flex items-center gap-2 text-[11px] text-[var(--text-3)]">
                      <Move className="size-3.5" />
                      {t("state.idle.badge")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="mt-9 flex items-center justify-between gap-4 border-t border-[var(--line)] py-5 text-[11px] text-[var(--text-3)]">
          <span>{t("footer.note")}</span>
        </footer>
      </div>
    </main>
  );
}

type ApiKeySettingsProps = {
  value: string;
  visible: boolean;
  notice?: string;
  error?: string;
  hasSavedKey: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
};

export function ApiKeySettings({
  value,
  visible,
  notice,
  error,
  hasSavedKey,
  onChange,
  onToggleVisibility,
  onSubmit,
  onClear,
}: ApiKeySettingsProps) {
  const { t } = useI18n();

  return (
    <section className="studio-panel mb-7 overflow-hidden" aria-labelledby="api-key-heading">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-[22px]">
        <div className="flex items-center gap-2.5">
          <KeyRound className="size-4 text-[var(--text-2)]" aria-hidden="true" />
          <h2 id="api-key-heading" className="studio-panel-title">{t("apiKey.heading")}</h2>
        </div>
        <span className={`studio-chip ${hasSavedKey ? "" : "opacity-70"}`}>
          {hasSavedKey ? t("apiKey.status.ready") : t("apiKey.status.required")}
        </span>
      </div>
      <form className="studio-form-section" onSubmit={onSubmit}>
        <label className="studio-label mb-2 block" htmlFor="seedance-api-key">
          {t("apiKey.label")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <input
              id="seedance-api-key"
              className="studio-textarea min-h-0 w-full py-3 pr-11"
              type={visible ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={t("apiKey.placeholder")}
              aria-describedby="seedance-api-key-note"
            />
            <button
              className="studio-icon-button absolute right-2 top-1/2 -translate-y-1/2"
              type="button"
              onClick={onToggleVisibility}
              aria-label={visible ? t("apiKey.hide") : t("apiKey.show")}
              title={visible ? t("apiKey.hide") : t("apiKey.show")}
            >
              {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <button className="studio-submit shrink-0 px-5" type="submit" disabled={!value.trim()}>
            {hasSavedKey ? t("apiKey.update") : t("apiKey.save")}
          </button>
          {hasSavedKey && (
            <button className="studio-secondary-button shrink-0" type="button" onClick={onClear}>
              {t("apiKey.clear")}
            </button>
          )}
        </div>
        <p id="seedance-api-key-note" className="mt-3 text-xs leading-5 text-[var(--text-3)]">
          {t("apiKey.localOnly")}
        </p>
        {notice && <p className="mt-2 text-xs text-emerald-700" role="status">{notice}</p>}
        {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      </form>
    </section>
  );
}

export function NetworkStatusBanner({ isOnline }: { isOnline: boolean }) {
  const { t } = useI18n();
  if (isOnline) return null;

  return (
    <div className="studio-network-status mb-6 flex items-center gap-2" role="status">
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <span>{t("network.offline")}</span>
    </div>
  );
}

export function GeneratingStateDescription({ error }: { error?: string }) {
  const { t } = useI18n();
  return <>{error ?? t("state.generating.desc")}</>;
}

export function MobileSubmitAction({
  status,
  disabled,
  onViewResult,
}: {
  status: VideoTaskState;
  disabled: boolean;
  onViewResult: () => void;
}) {
  const { t } = useI18n();
  const isGenerating = status === "submitting" || status === "queued" || status === "processing";
  const isSucceeded = status === "succeeded";
  const label = isGenerating
    ? t("submit.generating")
    : isSucceeded
      ? t("submit.viewResult")
      : status === "failed"
        ? t("submit.regenerate")
        : t("submit.generate");

  return (
    <button
      className="studio-submit group mx-auto flex w-full max-w-[660px] items-center justify-center gap-2"
      type={isSucceeded ? "button" : "submit"}
      disabled={isSucceeded ? false : disabled}
      onClick={isSucceeded ? onViewResult : undefined}
    >
      {isGenerating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      <span>{label}</span>
      {!isGenerating && <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
    </button>
  );
}

export function TaskRecoveryNotice({ restored }: { restored: boolean }) {
  const { t } = useI18n();
  if (!restored) return null;

  return (
    <div className="studio-network-status mb-6 flex items-center gap-2" role="status">
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>{t("task.restored")}</span>
    </div>
  );
}

export function VideoSuccessResult({ videoUrl }: { videoUrl: string }) {
  const { t } = useI18n();
  const [shareStatus, setShareStatus] = useState<ShareVideoOutcome>();
  const canShare = useSyncExternalStore(
    subscribeToShareCapability,
    getShareCapabilitySnapshot,
    () => false,
  );

  async function handleShare() {
    const outcome = await shareVideoResult({
      videoUrl,
      title: t("result.shareTitle"),
      text: t("result.shareText"),
      share: typeof navigator === "undefined" ? undefined : navigator.share?.bind(navigator),
    });
    setShareStatus(outcome);
  }

  return (
    <div className="space-y-4">
      <div className="studio-video-frame">
        <video className="aspect-video w-full object-contain" controls src={videoUrl}>
          {t("result.videoUnsupported")}
        </video>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-[var(--text-2)]"><Check className="size-3.5" /> {t("result.ready")}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canShare && (
            <button
              className="studio-download-button"
              type="button"
              onClick={() => void handleShare()}
              aria-label={t("result.share")}
            >
              <Share2 className="size-3.5" aria-hidden="true" /> {t("result.share")}
            </button>
          )}
          <a className="studio-download-button" href={videoUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" aria-hidden="true" /> {t("result.open")}</a>
          <a className="studio-download-button" href={videoUrl} target="_blank" rel="noreferrer" download><Download className="size-3.5" aria-hidden="true" /> {t("result.download")}</a>
        </div>
      </div>
      {shareStatus && (
        <p className="text-xs text-[var(--text-3)]" role="status" aria-live="polite">
          {t(`result.shareStatus.${shareStatus}`)}
        </p>
      )}
    </div>
  );
}

export type ShareVideoOutcome = "shared" | "dismissed" | "unavailable" | "failed";

type ShareVideoInput = {
  videoUrl: string;
  title: string;
  text: string;
  share?: (data: ShareData) => Promise<void>;
};

export async function shareVideoResult({
  videoUrl,
  title,
  text,
  share,
}: ShareVideoInput): Promise<ShareVideoOutcome> {
  if (!share) return "unavailable";

  try {
    await share({ title, text, url: videoUrl });
    return "shared";
  } catch (error) {
    return isNamedAbortError(error) ? "dismissed" : "failed";
  }
}

function isNamedAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

export function canShareVideo(capability: { share?: unknown } | undefined): boolean {
  return typeof capability?.share === "function";
}

function subscribeToShareCapability(): () => void {
  return () => undefined;
}

function getShareCapabilitySnapshot(): boolean {
  return canShareVideo(typeof navigator === "undefined" ? undefined : navigator);
}

type ReferenceImageControlsProps = {
  imageName: string;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
};

export function ReferenceImageControls({
  imageName,
  index,
  total,
  disabled,
  onMove,
  onRemove,
}: ReferenceImageControlsProps) {
  const { t } = useI18n();

  return (
    <>
      <button
        className="studio-icon-button studio-reference-delete absolute right-2 top-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        type="button"
        onClick={onRemove}
        aria-label={t("ref.delete", { name: imageName })}
        title={t("ref.deleteTitle")}
        disabled={disabled}
      >
        <Trash2 className="size-3.5" />
      </button>
      <div className="studio-reference-move-controls border-t border-[var(--line)] sm:hidden">
        <button
          className="studio-reference-move-button"
          type="button"
          onClick={() => onMove(-1)}
          aria-label={t("ref.moveLeft", { name: imageName })}
          title={t("ref.moveLeft", { name: imageName })}
          disabled={disabled || index === 0}
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          className="studio-reference-move-button"
          type="button"
          onClick={() => onMove(1)}
          aria-label={t("ref.moveRight", { name: imageName })}
          title={t("ref.moveRight", { name: imageName })}
          disabled={disabled || index === total - 1}
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
    </>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  options: readonly string[] | ReadonlyArray<readonly [string, string]>;
};

function SelectField({ label, value, onChange, disabled, options }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="studio-label mb-2 block">{label}</span>
      <span className="studio-select-wrap block">
        <select className="studio-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
          {options.map((option) => {
            const [optionValue, optionLabel] = typeof option === "string" ? [option, option] : option;
            return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
          })}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--text-3)]" aria-hidden="true" />
      </span>
    </label>
  );
}

function TaskBadge({ status }: { status: VideoTaskState }) {
  const { t } = useI18n();
  if (status === "succeeded") return <span className="studio-task-badge is-success"><Check className="size-3" /> {t("badge.success")}</span>;
  if (status === "failed") return <span className="studio-task-badge is-error"><X className="size-3" /> {t("badge.failed")}</span>;
  if (status === "submitting" || status === "queued" || status === "processing") return <span className="studio-task-badge is-active"><span className="studio-status-dot" /> {t("badge.active")}</span>;
  return <span className="studio-task-badge">{t("badge.idle")}</span>;
}

function createReferenceImageId(index: number): string {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
}
