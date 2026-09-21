import { fingerprintSeedanceApiKey } from "@/lib/client/api-key-fingerprint";
import {
  clearActiveVideoTask,
  persistActiveVideoTask,
  readActiveVideoTask,
  type ActiveTaskStorage,
  type PersistableVideoTask,
  type PersistedVideoTask,
} from "@/lib/video/task-storage";
import {
  recoverActiveVideoTask,
  type RecoveredVideoTask,
  type RecoveryPauseReason,
} from "@/lib/video/task-recovery";

export type TaskSessionUpdate =
  | { kind: "restore"; task: PersistedVideoTask }
  | { kind: "task"; task: RecoveredVideoTask }
  | { kind: "pause"; taskId: string; reason: RecoveryPauseReason }
  | { kind: "retry"; taskId: string }
  | { kind: "terminal-error"; taskId: string };

export type TaskPollingSessionOptions = {
  storage?: ActiveTaskStorage;
  fetchTask?: typeof fetch;
  fingerprintKey?: (key: string) => Promise<string>;
  online?: () => boolean;
  now?: () => number;
  onUpdate: (update: TaskSessionUpdate) => void;
};

type BoundSession = {
  generation: number;
  taskId: string;
  apiKey: string;
  apiKeyFingerprint: string;
  retryAttempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
  restored: boolean;
};

/** Owns exactly one task/key pairing; no key or provider detail is persisted. */
export function createTaskPollingSession(options: TaskPollingSessionOptions) {
  let generation = 0;
  let current: BoundSession | null = null;
  let currentKey = "";
  const fetchTask = options.fetchTask ?? fetch;
  const fingerprintKey = options.fingerprintKey ?? fingerprintSeedanceApiKey;
  const online = options.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const now = options.now ?? Date.now;

  function active(session: BoundSession): boolean {
    return current === session && generation === session.generation && !session.controller?.signal.aborted;
  }

  function invalidate(): void {
    generation += 1;
    if (current?.timer) clearTimeout(current.timer);
    current?.controller?.abort();
    current = null;
  }

  function schedule(session: BoundSession, delayMs: number): void {
    if (!active(session)) return;
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      session.timer = null;
      if (active(session)) void poll(session);
    }, delayMs);
  }

  async function poll(session: BoundSession): Promise<void> {
    if (!active(session) || session.controller) return;
    const controller = new AbortController();
    session.controller = controller;
    let transientFailure = false;
    try {
      await recoverActiveVideoTask({
        storage: options.storage,
        now: now(),
        online: online(),
        apiKeyFingerprint: session.apiKeyFingerprint,
        retryAttempt: session.retryAttempt,
        signal: controller.signal,
        fetchTask: (input, init) => fetchTask(input, {
          ...init,
          headers: { "x-seedance-api-key": session.apiKey },
        }),
        onRestore: (task) => {
          if (!active(session)) return;
          if (!session.restored) {
            session.restored = true;
            options.onUpdate({ kind: "restore", task });
          }
        },
        onTask: (task) => {
          if (!active(session)) return;
          session.retryAttempt = 0;
          options.onUpdate({ kind: "task", task });
          if (task.status === "succeeded" || task.status === "failed") invalidate();
        },
        onSchedule: (_taskId, delayMs) => {
          if (!active(session)) return;
          if (transientFailure) session.retryAttempt += 1;
          schedule(session, delayMs);
        },
        onPause: (taskId, reason) => {
          if (!active(session)) return;
          options.onUpdate({ kind: "pause", taskId, reason });
          invalidate();
        },
        onError: () => {
          if (!active(session)) return;
          options.onUpdate({ kind: "terminal-error", taskId: session.taskId });
          invalidate();
        },
        onTransientError: () => {
          if (!active(session)) return;
          transientFailure = true;
          options.onUpdate({ kind: "retry", taskId: session.taskId });
        },
      });
    } finally {
      if (session.controller === controller) session.controller = null;
    }
  }

  async function changeKey(key: string): Promise<void> {
    const normalized = key.trim();
    if (normalized === currentKey && current) return;
    invalidate();
    currentKey = normalized;
    const expectedGeneration = generation;
    const stored = readActiveVideoTask(options.storage, now());
    if (!stored) return;
    options.onUpdate({ kind: "restore", task: stored });
    if (!normalized) {
      options.onUpdate({ kind: "pause", taskId: stored.taskId, reason: "missing-key" });
      return;
    }
    let fingerprint: string;
    try {
      fingerprint = await fingerprintKey(normalized);
    } catch {
      if (generation === expectedGeneration) options.onUpdate({ kind: "pause", taskId: stored.taskId, reason: "invalid-response" });
      return;
    }
    if (generation !== expectedGeneration || currentKey !== normalized) return;
    if (stored.version === 2 && stored.apiKeyFingerprint !== fingerprint) {
      options.onUpdate({ kind: "pause", taskId: stored.taskId, reason: "key-mismatch" });
      return;
    }
    const session: BoundSession = {
      generation,
      taskId: stored.taskId,
      apiKey: normalized,
      apiKeyFingerprint: fingerprint,
      retryAttempt: 0,
      timer: null,
      controller: null,
      restored: true,
    };
    current = session;
    void poll(session);
  }

  async function startCreated(task: PersistableVideoTask, key: string): Promise<boolean> {
    const normalized = key.trim();
    if (!normalized) return false;
    invalidate();
    currentKey = normalized;
    if (!persistActiveVideoTask(task, options.storage)) return false;
    const session: BoundSession = {
      generation,
      taskId: task.taskId,
      apiKey: normalized,
      apiKeyFingerprint: task.apiKeyFingerprint,
      retryAttempt: 0,
      timer: null,
      controller: null,
      restored: true,
    };
    current = session;
    options.onUpdate({ kind: "task", task: { taskId: task.taskId, status: task.status } });
    void poll(session);
    return true;
  }

  function clear(): void {
    invalidate();
    currentKey = "";
    clearActiveVideoTask(options.storage);
  }

  return { changeKey, startCreated, invalidate, clear };
}
