"use client";

import type { CSSProperties, DragEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
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
  maxFinalPromptLength,
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
  defaultSeedanceModel,
  getSeedanceModelProfile,
  officialSeedanceModelIds,
  resolutionOptions,
  seedanceModelProfiles,
  type OfficialSeedanceModelId,
} from "@/lib/video/models";
import {
  adjustGenerationControls,
  buildActiveTaskPersistenceFields,
  buildGenerationTargetView,
  getGenerationModeGuidance,
  getModelSettingsForUiSelection,
  getUiModelSelection,
  shouldShow4KWarning,
  type GenerationControlState,
  type UiModelSelection,
  type UiModelTargetState,
} from "@/lib/video/generation-form";
import {
  createGenerationRequestController,
  createGenerationRequestSnapshotCache,
  type GenerationRequestSnapshot,
} from "@/lib/video/generation-request";
import type { RecoveryPauseReason } from "@/lib/video/task-recovery";
import { fingerprintSeedanceApiKey } from "@/lib/client/api-key-fingerprint";
import { createTaskPollingSession } from "@/lib/client/task-polling-session";
import { useI18n } from "@/lib/i18n/context";
import {
  clearStoredSeedanceApiKey,
  getStoredSeedanceApiKeySnapshot,
  readStoredSeedanceApiKey,
  saveStoredSeedanceApiKey,
  subscribeToStoredSeedanceApiKey,
} from "@/lib/client/api-key-storage";
import {
  readStoredSeedanceModelSettings,
  saveStoredSeedanceModelSettings,
  subscribeToStoredSeedanceModelSettings,
} from "@/lib/client/model-settings-storage";
import { LanguageSwitcher } from "@/components/studio/language-switcher";
import { InstallPrompt } from "@/components/pwa/install-prompt";

type VideoTaskState = "idle" | "submitting" | "queued" | "processing" | "paused" | "succeeded" | "failed";
type VideoTask = { taskId: string; status: VideoTaskState; videoUrl?: string; error?: string; errorCode?: string; pauseReason?: RecoveryPauseReason; retrying?: boolean };

type ApiErrorBody = { code?: string; params?: Record<string, string | number>; detail?: string };

const desktopMediaQuery = "(min-width: 640px)";
const defaultProfile = getSeedanceModelProfile(defaultSeedanceModel())!;

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

