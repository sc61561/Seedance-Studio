/**
 * The capability registry is shared by the browser and the API route. Keep
 * the values in this file as the wire contract; UI labels belong in `label`.
 *
 * Source: https://www.volcengine.com/docs/82379/1520757?lang=zh
 * Verified: 2026-09-20
 */

export const resolutionOptions = ["480p", "720p", "1080p", "4k"] as const;
export const aspectRatioOptions = [
  "adaptive",
  "21:9",
  "16:9",
  "9:16",
  "4:3",
  "1:1",
  "3:4",
] as const;

export const minDuration = 2;
export const maxDuration = 30;
export const defaultDuration = 5;

export type Resolution = (typeof resolutionOptions)[number];
export type AspectRatio = (typeof aspectRatioOptions)[number];
export type Duration = number;

export type OfficialSeedanceModelId =
  | "doubao-seedance-2-5-260628"
  | "doubao-seedance-2-0-260128"
  | "doubao-seedance-2-0-fast-260128"
  | "doubao-seedance-2-0-mini-260615";

export type GenerationMode =
  | "reference"
  | "ordered-reference"
  | "first-frame"
  | "first-last";

export const officialSeedanceModelIds = [
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
] as const satisfies readonly OfficialSeedanceModelId[];

export const seedanceCapabilitySourceUrl =
  "https://www.volcengine.com/docs/82379/1520757?lang=zh";
export const seedanceCapabilityVerifiedAt = "2026-09-20" as const;

export type SeedanceModelProfile = {
  id: OfficialSeedanceModelId;
  /** The official ID sent to Ark when this profile is selected. */
  model: OfficialSeedanceModelId;
  /** Human-readable label; never use this value as the request model. */
  label: string;
  resolutions: readonly Resolution[];
  aspectRatios: readonly AspectRatio[];
  modeCapabilities: SeedanceModeCapabilities;
  minDuration: number;
  maxDuration: number;
  defaultDuration: number;
  /** Upstream general-reference image cap; the product may impose a lower cap. */
  maxGeneralReferenceImages: number;
  /** Alias useful to consumers that do not distinguish reference categories. */
  maxReferenceImages: number;
  supports4K: boolean;
  sourceUrl: typeof seedanceCapabilitySourceUrl;
  verifiedAt: typeof seedanceCapabilityVerifiedAt;
};

export type SeedanceModeCapability = {
  aspectRatios: readonly AspectRatio[];
  minReferenceImages: number;
  maxReferenceImages: number;
};

export type SeedanceModeCapabilities = {
  [Mode in GenerationMode]: SeedanceModeCapability;
};

const allAspectRatios = aspectRatioOptions;
const adaptiveOnlyAspectRatios = ["adaptive"] as const satisfies readonly AspectRatio[];

function modeCapabilitiesFor(
  maxGeneralReferenceImages: number,
  nativeFrameAdaptiveOnly: boolean,
): SeedanceModeCapabilities {
  const nativeFrameAspectRatios = nativeFrameAdaptiveOnly
    ? adaptiveOnlyAspectRatios
    : allAspectRatios;

  return {
    reference: {
      aspectRatios: allAspectRatios,
      minReferenceImages: 0,
      maxReferenceImages: maxGeneralReferenceImages,
    },
    "ordered-reference": {
      aspectRatios: allAspectRatios,
      minReferenceImages: 2,
      maxReferenceImages: maxGeneralReferenceImages,
    },
    "first-frame": {
      aspectRatios: nativeFrameAspectRatios,
      minReferenceImages: 1,
      maxReferenceImages: 1,
    },
    "first-last": {
      aspectRatios: nativeFrameAspectRatios,
      minReferenceImages: 2,
      maxReferenceImages: 2,
    },
  };
}

export const seedanceModelProfiles = [
  {
    id: "doubao-seedance-2-5-260628",
    model: "doubao-seedance-2-5-260628",
    label: "Seedance 2.5",
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: allAspectRatios,
    modeCapabilities: modeCapabilitiesFor(30, true),
    minDuration: 4,
    maxDuration: 30,
    defaultDuration: 5,
    maxGeneralReferenceImages: 30,
    maxReferenceImages: 30,
    supports4K: false,
    sourceUrl: seedanceCapabilitySourceUrl,
    verifiedAt: seedanceCapabilityVerifiedAt,
  },
  {
    id: "doubao-seedance-2-0-260128",
    model: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    resolutions: ["480p", "720p", "1080p", "4k"],
    aspectRatios: allAspectRatios,
    modeCapabilities: modeCapabilitiesFor(9, false),
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    maxGeneralReferenceImages: 9,
    maxReferenceImages: 9,
    supports4K: true,
    sourceUrl: seedanceCapabilitySourceUrl,
    verifiedAt: seedanceCapabilityVerifiedAt,
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    model: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    resolutions: ["480p", "720p"],
    aspectRatios: allAspectRatios,
    modeCapabilities: modeCapabilitiesFor(9, false),
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    maxGeneralReferenceImages: 9,
    maxReferenceImages: 9,
    supports4K: false,
    sourceUrl: seedanceCapabilitySourceUrl,
    verifiedAt: seedanceCapabilityVerifiedAt,
  },
  {
    id: "doubao-seedance-2-0-mini-260615",
    model: "doubao-seedance-2-0-mini-260615",
    label: "Seedance 2.0 Mini",
    resolutions: ["480p", "720p"],
    aspectRatios: allAspectRatios,
    modeCapabilities: modeCapabilitiesFor(9, false),
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    maxGeneralReferenceImages: 9,
    maxReferenceImages: 9,
    supports4K: false,
    sourceUrl: seedanceCapabilitySourceUrl,
    verifiedAt: seedanceCapabilityVerifiedAt,
  },
] as const satisfies readonly SeedanceModelProfile[];

