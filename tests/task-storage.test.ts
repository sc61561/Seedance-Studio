import { describe, expect, it, vi } from "vitest";

import {
  activeVideoTaskStorageKey,
  activeVideoTaskTtlMs,
  clearActiveVideoTask,
  persistActiveVideoTask,
  readActiveVideoTask,
  restoreActiveVideoTask,
  type ActiveTaskStorage,
  type PersistableVideoTask,
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

describe("active video task storage", () => {
  it("serializes only the versioned non-sensitive allowlist", () => {
    const storage = new MemoryStorage();
    const input = {
      taskId: "cgt-safe-123",
      status: "queued",
      createdAt: now,
      model: "seedance",
      resolution: "1080p",
      aspectRatio: "9:16",
      duration: 8,
      prompt: "never persist this prompt",
      referenceImageDataUrls: ["data:image/png;base64,secret"],
      apiKey: "secret-api-key",
      videoBytes: "secret-video-bytes",
    } as unknown as PersistableVideoTask;

    expect(persistActiveVideoTask(input, storage)).toBe(true);

    const raw = storage.getItem(activeVideoTaskStorageKey);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      version: 1,
      taskId: "cgt-safe-123",
      status: "queued",
      createdAt: now,
      model: "seedance",
      resolution: "1080p",
      aspectRatio: "9:16",
      duration: 8,
    });
    expect(raw).not.toContain("prompt");
    expect(raw).not.toContain("data:image");
    expect(raw).not.toContain("secret-api-key");
    expect(raw).not.toContain("videoBytes");
  });

  it("restores a recent queued or processing task", () => {
    const storage = new MemoryStorage();
    persistActiveVideoTask({
      taskId: "cgt-processing",
      status: "processing",
      createdAt: now - 30_000,
      resolution: "720p",
      aspectRatio: "16:9",
      duration: 5,
    }, storage);

    expect(readActiveVideoTask(storage, now)).toEqual({
      version: 1,
      taskId: "cgt-processing",
      status: "processing",
      createdAt: now - 30_000,
      resolution: "720p",
      aspectRatio: "16:9",
      duration: 5,
    });
  });

  it("drops unexpected fields from a restored record", () => {
    const storage = new MemoryStorage();
    storage.setItem(activeVideoTaskStorageKey, JSON.stringify({
      version: 1,
      taskId: "cgt-redacted-restore",
      status: "queued",
      createdAt: now,
      prompt: "legacy prompt must not escape storage",
      referenceImageDataUrls: ["data:image/png;base64,secret"],
    }));

    expect(readActiveVideoTask(storage, now)).toEqual({
      version: 1,
      taskId: "cgt-redacted-restore",
      status: "queued",
      createdAt: now,
    });
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["unknown schema version", JSON.stringify({ version: 2, taskId: "cgt-old", status: "queued", createdAt: now })],
    ["terminal status", JSON.stringify({ version: 1, taskId: "cgt-done", status: "succeeded", createdAt: now })],
    ["expired timestamp", JSON.stringify({ version: 1, taskId: "cgt-stale", status: "queued", createdAt: now - activeVideoTaskTtlMs - 1 })],
  ])("clears %s instead of restoring it", (_label, value) => {
    const storage = new MemoryStorage();
    storage.setItem(activeVideoTaskStorageKey, value);

    expect(readActiveVideoTask(storage, now)).toBeUndefined();
    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
  });

  it("tolerates unavailable browser storage", () => {
    const unavailableStorage: ActiveTaskStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };

    expect(() => readActiveVideoTask(unavailableStorage, now)).not.toThrow();
    expect(readActiveVideoTask(unavailableStorage, now)).toBeUndefined();
    expect(persistActiveVideoTask({
      taskId: "cgt-denied",
      status: "queued",
      createdAt: now,
    }, unavailableStorage)).toBe(false);
    expect(() => clearActiveVideoTask(unavailableStorage)).not.toThrow();
  });

  it("is safe to read during server rendering without window storage", () => {
    expect(readActiveVideoTask(undefined, now)).toBeUndefined();
  });

  it("clears the active record when its task reaches a terminal state", () => {
    const storage = new MemoryStorage();
    persistActiveVideoTask({
      taskId: "cgt-terminal",
      status: "processing",
      createdAt: now,
    }, storage);

    clearActiveVideoTask(storage);

    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
  });

  it("hands a restored task to the polling resume callback once", () => {
    const storage = new MemoryStorage();
    const resume = vi.fn();
    persistActiveVideoTask({
      taskId: "cgt-resume",
      status: "queued",
      createdAt: now,
    }, storage);

    expect(restoreActiveVideoTask(resume, storage, now)).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "cgt-resume",
      status: "queued",
    }));
  });
});
