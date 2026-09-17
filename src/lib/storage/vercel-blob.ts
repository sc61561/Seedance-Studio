import "server-only";

import { put } from "@vercel/blob";

import type { StorageProvider, UploadedAsset } from "./types";

export class VercelBlobStorageProvider implements StorageProvider {
  constructor(private readonly token: string) {}

  async uploadReferenceImage(file: File): Promise<UploadedAsset> {
    const extension = extensionFor(file.type);
    const pathname = `reference-images/${crypto.randomUUID()}.${extension}`;
    const asset = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      token: this.token,
    });

    return { url: asset.url, pathname: asset.pathname };
  }
}

function extensionFor(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