export const seedanceModels = seedanceModelProfiles;
export const seedanceCapabilityRegistry = seedanceModelProfiles;

export type SeedanceModelId = OfficialSeedanceModelId;

export function defaultSeedanceModel(): OfficialSeedanceModelId {
  return "doubao-seedance-2-5-260628";
}

export function getSeedanceModelProfile(
  model: string,
): SeedanceModelProfile | undefined {
  const normalized = typeof model === "string" ? model.trim() : "";
  return seedanceModelProfiles.find((item) => item.id === normalized);
}

export function getSeedanceModel(model: string): SeedanceModelProfile | undefined {
  return getSeedanceModelProfile(model);
}

export type ResolvedSeedanceTarget = {
  /** The exact model value sent in the Ark request. */
  model: string;
  /** The official capability profile used for local/server validation. */
  modelProfile: OfficialSeedanceModelId;
  profile: SeedanceModelProfile;
  isCustomEndpoint: boolean;
};

const customEndpointPattern = /^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Resolve an official model or a custom Ark Endpoint to one capability
 * profile. Official IDs own their profile; custom Endpoints must opt into a
 * known profile explicitly. Returning `undefined` keeps invalid client input
 * from becoming an upstream request.
 */
export function resolveSeedanceTarget(
  model: string,
  modelProfile?: string,
): ResolvedSeedanceTarget | undefined {
  if (typeof model !== "string") return undefined;

  const normalizedModel = model.trim();
  const normalizedProfile = typeof modelProfile === "string"
    ? modelProfile.trim()
    : undefined;
  const officialProfile = getSeedanceModelProfile(normalizedModel);

  if (officialProfile) {
    if (normalizedProfile !== undefined && normalizedProfile !== officialProfile.id) {
      return undefined;
    }

    return {
      model: officialProfile.id,
      modelProfile: officialProfile.id,
      profile: officialProfile,
      isCustomEndpoint: false,
    };
  }

  if (!customEndpointPattern.test(normalizedModel) || !normalizedProfile) {
    return undefined;
  }

  const profile = getSeedanceModelProfile(normalizedProfile);
  if (!profile) return undefined;

  return {
    model: normalizedModel,
    modelProfile: profile.id,
    profile,
    isCustomEndpoint: true,
  };
}

export type SeedanceSelection = {
  duration?: unknown;
  resolution?: unknown;
  aspectRatio?: unknown;
  /** `ratio` is accepted as an API-facing alias for `aspectRatio`. */
  ratio?: unknown;
  generationMode?: unknown;
  referenceImageCount?: unknown;
};

export type SeedanceSelectionValidation =
  | { ok: true }
  | {
    ok: false;
    code:
      | "durationInvalid"
      | "resolutionUnsupported"
      | "aspectRatioUnsupported"
      | "generationModeInvalid"
      | "referenceCountInvalid";
    field: string;
  };

/** Validate request controls against the one shared model profile. */
export function validateSeedanceSelection(
  profile: SeedanceModelProfile,
  selection: SeedanceSelection,
): SeedanceSelectionValidation {
  const duration = selection.duration === undefined
    ? profile.defaultDuration
    : selection.duration;
  if (
    typeof duration !== "number"
    || !Number.isInteger(duration)
    || duration < profile.minDuration
    || duration > profile.maxDuration
  ) {
    return { ok: false, code: "durationInvalid", field: "duration" };
  }

  const resolution = selection.resolution === undefined ? "720p" : selection.resolution;
  if (
    typeof resolution !== "string"
    || !profile.resolutions.includes(resolution as Resolution)
  ) {
    return { ok: false, code: "resolutionUnsupported", field: "resolution" };
  }

  const generationMode = selection.generationMode ?? "reference";
  if (
    generationMode !== "reference"
    && generationMode !== "ordered-reference"
    && generationMode !== "first-frame"
    && generationMode !== "first-last"
  ) {
    return { ok: false, code: "generationModeInvalid", field: "generationMode" };
  }

  const modeCapability = profile.modeCapabilities[generationMode];
  const aspectRatio = selection.aspectRatio ?? selection.ratio ?? "16:9";
  if (
    typeof aspectRatio !== "string"
    || !modeCapability.aspectRatios.includes(aspectRatio as AspectRatio)
  ) {
    return { ok: false, code: "aspectRatioUnsupported", field: "aspectRatio" };
  }

  const referenceImageCount = selection.referenceImageCount === undefined
    ? 0
    : selection.referenceImageCount;
  if (
    typeof referenceImageCount !== "number"
    || !Number.isInteger(referenceImageCount)
    || referenceImageCount < 0
  ) {
    return { ok: false, code: "referenceCountInvalid", field: "referenceImageCount" };
  }

  const validReferenceCount = referenceImageCount >= modeCapability.minReferenceImages
    && referenceImageCount <= modeCapability.maxReferenceImages;
  if (!validReferenceCount) {
    return { ok: false, code: "referenceCountInvalid", field: "referenceImageCount" };
  }

  return { ok: true };
}

export function modelSupportsResolution(model: string, resolution: string): boolean {
  return Boolean(getSeedanceModelProfile(model)?.resolutions.some((item) => item === resolution));
}
