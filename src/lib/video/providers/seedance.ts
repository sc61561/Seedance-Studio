import "server-only";

import { defaultSeedanceModel } from "@/lib/video/models";
import type { ApiErrorParams } from "@/lib/video/errors";
import type { VideoProvider } from "@/lib/video/provider";
import type {
  CreateVideoInput,
  CreateVideoTaskResult,
  VideoTaskState,
  VideoTaskStatus,
} from "@/lib/video/types";

const arkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3";

type ArkTaskResponse = {
  id?: string;
  status?: string;
  content?: { video_url?: string };
};

type ArkErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

// Carries a stable error `code` (localized on the client) plus optional params and
// a language-neutral detail label. `message` stays human-readable for server logs.
export class VideoProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number = 502,
    public readonly params?: ApiErrorParams,
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "VideoProviderError";
  }
}

export class SeedanceProvider implements VideoProvider {
  async createTask(input: CreateVideoInput): Promise<CreateVideoTaskResult> {
    const model = input.model || defaultSeedanceModel();
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: input.prompt },
    ];

    const referenceImageUrls = input.referenceImageUrls?.length
      ? input.referenceImageUrls
      : input.referenceImageUrl
        ? [input.referenceImageUrl]
        : [];

    referenceImageUrls.forEach((url) => {
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    });

    const response = await this.request("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({
        model,
        content,
        ratio: input.aspectRatio ?? "16:9",
        resolution: input.resolution ?? "720p",
        duration: input.duration ?? 5,
        watermark: false,
      }),
    });
    const task = (await response.json()) as ArkTaskResponse;

    if (!task.id) {
      throw new VideoProviderError("api.createFailed");
    }

    return { taskId: task.id };
  }

  async getTask(taskId: string): Promise<VideoTaskStatus> {
    const response = await this.request(
      `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      { method: "GET" },
    );
    const task = (await response.json()) as ArkTaskResponse;
    const status = normalizeStatus(task.status);
    const videoUrl = task.content?.video_url;

    if (
      status === "succeeded" &&
      (typeof videoUrl !== "string" || !videoUrl.trim())
    ) {
      throw new VideoProviderError("api.providerNoVideoUrl");
    }

    return {
      taskId: task.id ?? taskId,
      status,
      videoUrl: status === "succeeded" ? videoUrl : undefined,
      errorCode: status === "failed" ? "api.providerGenerationFailed" : undefined,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const apiKey = process.env.SEEDANCE_API_KEY;

    if (!apiKey) {
      throw new VideoProviderError("api.providerNoKey", 503);
    }

    try {
      const response = await fetch(`${arkBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as ArkErrorResponse | null;
        throw errorForStatus(response.status, errorPayload);
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

function errorForStatus(statusCode: number, payload?: ArkErrorResponse | null): VideoProviderError {
  if (statusCode === 401 || statusCode === 403) {
    return new VideoProviderError("api.providerAuthFailed", statusCode);
  }

  if (statusCode === 429) {
    return new VideoProviderError("api.providerBusy", statusCode);
  }

  const code = payload?.error?.code?.trim();
  const detail = sanitizeErrorDetail(payload?.error?.message);
  const label = code ? `HTTP ${statusCode}, ${code}` : `HTTP ${statusCode}`;
  return new VideoProviderError(
    "api.providerHttpError",
    statusCode,
    { label },
    detail ? `: ${detail}` : "",
  );
}

function sanitizeErrorDetail(value: string | undefined): string | undefined {
  const detail = value
    ?.replace(/Bearer\s+\S+/gi, "Bearer [hidden]")
    .replace(/\s+/g, " ")
    .trim();

  if (!detail) return undefined;
  return detail.slice(0, 240);
}
