import type {
  CreateVideoInput,
  CreateVideoTaskResult,
  VideoTaskStatus,
} from "@/lib/video/types";

export interface VideoProvider {
  createTask(input: CreateVideoInput): Promise<CreateVideoTaskResult>;
  getTask(taskId: string): Promise<VideoTaskStatus>;
}
