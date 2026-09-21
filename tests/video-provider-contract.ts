import type { VideoProvider } from "@/lib/video/provider";
import type { PromptCompilerInput } from "@/lib/video/prompt-compiler";
import { SeedanceProvider } from "@/lib/video/providers/seedance";
import type {
  CreateVideoInput,
  CreateVideoTaskResult,
  VideoTaskStatus,
} from "@/lib/video/types";

const provider: VideoProvider = new SeedanceProvider("contract-test-key");

type ReferenceImageCountIsRequired = PromptCompilerInput extends {
  referenceImageCount: number;
} ? true : false;
const referenceImageCountIsRequired: ReferenceImageCountIsRequired = true;
void referenceImageCountIsRequired;

const createInput: CreateVideoInput = {
  provider: "seedance",
  model: "doubao-seedance-2-5-260628",
  modelProfile: "doubao-seedance-2-5-260628",
  generationMode: "ordered-reference",
  generateAudio: false,
  prompt: "一只猫在窗边打盹",
};

void provider
  .createTask(createInput)
  .then((result: CreateVideoTaskResult) => result.taskId);
void provider.getTask("task-placeholder").then((result: VideoTaskStatus) => result.status);
void provider.getTask("task-placeholder").then((result: VideoTaskStatus) => ({
  errorDetail: result.errorDetail,
  requestId: result.requestId,
}));