function getStoredModelSettingsStringSnapshot(): string {
  const settings = readStoredSeedanceModelSettings();
  return settings ? JSON.stringify(settings) : "";
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
  const [resolution, setResolutionState] = useState<(typeof resolutionOptions)[number]>("720p");
  const [aspectRatio, setAspectRatioState] = useState<(typeof aspectRatioOptions)[number]>("16:9");
  const [duration, setDurationState] = useState(defaultProfile.defaultDuration);
  const [generationMode, setGenerationModeState] = useState<GenerationMode>("reference");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [controlsAdjusted, setControlsAdjusted] = useState(false);
  const [modelTargetDraft, setModelTargetDraft] = useState<UiModelTargetState>();
  const requestedControlsRef = useRef<GenerationControlState>({
    duration: defaultProfile.defaultDuration,
    resolution: "720p" as const,
    aspectRatio: "16:9" as const,
    generationMode: "reference" as const,
  });
  const modelTargetDraftRef = useRef<UiModelTargetState | undefined>(undefined);
  const subscribeToModelTarget = useCallback((onStoreChange: () => void) => (
    subscribeToStoredSeedanceModelSettings(() => {
      if (!modelTargetDraftRef.current) {
        const storedTarget = getUiModelSelection(readStoredSeedanceModelSettings());
        const profile = storedTarget.selection === "custom-endpoint"
          ? getSeedanceModelProfile(storedTarget.customProfile)
          : getSeedanceModelProfile(storedTarget.selection);
        if (profile) {
          const adjustment = adjustGenerationControls(requestedControlsRef.current, profile);
          requestedControlsRef.current = adjustment.controls;
          setDurationState(adjustment.controls.duration);
          setResolutionState(adjustment.controls.resolution);
          setAspectRatioState(adjustment.controls.aspectRatio);
          setControlsAdjusted(adjustment.adjusted);
        }
      }
      onStoreChange();
    })
  ), []);
  const storedModelSettingsSnapshot = useSyncExternalStore(
    subscribeToModelTarget,
    getStoredModelSettingsStringSnapshot,
    () => "",
  );
  const modelTargetState = modelTargetDraft ?? getUiModelSelection(
    storedModelSettingsSnapshot
      ? JSON.parse(storedModelSettingsSnapshot) as { model: string; modelProfile?: OfficialSeedanceModelId }
      : undefined,
  );
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
  const submitAbortRef = useRef<AbortController | null>(null);
  const keyEpochRef = useRef(0);
  const keySnapshotRef = useRef("");
  const isMountedRef = useRef(true);
  const referenceImagesRef = useRef<ReferenceImage[]>([]);
  const resultPanelRef = useRef<HTMLElement | null>(null);
  const taskSession = useMemo(() => createTaskPollingSession({
    onUpdate: (update) => {
      if (!isMountedRef.current) return;
      if (update.kind === "restore") {
        setTask({ taskId: update.task.taskId, status: update.task.status });
        setRestoredTask(true);
      } else if (update.kind === "task") {
        setTask({
          taskId: update.task.taskId,
          status: update.task.status,
          videoUrl: update.task.videoUrl,
          errorCode: update.task.errorCode,
        });
        if (update.task.status === "succeeded" || update.task.status === "failed") setRestoredTask(false);
      } else if (update.kind === "pause") {
        setTask({ taskId: update.taskId, status: "paused", pauseReason: update.reason });
        setRestoredTask(true);
      } else if (update.kind === "retry") {
        setTask((current) => current.taskId === update.taskId
          ? { ...current, retrying: true }
          : current);
      } else {
        setTask({ taskId: update.taskId, status: "failed", errorCode: "api.queryFailed" });
        setRestoredTask(false);
      }
    },
  }), []);

  const targetView = buildGenerationTargetView(modelTargetState, {
    duration,
    resolution,
    aspectRatio,
    generationMode,
  }, referenceImages);
  const resolvedTarget = targetView.resolvedTarget;
  const selectedProfile = targetView.profile;
  const effectiveDuration = targetView.controls.duration;
  const effectiveResolution = targetView.controls.resolution;
  const effectiveAspectRatio = targetView.controls.aspectRatio;
  const modeCapability = selectedProfile.modeCapabilities[generationMode];
  const modeGuidance = getGenerationModeGuidance(
    selectedProfile,
    generationMode,
    targetView.referenceImages.length,
  );
  const referenceImagePayload = useMemo(
    () => buildReferenceImagePayload(referenceImages),
    [referenceImages],
  );
  const requestSnapshotCache = useMemo(
    () => createGenerationRequestSnapshotCache(),
    [],
  );
  const requestController = resolvedTarget
    ? createGenerationRequestController(requestSnapshotCache, {
      target: resolvedTarget,
      userPrompt: prompt,
      generationMode,
      generateAudio,
      cameraMode,
      motionLevel,
      consistencyLevel,
      duration: effectiveDuration,
      resolution: effectiveResolution,
      aspectRatio: effectiveAspectRatio,
      referenceImagePayload,
    })
    : undefined;
  const requestSnapshot = requestController?.snapshot;
  const requestValidationError = !requestSnapshot
    ? t("err.customEndpointInvalid")
    : requestSnapshot.finalPrompt.length > maxFinalPromptLength
      ? t("err.promptWithControlsTooLong", { n: maxFinalPromptLength })
      : requestSnapshot.exceedsByteLimit
        ? t("err.requestTooLarge")
        : undefined;

  useEffect(() => {
    referenceImagesRef.current = referenceImages;
  }, [referenceImages]);

  function applyControlProfile(
    profile: typeof selectedProfile,
    nextGenerationMode: GenerationMode,
  ) {
    const adjustment = adjustGenerationControls({
      ...requestedControlsRef.current,
      generationMode: nextGenerationMode,
    }, profile);
    setRequestedControls(adjustment.controls);
    setControlsAdjusted(adjustment.adjusted);
  }

  function setRequestedControls(next: GenerationControlState) {
    requestedControlsRef.current = next;
    setDurationState(next.duration);
    setResolutionState(next.resolution);
    setAspectRatioState(next.aspectRatio);
    setGenerationModeState(next.generationMode);
  }

  function handleModelTargetChange(next: UiModelTargetState) {
    const settings = getModelSettingsForUiSelection(next);
    const persisted = settings ? saveStoredSeedanceModelSettings(settings) : false;
    const nextDraft = persisted ? undefined : next;
    modelTargetDraftRef.current = nextDraft;
    setModelTargetDraft(nextDraft);
    const profile = next.selection === "custom-endpoint"
      ? getSeedanceModelProfile(next.customProfile)
      : getSeedanceModelProfile(next.selection);
    if (profile) applyControlProfile(profile, generationMode);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      taskSession.invalidate();
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
      referenceImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, [taskSession]);

  useEffect(() => {
    const onKeyChange = () => {
      const next = readStoredSeedanceApiKey();
      if (next === keySnapshotRef.current) return;
      keyEpochRef.current += 1;
      keySnapshotRef.current = next;
      submitAbortRef.current?.abort();
      void taskSession.changeKey(next);
    };
    const unsubscribe = subscribeToStoredSeedanceApiKey(onKeyChange);
    onKeyChange();
    return unsubscribe;
  }, [taskSession]);

  function handleApiKeySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedKey = (apiKeyDraft ?? apiKey).trim();
    if (!normalizedKey) {
      setApiKeyError(t("api.apiKeyRequired"));
      setApiKeyNotice(undefined);
      return;
    }

    if (normalizedKey !== apiKey) {
      keyEpochRef.current += 1;
      taskSession.invalidate();
      submitAbortRef.current?.abort();
    }
    if (!saveStoredSeedanceApiKey(normalizedKey)) {
      void taskSession.changeKey(apiKey);
      setApiKeyError(t("api.apiKeyStorageFailed"));
      setApiKeyNotice(undefined);
      return;
    }

    if (normalizedKey === apiKey) void taskSession.changeKey(normalizedKey);

    setApiKeyDraft(undefined);
    setApiKeyError(undefined);
    setApiKeyNotice(t("apiKey.saved"));
  }

  function handleApiKeyClear() {
    keyEpochRef.current += 1;
    keySnapshotRef.current = "";
    taskSession.clear();
    submitAbortRef.current?.abort();
    const cleared = clearStoredSeedanceApiKey();
    setApiKeyDraft(undefined);
    setTask({ taskId: "", status: "idle" });
    setRestoredTask(false);
    setApiKeyError(cleared ? undefined : t("api.apiKeyStorageFailed"));
    setApiKeyNotice(cleared ? t("apiKey.cleared") : undefined);
  }

  const isGenerating = task.status === "submitting" || task.status === "queued" || task.status === "processing";
  const durationProgress = (
    (effectiveDuration - selectedProfile.minDuration)
    / (selectedProfile.maxDuration - selectedProfile.minDuration)
  ) * 100;
  const referenceImagesReady = referenceImagesReadyForGeneration(referenceImages);
  const modeHint = t(modeGuidance.key, modeGuidance.params);
  const canSubmit = Boolean(
    prompt.trim()
    && !isGenerating
    && task.status !== "paused"
    && isOnline
    && referenceImagesReady
    && apiKey
    && !modeGuidance.isError
    && !requestValidationError
    && requestSnapshot,
  );

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
    if (!canSubmit || !requestController || !resolvedTarget) {
      if (!apiKey) {
        setApiKeyError(t("api.apiKeyRequired"));
      }
      if (modeGuidance.isError) {
        setReferenceError(modeHint);
      }
      if (requestValidationError) {
        setTask({ taskId: "", status: "failed", error: requestValidationError });
      }
      return;
    }
    const normalizedKey = apiKey.trim();
    const keyEpoch = keyEpochRef.current;
    taskSession.clear();
    setRestoredTask(false);
    setTask({ taskId: "", status: "submitting" });
    const controller = new AbortController();
    submitAbortRef.current = controller;
    const isCurrentSubmission = () => (
      isMountedRef.current
      && !controller.signal.aborted
      && keyEpochRef.current === keyEpoch
      && readStoredSeedanceApiKey() === normalizedKey
    );
    try {
      let apiKeyFingerprint: string;
      try {
        apiKeyFingerprint = await fingerprintSeedanceApiKey(normalizedKey);
      } catch {
        throw new Error(t("api.apiKeyFingerprintUnavailable"));
      }
      if (!isCurrentSubmission()) return;
      const response = await fetch(
        "/api/generate",
        requestController.buildRequestInit(normalizedKey, controller.signal),
      );
      const payload = (await response.json()) as { taskId?: string } & ApiErrorBody;
      if (!isCurrentSubmission()) return;
      if (!response.ok || !payload.taskId) {
        throw new Error(localizeApiError(payload, "api.createFailed"));
      }
      const persisted = await taskSession.startCreated({
        taskId: payload.taskId,
        status: "queued",
        createdAt: getCurrentTimestamp(),
        apiKeyFingerprint,
        ...buildActiveTaskPersistenceFields(resolvedTarget, {
          duration: effectiveDuration,
          resolution: effectiveResolution,
          aspectRatio: effectiveAspectRatio,
        }),
      }, normalizedKey);
      if (!persisted && isCurrentSubmission()) {
        setTask({ taskId: payload.taskId, status: "failed", error: t("api.taskStorageFailed") });
      }
    } catch (error) {
      if (!isCurrentSubmission()) return;
      setTask({
        taskId: "",
        status: "failed",
        error: error instanceof Error ? error.message : t("api.createFailed"),
      });
    } finally {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
    }
  }

  return (
    <main className="studio-shell app-shell has-mobile-action text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1320px]">
        <header className="studio-topbar mb-9 flex items-center justify-between gap-4 pb-5 sm:mb-12">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center" aria-hidden="true">
              <Image
                src="/icons/icon-192.png"
                alt=""
                width={36}
                height={36}
                className="size-9 object-contain"
                priority
              />
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
        <TaskRecoveryNotice
          restored={restoredTask}
          pauseReason={task.pauseReason}
          taskId={task.taskId}
          retrying={task.retrying}
        />

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

              <div className="studio-model-row px-5 py-4 sm:px-7">
                <ModelTargetControls
                  selection={modelTargetState.selection}
                  customEndpoint={modelTargetState.customEndpoint}
                  customProfile={modelTargetState.customProfile}
                  disabled={isGenerating}
                  error={modelTargetState.selection === "custom-endpoint" && !resolvedTarget
                    ? t("err.customEndpointInvalid")
                    : undefined}
                  onSelectionChange={(selection) => handleModelTargetChange({
                    ...modelTargetState,
                    selection,
                  })}
                  onEndpointChange={(customEndpoint) => handleModelTargetChange({
                    ...modelTargetState,
                    customEndpoint,
                  })}
                  onProfileChange={(customProfile) => handleModelTargetChange({
                    ...modelTargetState,
                    customProfile,
                  })}
                />
                <ControlAdjustmentNotice visible={controlsAdjusted || targetView.adjusted} />
              </div>

              <div className="studio-form-section border-t border-[var(--line)]">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="studio-panel-title">{t("output.heading")}</h2>
                  <span className="studio-index">02</span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label={t("field.resolution")} value={effectiveResolution} onChange={(value) => {
                    setRequestedControls({
                      ...requestedControlsRef.current,
                      resolution: value as typeof resolution,
                    });
                    setControlsAdjusted(false);
                  }} disabled={isGenerating} options={selectedProfile.resolutions} />
                  <SelectField label={t("field.aspectRatio")} value={effectiveAspectRatio} onChange={(value) => {
                    setRequestedControls({
                      ...requestedControlsRef.current,
                      aspectRatio: value as typeof aspectRatio,
                    });
                    setControlsAdjusted(false);
                  }} disabled={isGenerating} options={modeCapability.aspectRatios} />
                </div>

                {shouldShow4KWarning(selectedProfile.id, effectiveResolution) && (
                  <p className="mt-3 text-xs leading-5 text-amber-700" role="status">
                    {t("warning.4kPreview")}
                  </p>
                )}

                <label className="mt-5 block" htmlFor="video-duration">
                  <span className="mb-3 flex items-center justify-between gap-4">
                    <span className="studio-label">{t("field.duration")}</span>
                    <span className="studio-value">{t("duration.value", { n: effectiveDuration })}</span>
                  </span>
                  <input
                    id="video-duration"
                    className="studio-range"
                    type="range"
                    min={selectedProfile.minDuration}
                    max={selectedProfile.maxDuration}
                    step={1}
                    value={effectiveDuration}
                    style={{ "--range-progress": `${durationProgress}%` } as CSSProperties}
                    onInput={(event) => {
                      setRequestedControls({
                        ...requestedControlsRef.current,
                        duration: Number(event.currentTarget.value),
                      });
                      setControlsAdjusted(false);
                    }}
                    disabled={isGenerating}
                    aria-label={t("field.duration")}
                    aria-valuetext={t("duration.value", { n: effectiveDuration })}
                  />
                  <span className="mt-2 flex justify-between text-[11px] text-[var(--text-3)]"><span>{t("duration.min", { n: selectedProfile.minDuration })}</span><span>{t("duration.max", { n: selectedProfile.maxDuration })}</span></span>
                </label>

                <div className="mt-5">
                  <SelectField label={t("field.generationMode")} value={generationMode} onChange={(value) => {
                    applyControlProfile(selectedProfile, value as GenerationMode);
                  }} disabled={isGenerating} options={[["reference", t("mode.reference")], ["ordered-reference", t("mode.orderedReference")], ["first-frame", t("mode.firstFrame")], ["first-last", t("mode.firstLast")]]} />
                </div>

                <label className="mt-5 flex items-start gap-3 rounded-lg border border-[var(--line)] px-3.5 py-3">
                  <input
                    className="mt-0.5 size-4 accent-[var(--text)]"
                    type="checkbox"
                    checked={generateAudio}
                    onChange={(event) => setGenerateAudio(event.target.checked)}
                    disabled={isGenerating}
                  />
                  <span>
                    <span className="studio-label block">{t("field.generateAudio")}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-3)]">{t("audio.hint")}</span>
                  </span>
                </label>

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
                    <SelectField label={`${t("field.camera")} · ${t("control.promptAssisted")}`} value={cameraMode} onChange={(value) => setCameraMode(value as CameraMode)} disabled={isGenerating} options={[["auto", t("camera.auto")], ["locked", t("camera.locked")], ["push-in", t("camera.push-in")], ["pull-back", t("camera.pull-back")]]} />
                    <SelectField label={`${t("field.motion")} · ${t("control.promptAssisted")}`} value={motionLevel} onChange={(value) => setMotionLevel(value as MotionLevel)} disabled={isGenerating} options={[["auto", t("motion.auto")], ["low", t("motion.low")], ["medium", t("motion.medium")], ["high", t("motion.high")]]} />
                    <SelectField label={`${t("field.consistency")} · ${t("control.promptAssisted")}`} value={consistencyLevel} onChange={(value) => setConsistencyLevel(value as ConsistencyLevel)} disabled={isGenerating} options={[["normal", t("consistency.normal")], ["high", t("consistency.high")], ["very-high", t("consistency.very-high")]]} />
                  </div>
                </div>

                {requestSnapshot && <FinalPromptPreview snapshot={requestSnapshot} />}
                {requestValidationError && (
                  <p className="mt-3 text-xs text-red-600" role="alert">{requestValidationError}</p>
                )}
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

                <p
                  className={`mt-3 text-xs leading-5 ${modeGuidance.isError ? "text-red-600" : "text-[var(--text-3)]"}`}
                  role={modeGuidance.isError ? "alert" : undefined}
                >
                  {modeHint}
                </p>
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
                  disabled={!canSubmit}
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
                    {isGenerating ? <LoaderCircle className="size-6 animate-spin" /> : task.status === "failed" || task.status === "paused" ? <CircleAlert className="size-6" /> : <Play className="ml-0.5 size-6" />}
                  </div>
                  <p className="mt-5 text-sm font-medium text-[var(--text)]">
                    {task.status === "idle" && t("state.idle.title")}
                    {task.status === "submitting" && t("state.submitting.title")}
                    {task.status === "queued" && t("state.queued.title")}
                    {task.status === "processing" && t("state.processing.title")}
                    {task.status === "paused" && t("state.paused.title")}
                    {task.status === "failed" && t("state.failed.title")}
                  </p>
                  <p className="mt-2 max-w-xs text-center text-xs leading-5 text-[var(--text-3)]">
                    {task.status === "idle" && t("state.idle.desc")}
                    {isGenerating && <GeneratingStateDescription error={task.error} />}
                    {task.status === "paused" && t(`task.pause.${task.pauseReason ?? "invalid-response"}`)}
                    {task.status === "failed" && (
                      <>
                        {task.error ?? (task.errorCode ? t(task.errorCode) : t("api.queryFailed"))}
                        {task.taskId ? <span className="mt-2 block break-all">{t("task.id")}: {task.taskId}</span> : null}
                      </>
                    )}
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

