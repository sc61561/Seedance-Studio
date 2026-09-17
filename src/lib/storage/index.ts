import "server-only";

import { VercelBlobStorageProvider } from "./vercel-blob";
import type { StorageProvider } from "./types";

export type { StorageProvider, UploadedAsset } from "./types";

export function getStorageProvider(): StorageProvider | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? new VercelBlobStorageProvider(token) : null;
}
