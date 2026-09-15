import "server-only";

import type { VideoProvider } from "@/lib/video/provider";
import type {
  CreateVideoInput,
  CreateVideoTaskResult,
  VideoTaskState,
  VideoTaskStatus,
} from "@/lib/video/types";

const arkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3";
const textToVideoModel = "doubao-seedance-1-0-pro-250528";
const imageToVideoModel = "doubao-seedance-1-0-lite-i2v-250428";

type ArkTaskResponse = {
  id?: string;
  status?: string;
  content?: { video_url?: string };
};

export class VideoProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 502,
  ) {
    super(message);
  }
}

export class SeedanceProvider implements VideoProvider {
  async createTask(input: CreateVideoInput): Promise<CreateVideoTaskResult> {
    const hasReferenceImage = Boolean(input.referenceImageUrl);
    const model =
      input.model || (hasReferenceImage ? imageToVideoModel : textToVideoModel);
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: input.prompt },
    ];

    if (input.referenceImageUrl) {
      content.push({
        type: "image_url",
        image_url: { url: input.referenceImageUrl },
      });
    }

    const response = await this.request("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({
        model,
        content,
        ratio: hasReferenceImage ? "adaptive" : "16:9",
        duration: 5,
        watermark: false,
      }),
    });
    const task = (await response.json()) as ArkTaskResponse;

    if (!task.id) {
      throw new VideoProviderError("视频服务未返回任务编号。");
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
      throw new VideoProviderError("视频服务未返回可播放的视频地址。");
    }

    return {
      taskId: task.id ?? taskId,
      status,
      videoUrl: status === "succeeded" ? videoUrl : undefined,
      error: status === "failed" ? "视频生成失败，请调整提示词后重试。" : undefined,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const apiKey = process.env.SEEDANCE_API_KEY;

    if (!apiKey) {
      throw new VideoProviderError("服务器尚未配置 Seedance API Key。", 503);
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
        throw new VideoProviderError(messageForStatus(response.status), response.status);
      }

      return response;
    } catch (error) {
      if (error instanceof VideoProviderError) {
        throw error;
      }

      throw new VideoProviderError("无法连接视频服务，请稍后重试。");
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

function messageForStatus(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return "视频服务认证失败，请检查服务器 API Key 配置。";
  }

  if (statusCode === 429) {
    return "视频服务繁忙，请稍后再试。";
  }

  return "视频服务暂时不可用，请稍后重试。";
}