type ModelTargetControlsProps = {
  selection: UiModelSelection;
  customEndpoint: string;
  customProfile: OfficialSeedanceModelId;
  disabled: boolean;
  error?: string;
  onSelectionChange: (selection: UiModelSelection) => void;
  onEndpointChange: (endpoint: string) => void;
  onProfileChange: (profile: OfficialSeedanceModelId) => void;
};

export function ModelTargetControls({
  selection,
  customEndpoint,
  customProfile,
  disabled,
  error,
  onSelectionChange,
  onEndpointChange,
  onProfileChange,
}: ModelTargetControlsProps) {
  const { t } = useI18n();
  const modelOptions = [
    ...officialSeedanceModelIds.map((id) => {
      const profile = getSeedanceModelProfile(id)!;
      return [id, `${profile.label} · ${id}`] as const;
    }),
    ["custom-endpoint", t("model.customEndpoint")] as const,
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="studio-model-icon flex size-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
          <Film className="size-4" strokeWidth={1.6} />
        </div>
        <div>
          <p className="studio-label">{t("model.configured")}</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">{t("model.chip")}</p>
        </div>
      </div>
      <SelectField
        label={t("model.select")}
        value={selection}
        onChange={(value) => onSelectionChange(value as UiModelSelection)}
        disabled={disabled}
        options={modelOptions}
      />
      {selection === "custom-endpoint" && (
        <div className="mt-4 grid gap-4">
          <label className="block">
            <span className="studio-label mb-2 block">{t("model.endpointLabel")}</span>
            <input
              className="studio-textarea min-h-0 w-full py-3"
              type="text"
              value={customEndpoint}
              onChange={(event) => onEndpointChange(event.target.value)}
              placeholder={t("model.endpointPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
            />
          </label>
          <SelectField
            label={t("model.profileLabel")}
            value={customProfile}
            onChange={(value) => onProfileChange(value as OfficialSeedanceModelId)}
            disabled={disabled}
            options={seedanceModelProfiles.map((profile) => [
              profile.id,
              `${profile.label} · ${profile.id}`,
            ] as const)}
          />
          <p className="text-xs leading-5 text-[var(--text-3)]">{t("model.profileHelp")}</p>
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function ControlAdjustmentNotice({ visible }: { visible: boolean }) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <p className="mt-3 text-xs leading-5 text-amber-700" role="status">
      {t("notice.controlsAdjusted")}
    </p>
  );
}

export function FinalPromptPreview({
  snapshot,
}: {
  snapshot: GenerationRequestSnapshot;
}) {
  const { t } = useI18n();
  return (
    <details className="studio-details mt-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="text-sm text-[var(--text)]">{t("prompt.previewTitle")}</span>
        <span className="studio-counter">{snapshot.finalPrompt.length} / {maxFinalPromptLength}</span>
      </summary>
      <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs leading-5 text-[var(--text-2)]">
        {snapshot.finalPrompt || t("prompt.previewEmpty")}
      </pre>
    </details>
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
    : status === "paused"
      ? t("submit.paused")
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

export function TaskRecoveryNotice({
  restored,
  pauseReason,
  taskId,
  retrying,
}: {
  restored: boolean;
  pauseReason?: RecoveryPauseReason;
  taskId?: string;
  retrying?: boolean;
}) {
  const { t } = useI18n();
  if (!restored) return null;

  return (
    <div className="studio-network-status mb-6 flex items-center gap-2" role="status">
      {pauseReason
        ? <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
        : <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
      <span>
        {pauseReason ? t(`task.pause.${pauseReason}`) : retrying ? t("task.retrying") : t("task.restored")}
        {pauseReason && taskId ? ` · ${t("task.id")}: ${taskId}` : ""}
      </span>
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
  if (status === "paused") return <span className="studio-task-badge is-error"><CircleAlert className="size-3" /> {t("badge.paused")}</span>;
  if (status === "submitting" || status === "queued" || status === "processing") return <span className="studio-task-badge is-active"><span className="studio-status-dot" /> {t("badge.active")}</span>;
  return <span className="studio-task-badge">{t("badge.idle")}</span>;
}

function createReferenceImageId(index: number): string {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
}
