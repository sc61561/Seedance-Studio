import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskPollingSession } from "@/lib/client/task-polling-session";
import { fingerprintSeedanceApiKey } from "@/lib/client/api-key-fingerprint";
import { activeVideoTaskStorageKey, readActiveVideoTask, type ActiveTaskStorage } from "@/lib/video/task-storage";

class MemoryStorage implements ActiveTaskStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("task polling session", () => {
  it("binds a created task to key A, pauses without a B query, and resumes with A", async () => {
    const storage = new MemoryStorage();
    const pendingA = deferred<Response>();
    const fetchTask = vi.fn().mockImplementationOnce(() => pendingA.promise)
      .mockImplementationOnce(async () => Response.json({ taskId: "cgt-bound", status: "succeeded", videoUrl: "https://example.com/v.mp4" }));
    const onUpdate = vi.fn();
    const session = createTaskPollingSession({ storage, fetchTask, onUpdate });
    const fingerprint = await fingerprintSeedanceApiKey("ark-A");

    expect(await session.startCreated({ taskId: "cgt-bound", status: "queued", createdAt: Date.now(), apiKeyFingerprint: fingerprint }, "ark-A")).toBe(true);
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
    expect(readActiveVideoTask(storage)?.taskId).toBe("cgt-bound");
    expect(onUpdate.mock.calls).toEqual([[{ kind: "task", task: { taskId: "cgt-bound", status: "queued" } }]]);
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchTask.mock.calls[0][1].headers).get("x-seedance-api-key")).toBe("ark-A");
    const stored = storage.getItem(activeVideoTaskStorageKey)!;
    expect(stored).toContain(fingerprint);
    expect(stored).not.toContain("ark-A");

    await session.changeKey("ark-B");
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ kind: "pause", reason: "key-mismatch" }));
    pendingA.resolve(Response.json({ taskId: "cgt-bound", status: "succeeded" }));
    await Promise.resolve();
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "task", task: expect.objectContaining({ status: "succeeded" }) }));

    await session.changeKey("ark-A");
    expect(fetchTask).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchTask.mock.calls[1][1].headers).get("x-seedance-api-key")).toBe("ark-A");
    await vi.waitFor(() => expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull());
  });

  it("cancels an old timer after a key change and clear cannot be undone by a stale response", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const later = deferred<Response>();
    const fetchTask = vi.fn().mockResolvedValueOnce(Response.json({ taskId: "cgt-timer", status: "processing" }))
      .mockImplementationOnce(() => later.promise);
    const onUpdate = vi.fn();
    const session = createTaskPollingSession({ storage, fetchTask, onUpdate });
    const fingerprint = await fingerprintSeedanceApiKey("ark-A");
    expect(await session.startCreated({ taskId: "cgt-timer", status: "queued", createdAt: Date.now(), apiKeyFingerprint: fingerprint }, "ark-A")).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchTask).toHaveBeenCalledTimes(2);

    session.clear();
    later.resolve(Response.json({ taskId: "cgt-timer", status: "processing" }));
    await vi.runAllTimersAsync();
    expect(storage.getItem(activeVideoTaskStorageKey)).toBeNull();
    expect(fetchTask).toHaveBeenCalledTimes(2);
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "task", task: expect.objectContaining({ status: "processing" }), stale: true }));
  });

  it("drops a delayed key-A fingerprint after key B becomes current", async () => {
    const storage = new MemoryStorage();
    const owner = await fingerprintSeedanceApiKey("ark-A");
    storage.setItem(activeVideoTaskStorageKey, JSON.stringify({ version: 2, taskId: "cgt-hash", status: "queued", createdAt: Date.now(), apiKeyFingerprint: owner }));
    const pendingHash = deferred<string>();
    const fingerprintKey = vi.fn().mockImplementationOnce(() => pendingHash.promise)
      .mockImplementationOnce(() => fingerprintSeedanceApiKey("ark-B"));
    const fetchTask = vi.fn();
    const onUpdate = vi.fn();
    const session = createTaskPollingSession({ storage, fetchTask, fingerprintKey, onUpdate });

    const first = session.changeKey("ark-A");
    await session.changeKey("ark-B");
    pendingHash.resolve(owner);
    await first;
    expect(fetchTask).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ kind: "pause", reason: "key-mismatch" }));
    expect(storage.getItem(activeVideoTaskStorageKey)).not.toBeNull();
  });

  it("increases the delay after successive transient responses, then resumes normal polling", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const fetchTask = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ taskId: "cgt-backoff", status: "processing" }));
    const session = createTaskPollingSession({ storage, fetchTask, onUpdate: vi.fn() });
    const fingerprint = await fingerprintSeedanceApiKey("ark-A");
    expect(await session.startCreated({ taskId: "cgt-backoff", status: "queued", createdAt: Date.now(), apiKeyFingerprint: fingerprint }, "ark-A")).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchTask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchTask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTask).toHaveBeenCalledTimes(3);
    session.clear();
  });
});
