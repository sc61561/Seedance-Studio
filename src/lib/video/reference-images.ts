export type ReferenceImage = {
  id: string;
  name: string;
  dataUrl: string;
  previewUrl: string;
  remoteUrl?: string;
  uploadStatus: "uploading" | "uploaded" | "local";
};

export function buildReferenceImagePayload(images: ReferenceImage[]): {
  referenceImageUrls?: string[];
  referenceImageDataUrls?: string[];
} {
  if (images.length > 0 && images.every((image) => image.remoteUrl && image.uploadStatus === "uploaded")) {
    return { referenceImageUrls: images.map((image) => image.remoteUrl!) };
  }

  return images.length > 0 ? { referenceImageDataUrls: images.map((image) => image.dataUrl) } : {};
}

export function reorderReferenceImages(
  images: ReferenceImage[],
  sourceId: string,
  targetId: string,
): ReferenceImage[] {
  const sourceIndex = images.findIndex((image) => image.id === sourceId);
  const targetIndex = images.findIndex((image) => image.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return images;
  }

  const reordered = [...images];
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source);
  return reordered;
}
