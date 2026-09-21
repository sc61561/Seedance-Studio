import {
  clearActiveVideoTask,
  persistActiveVideoTask,
  readActiveVideoTask,
  type ActiveTaskStorage,
  type PersistedVideoTask,
} from "@/lib/video/task-storage";

export type RecoveredVideoTask = {
  taskId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  errorCode?: string;
  errorDetail?: string;
  requestId?: string;
};

export type RecoveryApiErrorBody = {
  code?: string;
  params?: Record<string, string | number>;
  detail?: string;
  requestId?: string;
};

export type RecoveryPauseReason = "missing-key" | "key-mismatch" | "unauthorized" | "not-found" | "invalid-response";

export type TaskPollingDecision =
  | { kind: "active"; task: RecoveredVideoTask; delayMs: 5_000 }
  | { kind: "terminal"; task: RecoveredVideoTask }
  | { kind: "clear-terminal" }
  | { kind: "pause"; reason: RecoveryPauseReason }
  | { kind: "retry"; delayMs: number };

type TaskFetcher = (input: string, init: RequestInit) => Promise<Response>;

export type ActiveTaskRecoveryOptions = {
  storage?: ActiveTaskStorage;
  now?: number;
  online: boolean;
  apiKeyFingerprint?: string;
  retryAttempt?: number;
  signal?: AbortSignal;
  fetchTask?: TaskFetcher;
  onRestore: (task: PersistedVideoTask) => void;
  onTask: (task: RecoveredVideoTask) => void;
  onSchedule: (taskId: string, delayMs: number) => void;
  onPause: (taskId: string, reason: RecoveryPauseReason) => void;
  onError: (body?: RecoveryApiErrorBody, error?: unknown) => void;
  onTransientError: (body?: RecoveryApiErrorBody, error?: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asErrorBody(value: unknown): RecoveryApiErrorBody | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
  };
}

function asRecoveredTask(value: unknown): RecoveredVideoTask | undefined {
  if (!isRecord(value) || typeof value.taskId !== "string" || !value.taskId) return undefined;
  if (!["queued", "processing", "succeeded", "failed"].includes(String(value.status))) return undefined;
  if (value.videoUrl !== undefined && typeof value.videoUrl !== "string") return undefined;
  if (value.errorCode !== undefined && typeof value.errorCode !== "string") return undefined;
  return {
    taskId: value.taskId,
    status: value.status as RecoveredVideoTask["status"],
    ...(typeof value.videoUrl === "string" ? { videoUrl: value.videoUrl } : {}),
    ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
    ...(typeof value.errorDetail === "string" ? { errorDetail: value.errorDetail } : {}),
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
  };
}

export function retryTaskPollDelayMs(attempt: number, retryAfter?: string | null): number {
  const boundedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.min(4, Math.floor(attempt))) : 0;
  const exponential = Math.min(5_000 * 2 ** boundedAttempt, 60_000);
  if (!retryAfter) return exponential;
  const value = retryAfter.trim();
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const requestedMs = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(requestedMs) || requestedMs < 0) return exponential;
  return Math.min(60_000, Math.max(exponential, Math.ceil(requestedMs)));
}

export function classifyTaskPollingResponse(
  status: number | undefined,
  payload: unknown,
  expectedTaskId: string,
  retryAttempt = 0,
  retryAfter?: string | null,
): TaskPollingDecision {
  if (status === undefined || status === 429 || (status >= 500 && status <= 599)) {
    return { kind: "retry", delayMs: retryTaskPollDelayMs(retryAttempt, retryAfter) };
  }
  if (status === 410) return { kind: "clear-terminal" };
  if (status === 400) {
    return isRecord(payload) && payload.code === "api.taskIdInvalid"
      ? { kind: "clear-terminal" }
      : { kind: "pause", reason: "invalid-response" };
  }
  if (status === 401 || status === 403) return { kind: "pause", reason: "unauthorized" };
  if (status === 404) return { kind: "pause", reason: "not-found" };
  if (status < 200 || status >= 300) return { kind: "pause", reason: "invalid-response" };

  const task = asRecoveredTask(payload);
  if (!task || task.taskId !== expectedTaskId) return { kind: "pause", reason: "invalid-response" };
  if (task.status === "queued" || task.status === "processing") {
    return { kind: "active", task, delayMs: 5_000 };
  }
  return { kind: "terminal", task };
}

/** One query of a persisted task. The caller binds `fetchTask` to one key snapshot. */
export async function recoverActiveVideoTask({
  storage,
  now = Date.now(),
  online,
  apiKeyFingerprint,
  retryAttempt = 0,
  signal,
  fetchTask = fetch,
  onRestore,
  onTask,
  onSchedule,
  onPause,
  onError,
  onTransientError,
}: ActiveTaskRecoveryOptions): Promise<boolean> {
  const storedTask = readActiveVideoTask(storage, now);
  if (!storedTask || signal?.aborted) return false;

  onRestore(storedTask);
  if (signal?.aborted) return true;
  if (!apiKeyFingerprint) {
    onPause(storedTask.taskId, "missing-key");
    return true;
  }
  if (storedTask.version === 2 && storedTask.apiKeyFingerprint !== apiKeyFingerprint) {
    onPause(storedTask.taskId, "key-mismatch");
    return true;
  }
  if (!online) {
    onTransientError();
    onSchedule(storedTask.taskId, retryTaskPollDelayMs(retryAttempt));
    return true;
  }

  try {
    const response = await fetchTask(`/api/task/${encodeURIComponent(storedTask.taskId)}`, {
      cache: "no-store",
      signal,
    });
    if (signal?.aborted) return true;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (signal?.aborted) return true;
    const decision = classifyTaskPollingResponse(
      response.status,
      payload,
      storedTask.taskId,
      retryAttempt,
      response.headers.get("Retry-After"),
    );
    const errorBody = asErrorBody(payload);
    if (decision.kind === "retry") {
      onTransientError(errorBody);
      if (!signal?.aborted) onSchedule(storedTask.taskId, decision.delayMs);
    } else if (decision.kind === "pause") {
      onPause(storedTask.taskId, decision.reason);
    } else if (decision.kind === "clear-terminal") {
      clearActiveVideoTask(storage);
      onError(errorBody);
    } else if (decision.kind === "terminal") {
      clearActiveVideoTask(storage);
      onTask(decision.task);
    } else {
      persistActiveVideoTask({
        taskId: storedTask.taskId,
        status: decision.task.status === "queued" ? "queued" : "processing",
        createdAt: storedTask.createdAt,
        apiKeyFingerprint,
        model: storedTask.model,
        resolution: storedTask.resolution,
        aspectRatio: storedTask.aspectRatio,
        duration: storedTask.duration,
      }, storage);
      onTask(decision.task);
      if (!signal?.aborted) onSchedule(storedTask.taskId, decision.delayMs);
    }
    return true;
  } catch (error) {
    if (signal?.aborted) return true;
    onTransientError(undefined, error);
    if (!signal?.aborted) onSchedule(storedTask.taskId, retryTaskPollDelayMs(retryAttempt));
    return true;
  }
}
