import { Buffer } from "node:buffer";

import { requireApiAuth } from "@/lib/auth/guard";
import { enforceGenerationRateLimit } from "@/lib/security/rate-limit";
import {
  aspectRatioOptions,
  defaultDuration,
  defaultSeedanceModel,
  getSeedanceModel,
  maxDuration,
  minDuration,
  modelSupportsResolution,
  resolutionOptions,
} from "@/lib/video/models";
import { apiError, type ApiErrorBody, type ApiErrorParams } from "@/lib/video/errors";
import { maxFinalPromptLength } from "@/lib/video/prompt-compiler";
import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";
import {
  maxReferenceImageBytes,
  maxReferenceImages,
} from "@/lib/video/reference-image-limits";

export const runtime = "nodejs";

const imageDataUrlPattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function POST(request: Request): Promise<Response> {
  const authError = requireApiAuth(request);
  if (authError) return authError;

  const payload = await parseRequest(request);

  if (!payload) {
    return errorResponse("api.invalidRequest");
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return errorResponse("api.promptRequired");
  }

  if (prompt.length > maxFinalPromptLength) {
    return errorResponse("api.promptTooLong", { n: maxFinalPromptLength });
  }

  const referenceImages = resolveReferenceImages(payload);
  if ("error" in referenceImages) {
    return errorResponse(referenceImages.error.code, referenceImages.error.params);
  }

  const modelResolution = resolveModel(payload.model);
  if ("error" in modelResolution) {
    return errorResponse(modelResolution.error);
  }

  const resolution = resolveOption(
    payload.resolution,
    resolutionOptions,
    "720p",
    "api.resolutionInvalid",
  );
  if ("error" in resolution) {
    return errorResponse(resolution.error);
  }

  if (!modelSupportsResolution(modelResolution.model, resolution.value)) {
    return errorResponse("api.resolutionUnsupportedByModel");
  }

  const aspectRatio = resolveOption(
    payload.aspectRatio,
    aspectRatioOptions,
    "16:9",
    "api.aspectInvalid",
  );
  if ("error" in aspectRatio) {
    return errorResponse(aspectRatio.error);
  }

  const duration = resolveDuration(payload.duration);
  if ("error" in duration) {
    return errorResponse(duration.error.code, duration.error.params);
  }

  const rateLimitError = enforceGenerationRateLimit(request);
  if (rateLimitError) return rateLimitError;

  try {
    const task = await new SeedanceProvider().createTask({
      provider: "seedance",
      model: modelResolution.model,
      prompt,
      resolution: resolution.value,
      aspectRatio: aspectRatio.value,
      duration: duration.value,
      referenceImageUrls: referenceImages.urls,
    });

    return Response.json(task);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      return providerErrorResponse(error);
    }

    return errorResponse("api.createFailed", undefined, 502);
  }
}

async function parseRequest(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await request.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function validateReferenceImage(value: unknown): string | null {
  if (typeof value !== "string") {
    return "api.refInvalidFormat";
  }

  const match = imageDataUrlPattern.exec(value);
  if (!match) {
    return "api.refUnsupportedType";
  }

  const base64 = match[2];
  if (base64.length % 4 !== 0) {
    return "api.refInvalidFormat";
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = (base64.length * 3) / 4 - padding;

  if (byteLength > maxReferenceImageBytes) {
    return "api.refTooLargeSingle";
  }

  const imageBytes = Buffer.from(base64, "base64");
  return hasMatchingImageSignature(match[1], imageBytes)
    ? null
    : "api.refInvalidContent";
}

function resolveReferenceImages(
  payload: Record<string, unknown>,
): { urls: string[] } | { error: ApiErrorBody } {
  const uploadedUrls = payload.referenceImageUrls;
  if (uploadedUrls !== undefined) {
    if (!Array.isArray(uploadedUrls) || uploadedUrls.some((item) => typeof item !== "string")) {
      return { error: apiError("api.refInvalidUrl") };
    }

    if (uploadedUrls.length > maxReferenceImages) {
      return { error: apiError("api.refTooMany", { n: maxReferenceImages }) };
    }

    if (uploadedUrls.some((url) => !isHttpsUrl(url))) {
      return { error: apiError("api.refInvalidUrl") };
    }

    return { urls: uploadedUrls };
  }

  const value =
    payload.referenceImageDataUrls ??
    (payload.referenceImageDataUrl === undefined ? [] : [payload.referenceImageDataUrl]);

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { error: apiError("api.refInvalidFormat") };
  }

  if (value.length > maxReferenceImages) {
    return { error: apiError("api.refTooMany", { n: maxReferenceImages }) };
  }

  let totalBytes = 0;
  for (const image of value) {
    const imageError = validateReferenceImage(image);
    if (imageError) {
      return { error: apiError(imageError) };
    }

    totalBytes += dataUrlByteLength(image);
  }

  if (totalBytes > maxReferenceImageBytes) {
    return { error: apiError("api.refTooLargeTotal") };
  }

  return { urls: value };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function dataUrlByteLength(value: string): number {
  const base64 = imageDataUrlPattern.exec(value)?.[2] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function resolveModel(value: unknown): { model: string } | { error: string } {
  if (value !== undefined && typeof value !== "string") {
    return { error: "api.modelUnsupported" };
  }

  const modelId = value?.trim() || defaultSeedanceModel();
  const model = getSeedanceModel(modelId);

  if (!model) {
    return { error: "api.modelUnsupported" };
  }

  return { model: model.id };
}

function resolveDuration(value: unknown): { value: number } | { error: ApiErrorBody } {
  const duration = value === undefined ? defaultDuration : value;

  if (
    typeof duration !== "number" ||
    !Number.isInteger(duration) ||
    duration < minDuration ||
    duration > maxDuration
  ) {
    return {
      error: apiError("api.durationInvalid", { min: minDuration, max: maxDuration }),
    };
  }

  return { value: duration };
}

function resolveOption<T extends string | number>(
  value: unknown,
  options: readonly T[],
  fallback: T,
  error: string,
): { value: T } | { error: string } {
  if (value === undefined) {
    return { value: fallback };
  }

  return options.includes(value as T) ? { value: value as T } : { error };
}

function hasMatchingImageSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === "jpeg") {
    return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }

  return (
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  );
}

function errorResponse(code: string, params?: ApiErrorParams, status = 400): Response {
  return Response.json(apiError(code, params), { status });
}

function providerErrorResponse(error: VideoProviderError): Response {
  return Response.json(
    apiError(error.code, error.params, error.detail),
    { status: error.statusCode },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
