import { describe, expect, it, vi } from "vitest";

import {
  classifyTaskPollingResponse,
  recoverActiveVideoTask,
  retryTaskPollDelayMs,
} from "@/lib/video/task-recovery";
import {
  activeVideoTaskStorageKey,
  readActiveVideoTask,
  type ActiveTaskStorage,
} from "@/lib/video/task-storage";

class MemoryStorage implements ActiveTaskStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const now = 1_800_000_000_000;
const owner = "a".repeat(64);
const other = "b".repeat(64);

function seed(storage: MemoryStorage, version: 1 | 2 = 2) {
  storage.setItem(activeVideoTaskStorageKey, JSON.stringify({
    version,
    ...(version === 2 ? { apiKeyFingerprint: owner } : {}),
    taskId: "cgt-owner-task",
    status: "queued",
    createdAt: now,
    model: "ep-team-video",
    prompt: "never persist",
  }));
}

function callbacks() {
  return {
    onRestore: vi.fn(),
    onTask: vi.fn(),
    onSchedule: vi.fn(),
    onPause: vi.fn(),
    onError: vi.fn(),
    onTransientError: vi.fn(),
  };
}

describe("active-task BYOK recovery", () => {
  it("never queries a v2 task with another key, retains its ID and does not schedule", async () => {
    const storage = new MemoryStorage();
    seed(storage);
    const fetchTask = vi.fn();
    const spies = callbacks();

    await recoverActiveVideoTask({ storage, now, online: true,
      apiKeyFingerprint: other, fetchTask, ...spies });

    expect(fetchTask).not.toHaveBeenCalled();
    expect(spies.onRestore).toHaveBeenCalledWith(expect.objectContaining({ taskId: "cgt-owner-task" }));
    expect(spies.onPause).toHaveBeenCalledWith("cgt-owner-task", "key-mismatch");
    expect(spies.onSchedule).not.toHaveBeenCalled();
    expect(readActiveVideoTask(storage, now)?.taskId).toBe("cgt-owner-task");
  });

  it("queries with the matching session fetcher and promotes a legacy v1 active task to v2", async () => {
    const storage = new MemoryStorage();
    seed(storage, 1);
    const fetchTask = vi.fn(async () => Response.json({ taskId: "cgt-owner-task", status: "processing" }));
    const spies = callbacks();

    await recoverActiveVideoTask({ storage, now, online: true,
      apiKeyFingerprint: owner, fetchTask, ...spies });

    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(fetchTask).toHaveBeenCalledWith("/api/task/cgt-owner-task", expect.objectContaining({ cache: "no-store" }));
    expect(spies.onTask).toHaveBeenCalledWith(expect.objectContaining({ status: "processing" }));
    expect(spies.onSchedule).toHaveBeenCalledWith("cgt-owner-task", 5_000);
    expect(readActiveVideoTask(storage, now)).toMatchObject({
      version: 2,
      apiKeyFingerprint: owner,
      taskId: "cgt-owner-task",
      status: "processing",
    });
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toContain("never persist");
  });

  it.each([400, 410])("clears a definitely invalid task on HTTP %i", async (status) => {
    const storage = new MemoryStorage(); seed(storage);
    const spies = callbacks();
    await recoverActiveVideoTask({ storage, now, online: true, apiKeyFingerprint: owner,
      fetchTask: async () => Response.json({ code: "api.taskIdInvalid" }, { status }), ...spies });
    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(spies.onSchedule).not.toHaveBeenCalled();
  });

  it.each([
    ["api.apiKeyInvalid"],
    ["api.providerInvalidParameter"],
    [undefined],
  ])("retains an ambiguous HTTP 400 response (%s)", async (code) => {
    const storage = new MemoryStorage(); seed(storage);
    const spies = callbacks();
    await recoverActiveVideoTask({ storage, now, online: true, apiKeyFingerprint: owner,
      fetchTask: async () => Response.json(code ? { code } : {}, { status: 400 }), ...spies });
    expect(readActiveVideoTask(storage, now)?.taskId).toBe("cgt-owner-task");
    expect(spies.onPause).toHaveBeenCalledWith("cgt-owner-task", "invalid-response");
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it.each([
    [401, "api.apiKeyRequired", "unauthorized"],
    [403, "api.providerPermissionDenied", "unauthorized"],
    [404, "api.taskIdInvalid", "not-found"],
    [404, undefined, "not-found"],
  ] as const)("pauses and retains HTTP %i / %s", async (status, code, reason) => {
    const storage = new MemoryStorage(); seed(storage);
    const spies = callbacks();
    await recoverActiveVideoTask({ storage, now, online: true, apiKeyFingerprint: owner,
      fetchTask: async () => Response.json(code ? { code } : {}, { status }), ...spies });
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
    expect(spies.onPause).toHaveBeenCalledWith("cgt-owner-task", reason);
    expect(spies.onSchedule).not.toHaveBeenCalled();
  });

  it("does not follow a different task ID in a successful response", async () => {
    const storage = new MemoryStorage(); seed(storage);
    const spies = callbacks();
    await recoverActiveVideoTask({ storage, now, online: true, apiKeyFingerprint: owner,
      fetchTask: async () => Response.json({ taskId: "cgt-other", status: "processing" }), ...spies });
    expect(readActiveVideoTask(storage, now)?.taskId).toBe("cgt-owner-task");
    expect(spies.onTask).not.toHaveBeenCalled();
    expect(spies.onPause).toHaveBeenCalledWith("cgt-owner-task", "invalid-response");
  });

  it("clears only a genuine terminal result for the same task ID", async () => {
    const storage = new MemoryStorage(); seed(storage);
    const spies = callbacks();
    await recoverActiveVideoTask({ storage, now, online: true, apiKeyFingerprint: owner,
      fetchTask: async () => Response.json({ taskId: "cgt-owner-task", status: "succeeded", videoUrl: "https://example.com/video.mp4" }), ...spies });
    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
    expect(spies.onTask).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });

  it("does not mutate or schedule when an in-flight request is aborted", async () => {
    const storage = new MemoryStorage(); seed(storage);
    const controller = new AbortController();
    const spies = callbacks();
    const pending = recoverActiveVideoTask({ storage, now, online: true,
      apiKeyFingerprint: owner, signal: controller.signal,
      fetchTask: async () => { controller.abort(); return Response.json({ taskId: "cgt-owner-task", status: "succeeded" }); }, ...spies });
    await pending;
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
    expect(spies.onTask).not.toHaveBeenCalled();
    expect(spies.onSchedule).not.toHaveBeenCalled();
  });

  it("retries network, offline, rate limit, and server errors with bounded delays", async () => {
    const cases = [
      { online: false, fetchTask: vi.fn(), status: undefined },
      { online: true, fetchTask: vi.fn(async () => { throw new TypeError("network"); }), status: undefined },
      { online: true, fetchTask: vi.fn(async () => Response.json({}, { status: 429, headers: { "Retry-After": "90" } })), status: 429 },
      { online: true, fetchTask: vi.fn(async () => Response.json({}, { status: 503 })), status: 503 },
    ];
    for (const item of cases) {
      const storage = new MemoryStorage(); seed(storage);
      const spies = callbacks();
      await recoverActiveVideoTask({ storage, now, online: item.online,
        apiKeyFingerprint: owner, retryAttempt: 1, fetchTask: item.fetchTask, ...spies });
      expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
      expect(spies.onSchedule).toHaveBeenCalledWith("cgt-owner-task", item.status === 429 ? 60_000 : 10_000);
      expect(spies.onPause).not.toHaveBeenCalled();
    }
  });

  it("caps exponential retries and resets the next active poll to five seconds", () => {
    expect(retryTaskPollDelayMs(0)).toBe(5_000);
    expect(retryTaskPollDelayMs(1)).toBe(10_000);
    expect(retryTaskPollDelayMs(2)).toBe(20_000);
    expect(retryTaskPollDelayMs(3)).toBe(40_000);
    expect(retryTaskPollDelayMs(4)).toBe(60_000);
    expect(retryTaskPollDelayMs(40)).toBe(60_000);
    expect(classifyTaskPollingResponse(200, { taskId: "cgt-owner-task", status: "queued" }, "cgt-owner-task", 4)).toMatchObject({ kind: "active", delayMs: 5_000 });
  });

  it("accepts an HTTP-date Retry-After while capping the delay", () => {
    const date = new Date(Date.now() + 30_000).toUTCString();
    expect(retryTaskPollDelayMs(0, date)).toBeGreaterThanOrEqual(28_000);
    expect(retryTaskPollDelayMs(0, date)).toBeLessThanOrEqual(30_000);
  });
});
