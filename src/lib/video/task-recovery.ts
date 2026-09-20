import {
  clearActiveVideoTask,
  persistActiveVideoTask,
  readActiveVideoTask,
  type ActiveTaskStorage,
  type PersistedVideoTask,
} from "@/lib/video/task-storage";
import { isApiKeyUnauthorizedResponse } from "@/lib/client/api-key-storage";

export type RecoveredVideoTask = {
  taskId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  errorCode?: string;
};

export type RecoveryApiErrorBody = {
  code?: string;
  params?: Record<string, string | number>;
  detail?: string;
};

type TaskFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

type ActiveTaskRecoveryOptions = {
  storage?: ActiveTaskStorage;
  now?: number;
  online: boolean;
  signal?: AbortSignal;
  fetchTask?: TaskFetcher;
  onRestore: (task: PersistedVideoTask) => void;
  onTask: (task: RecoveredVideoTask) => void;
  onSchedule: (taskId: string) => void;
  onUnauthorized: () => void;
  onError: (body?: RecoveryApiErrorBody, error?: unknown) => void;
  onTransientError: (body?: RecoveryApiErrorBody, error?: unknown) => void;
};

function isRecoveredVideoTask(value: unknown): value is RecoveredVideoTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return typeof task.taskId === "string"
    && task.taskId.length > 0
    && (
      task.status === "queued"
      || task.status === "processing"
      || task.status === "succeeded"
      || task.status === "failed"
    )
    && (task.videoUrl === undefined || typeof task.videoUrl === "string")
    && (task.errorCode === undefined || typeof task.errorCode === "string");
}

export async function recoverActiveVideoTask({
  storage,
  now = Date.now(),
  online,
  signal,
  fetchTask = fetch,
  onRestore,
  onTask,
  onSchedule,
  onUnauthorized,
  onError,
  onTransientError,
}: ActiveTaskRecoveryOptions): Promise<boolean> {
  const storedTask = readActiveVideoTask(storage, now);
  if (!storedTask) return false;

  onRestore(storedTask);
  if (!online) {
    onSchedule(storedTask.taskId);
    return true;
  }

  try {
    const response = await fetchTask(
      `/api/task/${encodeURIComponent(storedTask.taskId)}`,
      { cache: "no-store", signal },
    );
    if (signal?.aborted) return true;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted) return true;
      if (isTransientTaskPollingStatus(response.status)) {
        onTransientError(undefined, error);
        onSchedule(storedTask.taskId);
        return true;
      }
      clearActiveVideoTask(storage);
      onError(undefined, error);
      return true;
    }
    if (signal?.aborted) return true;
    const errorBody = payload as RecoveryApiErrorBody;
    if (isApiKeyUnauthorizedResponse(response.status, errorBody.code)) {
      onUnauthorized();
      return true;
    }
    if (!response.ok) {
      if (isTransientTaskPollingResponse(response.status, errorBody.code)) {
        onTransientError(errorBody);
        onSchedule(storedTask.taskId);
        return true;
      }
      clearActiveVideoTask(storage);
      onError(payload as RecoveryApiErrorBody);
      return true;
    }
    if (!isRecoveredVideoTask(payload)) {
      onTransientError();
      onSchedule(storedTask.taskId);
      return true;
    }

    onTask(payload);
    if (payload.status === "queued" || payload.status === "processing") {
      persistActiveVideoTask({
        taskId: payload.taskId,
        status: payload.status,
        createdAt: storedTask.createdAt,
        model: storedTask.model,
        resolution: storedTask.resolution,
        aspectRatio: storedTask.aspectRatio,
        duration: storedTask.duration,
      }, storage);
      onSchedule(storedTask.taskId);
      return true;
    }

    clearActiveVideoTask(storage);
    return true;
  } catch (error) {
    if (signal?.aborted) return true;
    onTransientError(undefined, error);
    onSchedule(storedTask.taskId);
    return true;
  }
}

export function isTransientTaskPollingStatus(status: number): boolean {
  return isTransientTaskPollingResponse(status);
}

export function isTransientTaskPollingResponse(status: number, code?: string): boolean {
  if (isApiKeyUnauthorizedResponse(status, code)) return false;
  return status !== 400 && status !== 404 && status !== 410;
}
