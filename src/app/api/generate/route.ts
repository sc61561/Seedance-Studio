import { Buffer } from "node:buffer";

import {
  readSeedanceApiKey,
  seedanceApiKeyErrorResponse,
} from "@/lib/security/api-key";
import { enforceGenerationRateLimit } from "@/lib/security/rate-limit";
import { apiError, type ApiErrorBody, type ApiErrorParams } from "@/lib/video/errors";
import {
  defaultSeedanceModel,
  getSeedanceModelProfile,
  resolveSeedanceTarget,
  validateSeedanceSelection,
  type GenerationMode,
  type ResolvedSeedanceTarget,
  type SeedanceModelProfile,
} from "@/lib/video/models";
import { maxFinalPromptLength } from "@/lib/video/prompt-compiler";
import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";
import {
  maxGenerationRequestBytes,
  maxReferenceImageBytes,
  maxReferenceImages,
} from "@/lib/video/reference-image-limits";

export const runtime = "nodejs";

const imageDataUrlPattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const imageSourceFields = [
  "referenceImageUrls",
  "referenceImageDataUrls",
  "referenceImageDataUrl",
] as const;

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

export async function POST(request: Request): Promise<Response> {
  const apiKey = readSeedanceApiKey(request);
  if (!apiKey.ok) return seedanceApiKeyErrorResponse(apiKey);

  const parsed = await parseRequest(request);
  if ("error" in parsed) {
    return errorResponse(parsed.error, undefined, parsed.status);
  }

  const normalized = normalizeRequest(parsed.payload);
  if ("error" in normalized) {
    return Response.json(normalized.error, { status: 400 });
  }

  const rateLimitError = enforceGenerationRateLimit(request);
  if (rateLimitError) return rateLimitError;

  const input = normalized.value;
  try {
    const task = await new SeedanceProvider(apiKey.apiKey).createTask({
      provider: "seedance",
      model: input.target.model,
      modelProfile: input.target.modelProfile,
      prompt: input.prompt,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      duration: input.duration,
      generationMode: input.generationMode,
      generateAudio: input.generateAudio,
      referenceImageUrls: input.referenceImageUrls,
    });

    return Response.json(task);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      return providerErrorResponse(error);
    }

    return errorResponse("api.createFailed", undefined, 502);
  }
}

async function parseRequest(
  request: Request,
): Promise<
  | { payload: Record<string, unknown> }
  | { error: string; status: number }
> {
  const bodyBytes = await readRequestBodyBytes(request);
  if ("error" in bodyBytes) return bodyBytes;

  let rawBody: string;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes.value);
  } catch {
    return { error: "api.invalidRequest", status: 400 };
  }

  try {
    const payload: unknown = JSON.parse(rawBody);
    return isRecord(payload)
      ? { payload }
      : { error: "api.invalidRequest", status: 400 };
  } catch {
    return { error: "api.invalidRequest", status: 400 };
  }
}

async function readRequestBodyBytes(
  request: Request,
): Promise<
  | { value: Uint8Array }
  | { error: string; status: number }
> {
  if (!request.body) {
    return { error: "api.invalidRequest", status: 400 };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { error: "api.invalidRequest", status: 400 };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.byteLength > maxGenerationRequestBytes - totalBytes) {
        chunks.length = 0;
        await cancelAndRelease(reader);
        return { error: "api.requestTooLarge", status: 413 };
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch {
    chunks.length = 0;
    await cancelAndRelease(reader);
    return { error: "api.invalidRequest", status: 400 };
  }

  try {
    reader.releaseLock();
  } catch {
    return { error: "api.invalidRequest", status: 400 };
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { value: bodyBytes };
}

async function cancelAndRelease(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The request is already rejected; cancellation failures must not alter it.
  }
  try {
    reader.releaseLock();
  } catch {
    // Releasing an already-errored stream is best-effort cleanup.
  }
}

function normalizeRequest(
  payload: Record<string, unknown>,
): { value: NormalizedGenerationRequest } | { error: ApiErrorBody } {
  if (typeof payload.prompt !== "string" || !payload.prompt.trim()) {
    return { error: apiError("api.promptRequired") };
  }
  if (payload.prompt.length > maxFinalPromptLength) {
    return { error: apiError("api.promptTooLong", { n: maxFinalPromptLength }) };
  }

  const target = resolveRequestTarget(payload.model, payload.modelProfile);
  if ("error" in target) return target;

  const referenceImages = resolveReferenceImages(payload);
  if ("error" in referenceImages) return referenceImages;

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

function resolveReferenceImages(
  payload: Record<string, unknown>,
): { urls: string[] } | { error: ApiErrorBody } {
  const presentFields = imageSourceFields.filter((field) => hasOwn(payload, field));
  if (presentFields.length > 1) {
    return { error: apiError("api.refSourceConflict") };
  }
  if (presentFields.length === 0) return { urls: [] };

  const field = presentFields[0];
  const value = payload[field];
  if (field === "referenceImageUrls") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return { error: apiError("api.refInvalidUrl") };
    }
    if (value.some((url) => !isHttpsUrl(url))) {
      return { error: apiError("api.refInvalidUrl") };
    }
    return { urls: value };
  }

  const dataUrls = field === "referenceImageDataUrl" ? [value] : value;
  if (!Array.isArray(dataUrls) || dataUrls.some((item) => typeof item !== "string")) {
    return { error: apiError("api.refInvalidFormat") };
  }

  let totalBytes = 0;
  for (const image of dataUrls) {
    const imageError = validateReferenceImage(image);
    if (imageError) return { error: apiError(imageError) };
    totalBytes += dataUrlByteLength(image);
  }
  if (totalBytes > maxReferenceImageBytes) {
    return { error: apiError("api.refTooLargeTotal") };
  }

  return { urls: dataUrls };
}

function validateReferenceImage(value: string): string | null {
  const match = imageDataUrlPattern.exec(value);
  if (!match) return "api.refUnsupportedType";

  const base64 = match[2];
  if (base64.length % 4 !== 0) return "api.refInvalidFormat";

  const byteLength = decodedBase64ByteLength(base64);
  if (byteLength > maxReferenceImageBytes) return "api.refTooLargeSingle";

  const imageBytes = Buffer.from(base64, "base64");
  if (imageBytes.toString("base64") !== base64) {
    return "api.refInvalidFormat";
  }
  return hasMatchingImageSignature(match[1], imageBytes)
    ? null
    : "api.refInvalidContent";
}

function dataUrlByteLength(value: string): number {
  const base64 = imageDataUrlPattern.exec(value)?.[2] ?? "";
  return decodedBase64ByteLength(base64);
}

function decodedBase64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hasMatchingImageSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "png") {
    return bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (mimeType === "jpeg") {
    return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }
  return bytes.subarray(0, 4).equals(Buffer.from("RIFF"))
    && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
}

function isGenerationMode(
  profile: SeedanceModelProfile,
  value: unknown,
): value is GenerationMode {
  return typeof value === "string" && hasOwn(profile.modeCapabilities, value);
}

function errorResponse(code: string, params?: ApiErrorParams, status = 400): Response {
  return Response.json(apiError(code, params), { status });
}

function providerErrorResponse(error: VideoProviderError): Response {
  return Response.json(
    apiError(error.code, error.params, error.detail, error.requestId),
    { status: error.statusCode },
  );
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
