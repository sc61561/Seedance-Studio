import { apiError } from "@/lib/video/errors";
import { getStorageProvider } from "@/lib/storage";

export const runtime = "nodejs";

const maxImageBytes = 8 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request): Promise<Response> {
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
