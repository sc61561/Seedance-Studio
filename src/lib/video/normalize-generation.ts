import { apiError, type ApiErrorBody } from "./errors";
import {
  defaultSeedanceModel,
  getSeedanceModelProfile,
  resolveSeedanceTarget,
  validateSeedanceSelection,
  type GenerationMode,
  type ResolvedSeedanceTarget,
  type SeedanceModelProfile,
} from "./models";
import { maxFinalPromptLength } from "./prompt-compiler";
import { maxReferenceImages } from "./reference-image-limits";

type NormalizedGenerationRequest = {
  prompt: string;
  target: ResolvedSeedanceTarget;
  generationMode: GenerationMode;
  generateAudio: boolean;
  duration: number;
  resolution: string;
  aspectRatio: string;
  referenceImageUrls: string[];
};

export function normalizeGenerationRequest(
  payload: Record<string, unknown>,
  referenceImageUrls: string[],
): { value: NormalizedGenerationRequest } | { error: ApiErrorBody } {
  if (typeof payload.prompt !== "string" || !payload.prompt.trim()) {
    return { error: apiError("api.promptRequired") };
  }
  if (payload.prompt.length > maxFinalPromptLength) {
    return { error: apiError("api.promptTooLong", { n: maxFinalPromptLength }) };
  }

  const target = resolveRequestTarget(payload.model, payload.modelProfile);
  if ("error" in target) return target;

  const referenceImages = { urls: referenceImageUrls };

  const generationMode = hasOwn(payload, "generationMode")
    ? payload.generationMode
    : "reference";
  if (!isGenerationMode(target.value.profile, generationMode)) {
    return { error: apiError("api.generationModeInvalid") };
  }

  const generateAudio = hasOwn(payload, "generateAudio")
    ? payload.generateAudio
    : true;
  if (typeof generateAudio !== "boolean") {
    return { error: apiError("api.generateAudioInvalid") };
  }

  const profile = target.value.profile;
  const modeCapability = profile.modeCapabilities[generationMode];
  if (hasOwn(payload, "aspectRatio") && typeof payload.aspectRatio !== "string") {
    return { error: apiError("api.aspectInvalid") };
  }
  const duration = hasOwn(payload, "duration")
    ? payload.duration
    : profile.defaultDuration;
  const resolution = hasOwn(payload, "resolution")
    ? payload.resolution
    : "720p";
  const aspectRatio = hasOwn(payload, "aspectRatio")
    ? payload.aspectRatio
    : modeCapability.aspectRatios.length === 1
      ? modeCapability.aspectRatios[0]
      : "16:9";

  const generalMode = generationMode === "reference"
    || generationMode === "ordered-reference";
  const generalReferenceCap = Math.min(
    maxReferenceImages,
    profile.maxGeneralReferenceImages,
  );
  if (generalMode && referenceImages.urls.length > generalReferenceCap) {
    return {
      error: apiError("api.refTooMany", { n: generalReferenceCap }),
    };
  }

  const validation = validateSeedanceSelection(profile, {
    duration,
    resolution,
    aspectRatio,
    generationMode,
    referenceImageCount: referenceImages.urls.length,
  });
  if (!validation.ok) {
    if (validation.code === "durationInvalid") {
      return {
        error: apiError("api.durationInvalid", {
          min: profile.minDuration,
          max: profile.maxDuration,
        }),
      };
    }
    if (validation.code === "resolutionUnsupported") {
      return { error: apiError("api.resolutionUnsupportedByModel") };
    }
    if (validation.code === "aspectRatioUnsupported") {
      return { error: apiError("api.aspectInvalid") };
    }
    if (validation.code === "generationModeInvalid") {
      return { error: apiError("api.generationModeInvalid") };
    }

    return { error: apiError("api.referenceCountInvalid") };
  }

  return {
    value: {
      prompt: payload.prompt,
      target: target.value,
      generationMode,
      generateAudio,
      duration: duration as number,
      resolution: resolution as string,
      aspectRatio: aspectRatio as string,
      referenceImageUrls: referenceImages.urls,
    },
  };
}

function resolveRequestTarget(
  rawModel: unknown,
  rawModelProfile: unknown,
): { value: ResolvedSeedanceTarget } | { error: ApiErrorBody } {
  if (rawModel !== undefined && typeof rawModel !== "string") {
    return { error: apiError("api.modelUnsupported") };
  }
  if (rawModelProfile !== undefined && typeof rawModelProfile !== "string") {
    return { error: apiError("api.modelProfileInvalid") };
  }

  const model = typeof rawModel === "string" && rawModel.trim()
    ? rawModel.trim()
    : defaultSeedanceModel();
  const modelProfile = typeof rawModelProfile === "string"
    ? rawModelProfile.trim()
    : undefined;
  const officialProfile = getSeedanceModelProfile(model);

  if (officialProfile) {
    if (modelProfile !== undefined && !getSeedanceModelProfile(modelProfile)) {
      return { error: apiError("api.modelProfileInvalid") };
    }
    if (modelProfile && modelProfile !== officialProfile.id) {
      return { error: apiError("api.modelProfileConflict") };
    }

    const resolved = resolveSeedanceTarget(model, modelProfile || undefined);
    return resolved
      ? { value: resolved }
      : { error: apiError("api.modelUnsupported") };
  }

  const customSyntaxProbe = resolveSeedanceTarget(model, defaultSeedanceModel());
  if (!customSyntaxProbe?.isCustomEndpoint) {
    return { error: apiError("api.modelUnsupported") };
  }
  if (!modelProfile) {
    return { error: apiError("api.clientUpgradeRequired") };
  }
  if (!getSeedanceModelProfile(modelProfile)) {
    return { error: apiError("api.modelProfileInvalid") };
  }

  const resolved = resolveSeedanceTarget(model, modelProfile);
  return resolved
    ? { value: resolved }
    : { error: apiError("api.modelUnsupported") };
}

function isGenerationMode(
  profile: SeedanceModelProfile,
  value: unknown,
): value is GenerationMode {
  return typeof value === "string" && hasOwn(profile.modeCapabilities, value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
