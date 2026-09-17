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

type UploadFetcher = (input: string, init: RequestInit) => Promise<Response>;

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
  fetchUpload: UploadFetcher = fetch,
  readDataUrl: (file: File) => Promise<string> = readFileAsDataUrl,
): Promise<ReferenceImageUploadResult> {
  try {
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetchUpload("/api/upload", { method: "POST", body: formData });
    const payload = await readUploadResponse(response);

    if (response.ok && typeof payload.url === "string" && payload.url) {
      return { status: "uploaded", remoteUrl: payload.url };
    }

    if (response.status === 503 && payload.code === "api.storageNotConfigured") {
      return { status: "local", dataUrl: await readDataUrl(file) };
    }

    return {
      status: "failed",
      error: errorFromUploadPayload(payload),
      httpStatus: response.status,
    };
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

async function readUploadResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function errorFromUploadPayload(payload: Record<string, unknown>): ReferenceImageUploadError {
  return {
    code: typeof payload.code === "string" ? payload.code : "api.uploadFailed",
    ...(isErrorParams(payload.params) ? { params: payload.params } : {}),
    ...(typeof payload.detail === "string" ? { detail: payload.detail } : {}),
  };
}

function isErrorParams(value: unknown): value is Record<string, string | number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string" || typeof item === "number");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
