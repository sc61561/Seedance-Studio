import { describe, expect, it, vi } from "vitest";

import {
  recoverActiveVideoTask,
  type RecoveredVideoTask,
} from "@/lib/video/task-recovery";
import {
  activeVideoTaskStorageKey,
  persistActiveVideoTask,
  type ActiveTaskStorage,
} from "@/lib/video/task-storage";

class MemoryStorage implements ActiveTaskStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const now = 1_800_000_000_000;

function seedActiveTask(storage: ActiveTaskStorage) {
  persistActiveVideoTask({
    taskId: "cgt-recover-once",
    status: "queued",
    createdAt: now,
    resolution: "1080p",
    aspectRatio: "9:16",
    duration: 8,
  }, storage);
}

describe("active task recovery controller", () => {
  it.each(["queued", "processing"] as const)(
    "makes one task request and schedules the next poll for %s",
    async (status) => {
      const storage = new MemoryStorage();
      seedActiveTask(storage);
      const fetchTask = vi.fn(async () => Response.json({
        taskId: "cgt-recover-once",
        status,
      }));
      const onRestore = vi.fn();
      const onTask = vi.fn();
      const onSchedule = vi.fn();

      expect(await recoverActiveVideoTask({
        storage,
        now,
        online: true,
        fetchTask,
        onRestore,
        onTask,
        onSchedule,
        onUnauthorized: vi.fn(),
        onError: vi.fn(),
        onTransientError: vi.fn(),
      })).toBe(true);

      expect(fetchTask).toHaveBeenCalledTimes(1);
      expect(fetchTask).toHaveBeenCalledWith(
        "/api/task/cgt-recover-once",
        expect.objectContaining({ cache: "no-store" }),
      );
      expect(onRestore).toHaveBeenCalledTimes(1);
      expect(onTask).toHaveBeenCalledWith({
        taskId: "cgt-recover-once",
        status,
      });
      expect(onSchedule).toHaveBeenCalledTimes(1);
      expect(onSchedule).toHaveBeenCalledWith("cgt-recover-once");
      expect(JSON.parse(storage.getItem(activeVideoTaskStorageKey)!)).toEqual(expect.objectContaining({
        taskId: "cgt-recover-once",
        status,
        resolution: "1080p",
        aspectRatio: "9:16",
        duration: 8,
      }));
    },
  );

  it("forwards a successful video result and clears active storage", async () => {
    const storage = new MemoryStorage();
    seedActiveTask(storage);
    const onTask = vi.fn<(task: RecoveredVideoTask) => void>();
    const onSchedule = vi.fn();

    await recoverActiveVideoTask({
      storage,
      now,
      online: true,
      fetchTask: vi.fn(async () => Response.json({
        taskId: "cgt-recover-once",
        status: "succeeded",
        videoUrl: "https://cdn.example.com/result.mp4",
      })),
      onRestore: vi.fn(),
      onTask,
      onSchedule,
      onUnauthorized: vi.fn(),
      onError: vi.fn(),
      onTransientError: vi.fn(),
    });

    expect(onTask).toHaveBeenCalledWith({
      taskId: "cgt-recover-once",
      status: "succeeded",
      videoUrl: "https://cdn.example.com/result.mp4",
    });
    expect(onSchedule).not.toHaveBeenCalled();
    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
  });

  it("clears active storage when the provider reports failure", async () => {
    const storage = new MemoryStorage();
    seedActiveTask(storage);
    const onTask = vi.fn();

    await recoverActiveVideoTask({
      storage,
      now,
      online: true,
      fetchTask: vi.fn(async () => Response.json({
        taskId: "cgt-recover-once",
        status: "failed",
        errorCode: "api.providerGenerationFailed",
      })),
      onRestore: vi.fn(),
      onTask,
      onSchedule: vi.fn(),
      onUnauthorized: vi.fn(),
      onError: vi.fn(),
      onTransientError: vi.fn(),
    });

    expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
  });

  it("retains active storage and enters the auth gate on a 401", async () => {
    const storage = new MemoryStorage();
    seedActiveTask(storage);
    const onUnauthorized = vi.fn();
    const onTask = vi.fn();

    await recoverActiveVideoTask({
      storage,
      now,
      online: true,
      fetchTask: vi.fn(async () => Response.json(
        { code: "api.unauthorized" },
        { status: 401 },
      )),
      onRestore: vi.fn(),
      onTask,
      onSchedule: vi.fn(),
      onUnauthorized,
      onError: vi.fn(),
      onTransientError: vi.fn(),
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onTask).not.toHaveBeenCalled();
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
  });

  it("restores offline state without making a request and schedules a retry", async () => {
    const storage = new MemoryStorage();
    seedActiveTask(storage);
    const fetchTask = vi.fn();
    const onSchedule = vi.fn();

    await recoverActiveVideoTask({
      storage,
      now,
      online: false,
      fetchTask,
      onRestore: vi.fn(),
      onTask: vi.fn(),
      onSchedule,
      onUnauthorized: vi.fn(),
      onError: vi.fn(),
      onTransientError: vi.fn(),
    });

    expect(fetchTask).not.toHaveBeenCalled();
    expect(onSchedule).toHaveBeenCalledWith("cgt-recover-once");
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
  });

  it.each([
    ["503 response", async () => Response.json({ code: "api.providerBusy" }, { status: 503 })],
    ["403 provider auth response", async () => Response.json({ code: "api.providerAuthFailed" }, { status: 403 })],
    ["malformed response", async () => Response.json({ unexpected: true })],
    ["invalid JSON response", async () => new Response("not-json", { status: 200 })],
    ["network failure", async () => { throw new TypeError("fetch failed"); }],
  ])("retains and reschedules an active task after transient %s", async (_label, fetchTask) => {
    const storage = new MemoryStorage();
    seedActiveTask(storage);
    const onSchedule = vi.fn();
    const onTransientError = vi.fn();

    await recoverActiveVideoTask({
      storage,
      now,
      online: true,
      fetchTask,
      onRestore: vi.fn(),
      onTask: vi.fn(),
      onSchedule,
      onUnauthorized: vi.fn(),
      onError: vi.fn(),
      onTransientError,
    });

    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
    expect(onSchedule).toHaveBeenCalledWith("cgt-recover-once");
    expect(onTransientError).toHaveBeenCalledTimes(1);
  });

  it("clears an invalid or expired task id after a definitive 404", async () => {
    const storage = new MemoryStorage();
    seedActiveTask(storage);
    const onError = vi.fn();

    await recoverActiveVideoTask({
      storage,
      now,
      online: true,
      fetchTask: async () => Response.json({ code: "api.taskIdInvalid" }, { status: 404 }),
      onRestore: vi.fn(),
      onTask: vi.fn(),
      onSchedule: vi.fn(),
      onUnauthorized: vi.fn(),
      onError,
      onTransientError: vi.fn(),
    });

    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
    expect(onError).toHaveBeenCalledWith({ code: "api.taskIdInvalid" });
  });
});
