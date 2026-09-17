export const maxReferenceImages = 10;

// Vercel Functions reject request bodies above 4.5 MB. Keeping the raw image
// budget at 3 MiB leaves room for multipart framing and for the ~4 MiB Base64
// compatibility payload used only when object storage is not configured.
export const maxReferenceImageBytes = 3 * 1024 * 1024;

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
