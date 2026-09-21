import { isTaskKeyFingerprint } from "@/lib/client/api-key-fingerprint";

export const activeVideoTaskStorageKey = "seedance.activeTask";
export const activeVideoTaskTtlMs = 24 * 60 * 60 * 1_000;

const activeVideoTaskVersion = 2 as const;
const futureClockSkewMs = 5 * 60 * 1_000;

export type PersistedVideoTaskStatus = "queued" | "processing";

export type PersistableVideoTask = {
  apiKeyFingerprint: string;
  taskId: string;
  status: PersistedVideoTaskStatus;
  createdAt: number;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
};

export type PersistedVideoTask =
  | (Omit<PersistableVideoTask, "apiKeyFingerprint"> & { version: 1 })
  | (PersistableVideoTask & { version: typeof activeVideoTaskVersion });

export type ActiveTaskStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(storage?: ActiveTaskStorage): ActiveTaskStorage | undefined {
  if (storage) return storage;
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;
}

function isPersistedVideoTask(value: unknown, now: number): value is PersistedVideoTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  const createdAt = task.createdAt;

  return (task.version === 1 || task.version === activeVideoTaskVersion)
    && (task.version !== activeVideoTaskVersion || isTaskKeyFingerprint(task.apiKeyFingerprint))
    && typeof task.taskId === "string"
    && task.taskId.length > 0
    && task.taskId.length <= 200
    && (task.status === "queued" || task.status === "processing")
    && typeof createdAt === "number"
    && Number.isFinite(createdAt)
    && createdAt > 0
    && createdAt <= now + futureClockSkewMs
    && now - createdAt <= activeVideoTaskTtlMs
    && (task.model === undefined || optionalString(task.model) !== undefined)
    && (task.resolution === undefined || optionalString(task.resolution) !== undefined)
    && (task.aspectRatio === undefined || optionalString(task.aspectRatio) !== undefined)
    && (task.duration === undefined || (Number.isInteger(task.duration) && Number(task.duration) > 0));
}

function sanitizeTask(task: PersistedVideoTask): PersistedVideoTask {
  const fields = {
    taskId: task.taskId,
    status: task.status,
    createdAt: task.createdAt,
    ...(task.model ? { model: task.model } : {}),
    ...(task.resolution ? { resolution: task.resolution } : {}),
    ...(task.aspectRatio ? { aspectRatio: task.aspectRatio } : {}),
    ...(Number.isInteger(task.duration) ? { duration: task.duration } : {}),
  };
  return task.version === activeVideoTaskVersion
    ? { version: activeVideoTaskVersion, apiKeyFingerprint: task.apiKeyFingerprint, ...fields }
    : { version: 1, ...fields };
}

export function persistActiveVideoTask(
  task: PersistableVideoTask,
  storage?: ActiveTaskStorage,
): boolean {
  const target = browserStorage(storage);
  if (!target || !isTaskKeyFingerprint(task.apiKeyFingerprint)) return false;

  const record = sanitizeTask({
    version: activeVideoTaskVersion,
    apiKeyFingerprint: task.apiKeyFingerprint,
    taskId: task.taskId,
    status: task.status,
    createdAt: task.createdAt,
    ...(task.model ? { model: task.model } : {}),
    ...(task.resolution ? { resolution: task.resolution } : {}),
    ...(task.aspectRatio ? { aspectRatio: task.aspectRatio } : {}),
    ...(Number.isInteger(task.duration) ? { duration: task.duration } : {}),
  });

  try {
    target.setItem(activeVideoTaskStorageKey, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearActiveVideoTask(storage?: ActiveTaskStorage): void {
  const target = browserStorage(storage);
  if (!target) return;

  try {
    target.removeItem(activeVideoTaskStorageKey);
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
}

export function readActiveVideoTask(
  storage?: ActiveTaskStorage,
  now = Date.now(),
): PersistedVideoTask | undefined {
  const target = browserStorage(storage);
  if (!target) return undefined;

  try {
    const raw = target.getItem(activeVideoTaskStorageKey);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (isPersistedVideoTask(parsed, now)) return sanitizeTask(parsed);
  } catch {
    // Invalid JSON and blocked storage are both safe recovery misses.
  }

  clearActiveVideoTask(target);
  return undefined;
}

export function restoreActiveVideoTask(
  resume: (task: PersistedVideoTask) => void,
  storage?: ActiveTaskStorage,
  now = Date.now(),
): boolean {
  const task = readActiveVideoTask(storage, now);
  if (!task) return false;
  resume(task);
  return true;
}
