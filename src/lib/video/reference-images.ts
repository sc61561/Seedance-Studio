export type ReferenceImage = {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
  file?: File;
  dataUrl?: string;
  remoteUrl?: string;
  uploadStatus: "uploading" | "uploaded" | "local" | "failed";
  error?: ReferenceImageUploadError;
};

export type ReferenceImageUploadError = {
  code: string;
  params?: Record<string, string | number>;
  detail?: string;
};

export type ReferenceImageUploadResult =
  | { status: "uploaded"; remoteUrl: string }
  | { status: "local"; dataUrl: string }
  | { status: "failed"; error: ReferenceImageUploadError; httpStatus?: number };

export function prepareReferenceImage(
  file: File,
  id: string,
  previewUrl: string,
): ReferenceImage {
  return {
    id,
    name: file.name,
    size: file.size,
    previewUrl,
    file,
    uploadStatus: "uploading",
  };
}

export function applyReferenceImageUploadResult(
  images: ReferenceImage[],
  id: string,
  result: ReferenceImageUploadResult,
): ReferenceImage[] {
  return images.map((image) => {
    if (image.id !== id) return image;

    if (result.status === "uploaded") {
      return {
        id: image.id,
        name: image.name,
        size: image.size,
        previewUrl: image.previewUrl,
        remoteUrl: result.remoteUrl,
        uploadStatus: "uploaded",
      };
    }

    if (result.status === "local") {
      return {
        id: image.id,
        name: image.name,
        size: image.size,
        previewUrl: image.previewUrl,
        dataUrl: result.dataUrl,
        uploadStatus: "local",
      };
    }

    return {
      ...image,
      uploadStatus: "failed",
      error: result.error,
    };
  });
}

export async function resolveReferenceImageUpload(
  file: File,
  readDataUrl: (file: File) => Promise<string> = readFileAsDataUrl,
): Promise<ReferenceImageUploadResult> {
  try {
    return { status: "local", dataUrl: await readDataUrl(file) };
  } catch {
    return { status: "failed", error: { code: "api.uploadFailed" } };
  }
}

export function buildReferenceImagePayload(images: ReferenceImage[]): {
  referenceImageUrls?: string[];
  referenceImageDataUrls?: string[];
} {
  if (images.length > 0 && images.every((image) => image.remoteUrl && image.uploadStatus === "uploaded")) {
    return { referenceImageUrls: images.map((image) => image.remoteUrl!) };
  }

  if (images.length > 0 && images.every((image) => image.uploadStatus === "local" && image.dataUrl)) {
    return { referenceImageDataUrls: images.map((image) => image.dataUrl!) };
  }

  return {};
}

export function referenceImagesReadyForGeneration(images: ReferenceImage[]): boolean {
  if (images.length === 0) return true;
  return images.every((image) => image.uploadStatus === "uploaded" && Boolean(image.remoteUrl))
    || images.every((image) => image.uploadStatus === "local" && Boolean(image.dataUrl));
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

export function moveReferenceImage(
  images: ReferenceImage[],
  sourceId: string,
  offset: -1 | 1,
): ReferenceImage[] {
  const sourceIndex = images.findIndex((image) => image.id === sourceId);
  const targetIndex = sourceIndex + offset;

  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= images.length) {
    return images;
  }

  return reorderReferenceImages(images, sourceId, images[targetIndex].id);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
