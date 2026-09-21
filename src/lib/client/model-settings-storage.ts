import {
  resolveSeedanceTarget,
  type OfficialSeedanceModelId,
} from "@/lib/video/models";

export const seedanceModelSettingsStorageKey = "seedance.modelSettings";
const seedanceModelSettingsChangedEvent = "seedance-model-settings-changed";

export type SeedanceModelSettings = {
  model: string;
  modelProfile?: OfficialSeedanceModelId;
};

export type ModelSettingsStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function subscribeToStoredSeedanceModelSettings(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener(seedanceModelSettingsChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(seedanceModelSettingsChangedEvent, onChange);
  };
}

export function getStoredSeedanceModelSettingsSnapshot(): SeedanceModelSettings | undefined {
  return readStoredSeedanceModelSettings();
}

export function readStoredSeedanceModelSettings(
  storage?: ModelSettingsStorage,
): SeedanceModelSettings | undefined {
  const target = browserStorage(storage);
  if (!target) return undefined;

  try {
    const raw = target.getItem(seedanceModelSettingsStorageKey);
    if (!raw) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      removeStoredSettings(target);
      return undefined;
    }

    const sanitized = sanitizeStoredSettings(parsed);
    if (!sanitized) {
      removeStoredSettings(target);
      return undefined;
    }

    const canonical = JSON.stringify(sanitized);
    if (canonical !== raw) {
      try {
        target.setItem(seedanceModelSettingsStorageKey, canonical);
      } catch {
        // Reading remains resilient when an older browser storage is read-only.
      }
    }
    return sanitized;
  } catch {
    return undefined;
  }
}

/**
 * Persist only the model target. In particular, unknown fields (including an
 * API key supplied by an untyped caller) are intentionally discarded.
 */
export function saveStoredSeedanceModelSettings(
  settings: unknown,
  storage?: ModelSettingsStorage,
): boolean {
  const target = browserStorage(storage);
  if (!target) return false;

  const sanitized = sanitizeStoredSettings(settings);
  if (!sanitized) return false;

  try {
    target.setItem(seedanceModelSettingsStorageKey, JSON.stringify(sanitized));
    notifyModelSettingsChanged();
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSeedanceModelSettings(
  storage?: ModelSettingsStorage,
): boolean {
  const target = browserStorage(storage);
  if (!target) return false;

  try {
    target.removeItem(seedanceModelSettingsStorageKey);
    notifyModelSettingsChanged();
    return true;
  } catch {
    return false;
  }
}

function browserStorage(storage?: ModelSettingsStorage): ModelSettingsStorage | undefined {
  if (storage) return storage;
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function sanitizeStoredSettings(value: unknown): SeedanceModelSettings | undefined {
  if (!isRecord(value) || typeof value.model !== "string") return undefined;

  const model = value.model.trim();
  if (!model) return undefined;

  const modelProfile = value.modelProfile === undefined
    ? undefined
    : typeof value.modelProfile === "string"
      ? value.modelProfile.trim()
      : "";
  if (modelProfile === "") return undefined;

  const resolved = resolveSeedanceTarget(model, modelProfile);
  if (!resolved) return undefined;

  return {
    model: resolved.model,
    ...(modelProfile ? { modelProfile: resolved.modelProfile } : {}),
  };
}

function notifyModelSettingsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(seedanceModelSettingsChangedEvent));
}

function removeStoredSettings(storage: ModelSettingsStorage): void {
  try {
    storage.removeItem(seedanceModelSettingsStorageKey);
  } catch {
    // Storage can be unavailable or read-only; callers still receive a safe
    // undefined result and never see a storage exception.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
