// The Worker protocol keeps JSON metadata small and streams image Base64 after
// the first newline, in order. Keys are ONLY sent in the request header.
export const workerUploadContentType = "application/x-seedance-upload";
export const maxWorkerImageBytes = 15 * 1024 * 1024;
export const maxWorkerTotalImageBytes = 45 * 1024 * 1024;
export const maxWorkerRequestBytes = 64_000_000;
export const maxWorkerMetadataBytes = 16_384;

export type UploadImageDescriptor = { mimeType: string; byteLength: number };

export function getWorkerOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch { return undefined; }
}

export function configuredWorkerOrigin(): string | undefined {
  return getWorkerOrigin(process.env.NEXT_PUBLIC_SEEDANCE_WORKER_ORIGIN);
}

export function buildWorkerUpload(payload: Record<string, unknown>): Blob {
  const dataUrls = payload.referenceImageDataUrls;
  if (!Array.isArray(dataUrls)) throw new Error("api.refInvalidFormat");
  const images: UploadImageDescriptor[] = [];
  const parts: string[] = [];
  for (const url of dataUrls) {
    if (typeof url !== "string") throw new Error("api.refInvalidFormat");
    const prefix = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(url);
    if (!prefix) throw new Error("api.refUnsupportedType");
    const base64 = url.slice(prefix[0].length);
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    images.push({ mimeType: prefix[1], byteLength: base64.length / 4 * 3 - padding });
    parts.push(base64);
  }
  // Explicit allowlist: do not serialize arbitrary fields or API credentials.
  const metadata = JSON.stringify({
    version: 1, prompt: payload.prompt, model: payload.model,
    modelProfile: payload.modelProfile, generationMode: payload.generationMode,
    generateAudio: payload.generateAudio, duration: payload.duration,
    resolution: payload.resolution, aspectRatio: payload.aspectRatio, images,
  });
  if (new TextEncoder().encode(metadata).byteLength > maxWorkerMetadataBytes) {
    throw new Error("api.requestTooLarge");
  }
  return new Blob([metadata, "\n", ...parts], { type: workerUploadContentType });
}
