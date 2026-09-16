export type ReferenceImage = {
  id: string;
  name: string;
  dataUrl: string;
};

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
