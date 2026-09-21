import type {
  GenerationMode,
  OfficialSeedanceModelId,
} from "@/lib/video/models";

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
  modelProfile?: OfficialSeedanceModelId;
  generationMode?: GenerationMode;
  generateAudio?: boolean;
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
  // Stable error code localized on the client (see src/lib/i18n/messages.ts).
  errorCode?: string;
  errorDetail?: string;
  requestId?: string;
}
