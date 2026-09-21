import type {
  CameraMode,
  ConsistencyLevel,
  MotionLevel,
} from "@/lib/video/prompt-compiler";
import {
  buildFinalPrompt,
} from "@/lib/video/prompt-compiler";
import type {
  AspectRatio,
  GenerationMode,
  Resolution,
  ResolvedSeedanceTarget,
} from "@/lib/video/models";
import { maxGenerationRequestBytes } from "@/lib/video/reference-image-limits";

export type GenerationReferenceImagePayload = {
  referenceImageUrls?: readonly string[];
  referenceImageDataUrls?: readonly string[];
};

export type GenerationRequestSnapshotInput = {
  target: ResolvedSeedanceTarget;
  userPrompt: string;
  generationMode: GenerationMode;
  generateAudio: boolean;
  cameraMode: CameraMode;
  motionLevel: MotionLevel;
  consistencyLevel: ConsistencyLevel;
  duration: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  referenceImagePayload: GenerationReferenceImagePayload;
};

export type GenerationRequestSnapshot = {
  finalPrompt: string;
  payload: Record<string, unknown>;
  body: string;
  byteLength: number;
  exceedsByteLimit: boolean;
};

export type GenerationRequestSnapshotCache = {
  get: (input: GenerationRequestSnapshotInput) => GenerationRequestSnapshot;
};

export type GenerationRequestController = {
  snapshot: GenerationRequestSnapshot;
  buildRequestInit: (apiKey: string, signal?: AbortSignal) => RequestInit;
};

export function createGenerationRequestSnapshotCache(
  build: (input: GenerationRequestSnapshotInput) => GenerationRequestSnapshot = buildGenerationRequestSnapshot,
): GenerationRequestSnapshotCache {
  let previousInput: GenerationRequestSnapshotInput | undefined;
  let previousSnapshot: GenerationRequestSnapshot | undefined;

  return {
    get(input) {
      if (previousInput && previousSnapshot && snapshotInputsEqual(previousInput, input)) {
        return previousSnapshot;
      }

      previousInput = input;
      previousSnapshot = build(input);
      return previousSnapshot;
    },
  };
}

export function createGenerationRequestController(
  cache: GenerationRequestSnapshotCache,
  input: GenerationRequestSnapshotInput,
): GenerationRequestController {
  const snapshot = cache.get(input);

  return {
    snapshot,
    buildRequestInit: (apiKey, signal) => buildGenerationRequestInit(snapshot, apiKey, signal),
  };
}

export function buildGenerationRequestSnapshot(
  input: GenerationRequestSnapshotInput,
): GenerationRequestSnapshot {
  const referenceImageCount = input.referenceImagePayload.referenceImageUrls?.length
    ?? input.referenceImagePayload.referenceImageDataUrls?.length
    ?? 0;
  const finalPrompt = buildFinalPrompt({
    userPrompt: input.userPrompt,
    referenceImageCount,
    generationMode: input.generationMode,
    cameraMode: input.cameraMode,
    motionLevel: input.motionLevel,
    consistencyLevel: input.consistencyLevel,
  });
  const payload = {
    prompt: finalPrompt,
    model: input.target.model,
    ...(input.target.isCustomEndpoint
      ? { modelProfile: input.target.modelProfile }
      : {}),
    generationMode: input.generationMode,
    generateAudio: input.generateAudio,
    duration: input.duration,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    ...input.referenceImagePayload,
  };
  const body = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(body).byteLength;

  return {
    finalPrompt,
    payload,
    body,
    byteLength,
    exceedsByteLimit: byteLength > maxGenerationRequestBytes,
  };
}

export function buildGenerationRequestInit(
  snapshot: GenerationRequestSnapshot,
  apiKey: string,
  signal?: AbortSignal,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seedance-api-key": apiKey,
    },
    signal,
    body: snapshot.body,
  };
}

function snapshotInputsEqual(
  left: GenerationRequestSnapshotInput,
  right: GenerationRequestSnapshotInput,
): boolean {
  return left.target.model === right.target.model
    && left.target.modelProfile === right.target.modelProfile
    && left.target.isCustomEndpoint === right.target.isCustomEndpoint
    && left.userPrompt === right.userPrompt
    && left.generationMode === right.generationMode
    && left.generateAudio === right.generateAudio
    && left.cameraMode === right.cameraMode
    && left.motionLevel === right.motionLevel
    && left.consistencyLevel === right.consistencyLevel
    && left.duration === right.duration
    && left.resolution === right.resolution
    && left.aspectRatio === right.aspectRatio
    && left.referenceImagePayload.referenceImageUrls
      === right.referenceImagePayload.referenceImageUrls
    && left.referenceImagePayload.referenceImageDataUrls
      === right.referenceImagePayload.referenceImageDataUrls;
}
