export type VideoTaskState =
  | "idle"
  | "uploading"
  | "submitting"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export interface CreateVideoInput {
  provider: "seedance";
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
}

export interface CreateVideoTaskResult {
  taskId: string;
}

export interface VideoTaskStatus {
  taskId: string;
  status: VideoTaskState;
  videoUrl?: string;
  error?: string;
}
