import "server-only";

import { defaultSeedanceModel } from "@/lib/video/models";
import type { GenerationMode } from "@/lib/video/models";
import type { ApiErrorParams } from "@/lib/video/errors";
import type { VideoProvider } from "@/lib/video/provider";
import type {
  CreateVideoInput,
  CreateVideoTaskResult,
  VideoTaskState,
  VideoTaskStatus,
} from "@/lib/video/types";

const arkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3";

type ArkTaskResponse = Record<string, unknown>;
type ArkErrorResponse = Record<string, unknown>;

type ClassifiedUpstreamError = {
  appCode: string;
  upstreamCode?: string;
  detail?: string;
  requestId?: string;
  upstreamCodeMatched: boolean;
};

// Carries a stable error `code` (localized on the client) plus optional params and
// a language-neutral detail label. `message` stays human-readable for server logs.
export class VideoProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number = 502,
    public readonly params?: ApiErrorParams,
    public readonly detail?: string,
    public readonly requestId?: string,
  ) {
    super(code);
    this.name = "VideoProviderError";
  }
}

export class SeedanceProvider implements VideoProvider {
  constructor(private readonly apiKey: string) {}

  async createTask(input: CreateVideoInput): Promise<CreateVideoTaskResult> {
    const model = input.model || defaultSeedanceModel();
    const generationMode = input.generationMode ?? "reference";
    const referenceImageUrls = input.referenceImageUrls?.length
      ? input.referenceImageUrls
      : input.referenceImageUrl
        ? [input.referenceImageUrl]
        : [];

    assertImageCount(generationMode, referenceImageUrls.length);

    const content: Array<Record<string, unknown>> = [
      { type: "text", text: input.prompt },
      ...referenceImageUrls.map((url, index) => ({
        type: "image_url",
        image_url: { url },
        role: imageRole(generationMode, index),
      })),
    ];

    const response = await this.request("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({
        model,
        content,
        ratio: input.aspectRatio ?? "16:9",
        resolution: input.resolution ?? "720p",
        duration: input.duration ?? 5,
        generate_audio: input.generateAudio ?? true,
      }),
    });
    const task = await readJsonRecord(response, "api.createFailed");
    const taskId = nonEmptyString(task.id);
    if (!taskId) {
      throw new VideoProviderError("api.createFailed");
    }

    return { taskId };
  }

  async getTask(taskId: string): Promise<VideoTaskStatus> {
    const response = await this.request(
      `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      { method: "GET" },
    );
    const task = await readJsonRecord(response, "api.queryFailed");
    const status = normalizeStatus(stringValue(task.status));
    const videoUrl = stringValue(recordValue(task.content)?.video_url);
    const normalizedTaskId = nonEmptyString(task.id) ?? taskId;

    if (
      status === "succeeded"
      && (typeof videoUrl !== "string" || !videoUrl.trim())
    ) {
      throw new VideoProviderError("api.providerNoVideoUrl");
    }

    if (status === "failed") {
      const classified = classifyUpstreamError({
        statusCode: response.status,
        payload: task,
        headerRequestId: response.headers.get("x-request-id"),
        headerLogId: response.headers.get("x-tt-logid"),
        apiKey: this.apiKey,
        genericCode: "api.providerGenerationFailed",
      });
      const errorDetail = formatAsyncErrorDetail(classified);

      return {
        taskId: normalizedTaskId,
        status,
        errorCode: classified.appCode,
        ...(errorDetail ? { errorDetail } : {}),
        ...(classified.requestId ? { requestId: classified.requestId } : {}),
      };
    }

    return {
      taskId: normalizedTaskId,
      status,
      ...(status === "succeeded" ? { videoUrl } : {}),
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await fetch(`${arkBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorPayload = recordValue(await response.json().catch(() => null));
        throw errorForResponse(response, errorPayload, this.apiKey);
      }

      return response;
    } catch (error) {
      if (error instanceof VideoProviderError) {
        throw error;
      }

      throw new VideoProviderError("api.providerConnectFailed");
    }
  }
}

function assertImageCount(mode: GenerationMode, count: number): void {
  const valid = mode === "reference"
    || (mode === "ordered-reference" && count >= 2)
    || (mode === "first-frame" && count === 1)
    || (mode === "first-last" && count === 2);

  if (!valid) {
    throw new VideoProviderError("api.referenceCountInvalid", 400);
  }
}

function imageRole(
  mode: GenerationMode,
  index: number,
): "reference_image" | "first_frame" | "last_frame" {
  if (mode === "first-frame") return "first_frame";
  if (mode === "first-last") return index === 0 ? "first_frame" : "last_frame";
  return "reference_image";
}

