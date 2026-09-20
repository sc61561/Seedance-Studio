export const seedanceApiKeyStorageKey = "seedance.userApiKey";
const seedanceApiKeyChangedEvent = "seedance-api-key-changed";

export function subscribeToStoredSeedanceApiKey(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener(seedanceApiKeyChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(seedanceApiKeyChangedEvent, onChange);
  };
}

export function getStoredSeedanceApiKeySnapshot(): string {
  return readStoredSeedanceApiKey();
}

export function isApiKeyUnauthorizedResponse(status: number, code?: string): boolean {
  return status === 401 && code === "api.apiKeyRequired";
}

export type ApiKeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(storage?: ApiKeyStorage): ApiKeyStorage | undefined {
  if (storage) return storage;
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredSeedanceApiKey(storage?: ApiKeyStorage): string {
  const target = browserStorage(storage);
  if (!target) return "";

  try {
    return target.getItem(seedanceApiKeyStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveStoredSeedanceApiKey(
  apiKey: string,
  storage?: ApiKeyStorage,
): boolean {
  const target = browserStorage(storage);
  if (!target) return false;

  const normalized = apiKey.trim();
  if (!normalized) return clearStoredSeedanceApiKey(target);

  try {
    target.setItem(seedanceApiKeyStorageKey, normalized);
    notifyApiKeyChanged();
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSeedanceApiKey(storage?: ApiKeyStorage): boolean {
  const target = browserStorage(storage);
  if (!target) return false;

  try {
    target.removeItem(seedanceApiKeyStorageKey);
    notifyApiKeyChanged();
    return true;
  } catch {
    return false;
  }
}

function notifyApiKeyChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(seedanceApiKeyChangedEvent));
}
