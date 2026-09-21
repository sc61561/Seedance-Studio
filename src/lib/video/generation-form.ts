import type { SeedanceModelSettings } from "@/lib/client/model-settings-storage";
import {
  defaultSeedanceModel,
  getSeedanceModelProfile,
  resolveSeedanceTarget,
  type AspectRatio,
  type GenerationMode,
  type OfficialSeedanceModelId,
  type Resolution,
  type ResolvedSeedanceTarget,
  type SeedanceModelProfile,
} from "@/lib/video/models";
import { maxReferenceImages } from "@/lib/video/reference-image-limits";
import type { PersistedVideoTask } from "@/lib/video/task-storage";

export type UiModelSelection = OfficialSeedanceModelId | "custom-endpoint";

export type UiModelTargetState = {
  selection: UiModelSelection;
  customEndpoint: string;
  customProfile: OfficialSeedanceModelId;
};

export type GenerationControlState = {
  duration: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  generationMode: GenerationMode;
};

export type GenerationModeGuidance = {
  isError: boolean;
  key: string;
  params: { min: number; max: number; n: number };
};

export function buildGenerationTargetView<TImage>(
  state: UiModelTargetState,
  requestedControls: GenerationControlState,
  referenceImages: TImage[],
): {
  resolvedTarget: ResolvedSeedanceTarget | undefined;
  profile: SeedanceModelProfile;
  controls: GenerationControlState;
  adjusted: boolean;
  referenceImages: TImage[];
} {
  const settings = getModelSettingsForUiSelection(state);
  const resolvedTarget = settings
    ? resolveSeedanceTarget(settings.model, settings.modelProfile)
    : undefined;
  const profile = state.selection === "custom-endpoint"
    ? getSeedanceModelProfile(state.customProfile)
    : getSeedanceModelProfile(state.selection);
  const selectedProfile = profile ?? getSeedanceModelProfile(defaultSeedanceModel())!;
  const adjustment = adjustGenerationControls(requestedControls, selectedProfile);

  return {
    resolvedTarget,
    profile: selectedProfile,
    controls: adjustment.controls,
    adjusted: adjustment.adjusted,
    referenceImages,
  };
}

export function buildActiveTaskPersistenceFields(
  target: ResolvedSeedanceTarget,
  controls: Pick<GenerationControlState, "resolution" | "aspectRatio" | "duration">,
): {
  model: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  duration: number;
} {
  return {
    model: target.model,
    resolution: controls.resolution,
    aspectRatio: controls.aspectRatio,
    duration: controls.duration,
  };
}

export function getRecoveredTaskPresentation(
  task: PersistedVideoTask,
): Pick<PersistedVideoTask, "taskId" | "status"> {
  return {
    taskId: task.taskId,
    status: task.status,
  };
}

export function adjustGenerationControls(
  controls: GenerationControlState,
  profile: SeedanceModelProfile,
): { controls: GenerationControlState; adjusted: boolean } {
  const duration = Number.isInteger(controls.duration)
    ? Math.min(profile.maxDuration, Math.max(profile.minDuration, controls.duration))
    : profile.defaultDuration;
  const resolution = profile.resolutions.includes(controls.resolution)
    ? controls.resolution
    : profile.resolutions.includes("720p")
      ? "720p"
      : profile.resolutions[0];
  const allowedRatios = profile.modeCapabilities[controls.generationMode].aspectRatios;
  const aspectRatio = allowedRatios.includes(controls.aspectRatio)
    ? controls.aspectRatio
    : allowedRatios.includes("16:9")
      ? "16:9"
      : allowedRatios[0];
  const next = {
    duration,
    resolution,
    aspectRatio,
    generationMode: controls.generationMode,
  };

  return {
    controls: next,
    adjusted: duration !== controls.duration
      || resolution !== controls.resolution
      || aspectRatio !== controls.aspectRatio,
  };
}

export function getGenerationModeGuidance(
  profile: SeedanceModelProfile,
  generationMode: GenerationMode,
  referenceImageCount: number,
): GenerationModeGuidance {
  const generalCap = Math.min(maxReferenceImages, profile.maxGeneralReferenceImages);
  const ranges: Record<GenerationMode, { min: number; max: number; hint: string; error: string }> = {
    reference: {
      min: 0,
      max: generalCap,
      hint: "hint.referenceRange",
      error: "err.referenceRange",
    },
    "ordered-reference": {
      min: 2,
      max: generalCap,
      hint: "hint.orderedReferenceRange",
      error: "err.orderedReferenceCount",
    },
    "first-frame": {
      min: 1,
      max: 1,
      hint: "hint.firstFrameCount",
      error: "err.firstFrameCount",
    },
    "first-last": {
      min: 2,
      max: 2,
      hint: "hint.firstLastCount",
      error: "err.firstLastCount",
    },
  };
  const range = ranges[generationMode];
  const isError = referenceImageCount < range.min || referenceImageCount > range.max;

  return {
    isError,
    key: isError ? range.error : range.hint,
    params: { min: range.min, max: range.max, n: range.max },
  };
}

export function shouldShow4KWarning(
  modelProfile: OfficialSeedanceModelId,
  resolution: Resolution,
): boolean {
  return modelProfile === "doubao-seedance-2-0-260128" && resolution === "4k";
}

export function getUiModelSelection(
  settings: SeedanceModelSettings | undefined,
): UiModelTargetState {
  if (settings) {
    const resolved = resolveSeedanceTarget(settings.model, settings.modelProfile);
    if (resolved?.isCustomEndpoint) {
      return {
        selection: "custom-endpoint",
        customEndpoint: resolved.model,
        customProfile: resolved.modelProfile,
      };
    }
    if (resolved) {
      return {
        selection: resolved.modelProfile,
        customEndpoint: "",
        customProfile: defaultSeedanceModel(),
      };
    }
  }

  return {
    selection: defaultSeedanceModel(),
    customEndpoint: "",
    customProfile: defaultSeedanceModel(),
  };
}

export function getModelSettingsForUiSelection(
  state: UiModelTargetState,
): SeedanceModelSettings | undefined {
  if (state.selection !== "custom-endpoint") {
    return getSeedanceModelProfile(state.selection)
      ? { model: state.selection }
      : undefined;
  }

  const resolved = resolveSeedanceTarget(state.customEndpoint, state.customProfile);
  if (!resolved?.isCustomEndpoint) return undefined;
  return { model: resolved.model, modelProfile: resolved.modelProfile };
}