function normalizeStatus(status: string | undefined): VideoTaskState {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "processing";
    case "succeeded":
      return "succeeded";
    case "failed":
    case "cancelled":
    case "expired":
      return "failed";
    default:
      return "processing";
  }
}

function errorForResponse(
  response: Response,
  payload?: ArkErrorResponse | null,
  apiKey?: string,
): VideoProviderError {
  const classified = classifyUpstreamError({
    statusCode: response.status,
    payload,
    headerRequestId: response.headers.get("x-request-id"),
    headerLogId: response.headers.get("x-tt-logid"),
    apiKey,
    genericCode: "api.providerHttpError",
  });

  if (classified.upstreamCodeMatched) {
    return new VideoProviderError(
      classified.appCode,
      response.status,
      undefined,
      undefined,
      classified.requestId,
    );
  }

  const label = classified.upstreamCode
    ? `HTTP ${response.status}, ${classified.upstreamCode}`
    : `HTTP ${response.status}`;
  return new VideoProviderError(
    classified.appCode,
    response.status,
    { label },
    classified.detail ? `: ${classified.detail}` : "",
    classified.requestId,
  );
}

function classifyUpstreamError({
  statusCode,
  payload,
  headerRequestId,
  headerLogId,
  apiKey,
  genericCode,
}: {
  statusCode: number;
  payload?: ArkErrorResponse | ArkTaskResponse | null;
  headerRequestId?: string | null;
  headerLogId?: string | null;
  apiKey?: string;
  genericCode: string;
}): ClassifiedUpstreamError {
  const upstreamError = recordValue(payload?.error);
  const rawCode = stringValue(upstreamError?.code);
  const normalizedCode = rawCode?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
  const codeCategory = appCodeForUpstreamCode(normalizedCode);
  const fallbackCategory = codeCategory ?? appCodeForHttpStatus(statusCode);
  const upstreamCode = sanitizeUpstreamValue(rawCode, apiKey, 80);
  const detail = sanitizeUpstreamValue(upstreamError?.message, apiKey, 240);
  const requestId = firstSanitizedUpstreamValue([
    payload?.request_id,
    payload?.requestId,
    upstreamError?.request_id,
    upstreamError?.requestId,
    headerRequestId,
    headerLogId,
  ], apiKey, 128);

  return {
    appCode: fallbackCategory ?? genericCode,
    upstreamCode,
    detail,
    requestId,
    upstreamCodeMatched: Boolean(codeCategory),
  };
}

function appCodeForUpstreamCode(code: string): string | undefined {
  if (!code) return undefined;
  if (
    /(?:invalid|missing|expired)(?:api)?key|(?:api)?key(?:invalid|missing|expired)|unauthenticated|unauthorized|authentication/.test(code)
  ) {
    return "api.providerAuthFailed";
  }
  if (/accessdenied|permissiondenied|forbidden|modelpermission|endpointpermission/.test(code)) {
    return "api.providerPermissionDenied";
  }
  if (
    /servicenotopen|closedendpoint|modelidaccessdisabled|(?:model|endpoint)(?:notfound|unavailable|notopen|unsupported|disabled)|(?:notfound|unavailable)(?:model|endpoint)/.test(code)
  ) {
    return "api.providerUnavailable";
  }
  if (/quota|balance|credit|billing|insufficient/.test(code)) {
    return "api.providerQuotaExceeded";
  }
  if (
    /ratelimit|toomany|throttl|busy|overload|serviceunavailable|requestbursttoofast|setlimitexceeded|inflightbatchsizeexceeded/.test(code)
  ) {
    return "api.providerBusy";
  }
  if (/invalidparameter|parameterinvalid|missingparameter|badrequest|validation/.test(code)) {
    return "api.providerInvalidParameter";
  }
  return undefined;
}

function appCodeForHttpStatus(statusCode: number): string | undefined {
  if (statusCode === 401) return "api.providerAuthFailed";
  if (statusCode === 403) return "api.providerPermissionDenied";
  if (statusCode === 429) return "api.providerBusy";
  return undefined;
}

function formatAsyncErrorDetail(error: ClassifiedUpstreamError): string | undefined {
  const detail = [error.upstreamCode, error.detail].filter(Boolean).join(": ");
  return detail ? detail.slice(0, 320) : undefined;
}

