import type { VideoProvider } from "@/lib/video/provider";
import { SeedanceProvider } from "@/lib/video/providers/seedance";
import type {
  CreateVideoInput,
  CreateVideoTaskResult,
  VideoTaskStatus,
} from "@/lib/video/types";

const provider: VideoProvider = new SeedanceProvider();

const createInput: CreateVideoInput = {
  provider: "seedance",
  model: "seedance-placeholder",
  prompt: "一只猫在窗边打盹",
};

void provider
  .createTask(createInput)
  .then((result: CreateVideoTaskResult) => result.taskId);
void provider.getTask("task-placeholder").then((result: VideoTaskStatus) => result.status);
