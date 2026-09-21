export const maxReferenceImages = 10;

// This decoded-byte limit is distinct from the serialized request-body limit:
// Base64 overhead means a data-URL request can hit the body limit first.
export const maxReferenceImageBytes = 3 * 1024 * 1024;

export const maxGenerationRequestBytes = 4_000_000;

export const acceptedReferenceImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const extensionsByMimeType: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

export function hasMatchingReferenceImageExtension(name: string, mimeType: string): boolean {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return Boolean(extension && extensionsByMimeType[mimeType]?.includes(extension));
}