function sanitizeUpstreamValue(
  value: unknown,
  apiKey: string | undefined,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let sanitized = value.slice(0, 4_096);

  if (apiKey) {
    sanitized = sanitized.split(apiKey).join("[api key hidden]");
  }

  sanitized = sanitized
    .replace(/Bearer\s+\S+/gi, "Bearer [hidden]");
  sanitized = redactDataUrls(sanitized);
  sanitized = redactSegmentedBase64(sanitized)
    .replace(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/g, "[base64 hidden]")
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g, "[base64 hidden]")
    .replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ")
    .trim();

  return sanitized ? sanitized.slice(0, maxLength) : undefined;
}

function firstSanitizedUpstreamValue(
  values: readonly unknown[],
  apiKey: string | undefined,
  maxLength: number,
): string | undefined {
  for (const value of values) {
    const sanitized = sanitizeUpstreamValue(value, apiKey, maxLength);
    if (sanitized) return sanitized;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const string = stringValue(value)?.trim();
  return string || undefined;
}

function recordValue(value: unknown): ArkTaskResponse | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ArkTaskResponse
    : undefined;
}

async function readJsonRecord(
  response: Response,
  errorCode: string,
): Promise<ArkTaskResponse> {
  const payload = await response.json().catch(() => undefined);
  const record = recordValue(payload);
  if (!record) throw new VideoProviderError(errorCode);
  return record;
}

function redactDataUrls(value: string): string {
  const prefix = /data:[^\s,]{1,256};base64,/gi;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = prefix.exec(value)) !== null) {
    const payloadStart = prefix.lastIndex;
    const { end, encodedCharacters } = scanBase64Payload(value, payloadStart);

    result += value.slice(cursor, match.index);
    if (encodedCharacters > 0) {
      result += "[data hidden]";
      cursor = end;
      prefix.lastIndex = end;
    } else {
      result += match[0];
      cursor = prefix.lastIndex;
    }
  }

  return result + value.slice(cursor);
}

function scanBase64Payload(
  value: string,
  start: number,
): { end: number; encodedCharacters: number } {
  let end = start;
  while (end < value.length && isBase64TokenCharacter(value[end])) end += 1;
  let encodedCharacters = end - start;
  if (encodedCharacters === 0) return { end: start, encodedCharacters: 0 };

  let chunks = 1;
  while (end < value.length) {
    let next = end;
    while (next < value.length && /\s/.test(value[next])) next += 1;
    if (next === end || next >= value.length || !isBase64TokenCharacter(value[next])) break;

    const chunkStart = next;
    while (next < value.length && isBase64TokenCharacter(value[next])) next += 1;
    const chunkLength = next - chunkStart;
    const completeChunk = chunkLength >= 4 && chunkLength % 4 === 0;
    const finalUnpaddedChunk = chunks > 1 && (chunkLength === 2 || chunkLength === 3);
    if (!completeChunk && !finalUnpaddedChunk) break;

    chunks += 1;
    encodedCharacters += chunkLength;
    end = next;
    if (finalUnpaddedChunk) break;
  }

  return { end, encodedCharacters };
}

function redactSegmentedBase64(value: string): string {
  let result = "";
  let cursor = 0;
  let index = 0;

  while (index < value.length) {
    if (!isBase64TokenCharacter(value[index])) {
      index += 1;
      continue;
    }

    const start = index;
    while (index < value.length && isBase64TokenCharacter(value[index])) index += 1;
    const firstChunkLength = index - start;
    if (firstChunkLength > 3 && firstChunkLength % 4 !== 0) continue;

    let end = index;
    let chunks = 1;
    let encodedCharacters = firstChunkLength;
    let hasStandaloneToken = encodedCharacters >= 24;
    let middleChunksAligned = true;
    let lastChunkLength = firstChunkLength;
    while (end < value.length) {
      let next = end;
      while (next < value.length && /\s/.test(value[next])) next += 1;
      if (next === end || next >= value.length || !isBase64TokenCharacter(value[next])) break;

      const chunkStart = next;
      while (next < value.length && isBase64TokenCharacter(value[next])) next += 1;
      const chunkLength = next - chunkStart;

      if (chunks >= 2 && lastChunkLength % 4 !== 0) {
        middleChunksAligned = false;
      }
      chunks += 1;
      encodedCharacters += chunkLength;
      hasStandaloneToken ||= chunkLength >= 24;
      lastChunkLength = chunkLength;
      end = next;
    }

    const tailAligned = lastChunkLength % 4 !== 1;
    if (
      chunks >= 2
      && encodedCharacters >= 24
      && middleChunksAligned
      && tailAligned
      && !hasStandaloneToken
    ) {
      result += value.slice(cursor, start) + "[base64 hidden]";
      cursor = end;
    }
    index = end;
  }

  return result + value.slice(cursor);
}

function isBase64TokenCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || value === "+"
    || value === "/"
    || value === "_"
    || value === "-"
    || value === "=";
}
