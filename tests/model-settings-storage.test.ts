import { describe, expect, it } from "vitest";

import {
  clearStoredSeedanceModelSettings,
  readStoredSeedanceModelSettings,
  saveStoredSeedanceModelSettings,
  seedanceModelSettingsStorageKey,
} from "@/lib/client/model-settings-storage";

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

describe("Seedance model target browser storage", () => {
  it("stores only a trimmed model and optional official profile", () => {
    const storage = createStorage();

    expect(saveStoredSeedanceModelSettings({
      model: "  ep-project-video-123  ",
      modelProfile: " doubao-seedance-2-5-260628 ",
      apiKey: "must-not-be-persisted",
      ignored: "must-not-be-persisted",
    }, storage)).toBe(true);

    expect(storage.getItem(seedanceModelSettingsStorageKey)).toBe(JSON.stringify({
      model: "ep-project-video-123",
      modelProfile: "doubao-seedance-2-5-260628",
    }));
    expect(readStoredSeedanceModelSettings(storage)).toEqual({
      model: "ep-project-video-123",
      modelProfile: "doubao-seedance-2-5-260628",
    });
    expect(storage.getItem(seedanceModelSettingsStorageKey)).not.toContain("must-not-be-persisted");
  });

  it("sanitizes malformed or unsupported stored values without throwing", () => {
    const storage = createStorage();

    storage.setItem(seedanceModelSettingsStorageKey, "not-json");
    expect(() => readStoredSeedanceModelSettings(storage)).not.toThrow();
    expect(readStoredSeedanceModelSettings(storage)).toBeUndefined();
    expect(storage.getItem(seedanceModelSettingsStorageKey)).toBeNull();

    storage.setItem(seedanceModelSettingsStorageKey, JSON.stringify({
      model: " arbitrary-model ",
      modelProfile: "not-a-profile",
      apiKey: "secret",
    }));
    expect(readStoredSeedanceModelSettings(storage)).toBeUndefined();
    expect(storage.getItem(seedanceModelSettingsStorageKey)).toBeNull();
  });

  it("canonicalizes an older valid record in localStorage while removing API keys and unknown fields", () => {
    const storage = createStorage();
    storage.setItem(seedanceModelSettingsStorageKey, JSON.stringify({
      model: "  doubao-seedance-2-5-260628  ",
      modelProfile: " doubao-seedance-2-5-260628 ",
      apiKey: "legacy-secret",
      unknown: { persisted: true },
    }));

    expect(readStoredSeedanceModelSettings(storage)).toEqual({
      model: "doubao-seedance-2-5-260628",
      modelProfile: "doubao-seedance-2-5-260628",
    });
    expect(storage.getItem(seedanceModelSettingsStorageKey)).toBe(JSON.stringify({
      model: "doubao-seedance-2-5-260628",
      modelProfile: "doubao-seedance-2-5-260628",
    }));
    expect(storage.getItem(seedanceModelSettingsStorageKey)).not.toContain("legacy-secret");
  });

  it("rejects a blank model and clears the local target without touching API-key storage", () => {
    const storage = createStorage();
    storage.setItem("seedance.userApiKey", "keep-this-key");

    expect(saveStoredSeedanceModelSettings({ model: "   " }, storage)).toBe(false);
    expect(clearStoredSeedanceModelSettings(storage)).toBe(true);
    expect(storage.getItem(seedanceModelSettingsStorageKey)).toBeNull();
    expect(storage.getItem("seedance.userApiKey")).toBe("keep-this-key");
  });
});
