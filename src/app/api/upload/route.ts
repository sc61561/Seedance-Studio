import { requireApiAuth } from "@/lib/auth/guard";
import { apiError } from "@/lib/video/errors";
import { getStorageProvider } from "@/lib/storage";

export const runtime = "nodejs";

const maxImageBytes = 8 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request): Promise<Response> {
  const authError = requireApiAuth(request);
  if (authError) return authError;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("api.invalidRequest");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("api.uploadFileRequired");
  }

  if (!acceptedImageTypes.has(file.type)) {
    return errorResponse("api.refUnsupportedType");
  }

  if (file.size > maxImageBytes) {
    return errorResponse("api.refTooLargeSingle");
  }

  if (!(await hasMatchingImageSignature(file))) {
    return errorResponse("api.refInvalidContent");
  }

  const storage = getStorageProvider();
  if (!storage) {
    return errorResponse("api.storageNotConfigured", 503);
  }

  try {
    return Response.json(await storage.uploadReferenceImage(file));
  } catch {
    return errorResponse("api.uploadFailed", 502);
  }
}

function errorResponse(code: string, status = 400): Response {
  return Response.json(apiError(code), { status });
}

async function hasMatchingImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (file.type === "image/png") {
    return matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }

  if (file.type === "image/jpeg") {
    return matches(bytes, [0xff, 0xd8, 0xff]);
  }

  return matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
}

function matches(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
