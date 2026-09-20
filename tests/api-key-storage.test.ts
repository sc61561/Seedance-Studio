import { describe, expect, it } from "vitest";

import {
  clearStoredSeedanceApiKey,
  readStoredSeedanceApiKey,
  saveStoredSeedanceApiKey,
  seedanceApiKeyStorageKey,
} from "@/lib/client/api-key-storage";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

describe("Seedance API key browser storage", () => {
  it("trims and saves only the local browser value", () => {
    const storage = createStorage();

    expect(saveStoredSeedanceApiKey("  ark-user-key  ", storage)).toBe(true);
    expect(storage.getItem(seedanceApiKeyStorageKey)).toBe("ark-user-key");
    expect(readStoredSeedanceApiKey(storage)).toBe("ark-user-key");
  });

  it("clears the local value without returning it to callers", () => {
    const storage = createStorage();
    saveStoredSeedanceApiKey("ark-user-key", storage);

    expect(clearStoredSeedanceApiKey(storage)).toBe(true);
    expect(readStoredSeedanceApiKey(storage)).toBe("");
  });

  it("treats a blank save as a clear operation", () => {
    const storage = createStorage();
    saveStoredSeedanceApiKey("ark-user-key", storage);

    expect(saveStoredSeedanceApiKey("   ", storage)).toBe(true);
    expect(storage.getItem(seedanceApiKeyStorageKey)).toBeNull();
  });
});
