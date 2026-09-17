export type UploadedAsset = {
  url: string;
  pathname: string;
};

export interface StorageProvider {
  uploadReferenceImage(file: File): Promise<UploadedAsset>;
}
