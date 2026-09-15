import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";

const maxPromptLength = 2_000;
const maxImageBytes = 8 * 1024 * 1024;
const imageDataUrlPattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function POST(request: Request): Promise<Response> {
  const payload = await parseRequest(request);

  if (!payload) {
    return errorResponse("请求格式不正确。");
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return errorResponse("请输入提示词。");
  }

  if (prompt.length > maxPromptLength) {
    return errorResponse(`提示词不能超过 ${maxPromptLength} 个字符。`);
  }

  const referenceImageDataUrl = payload.referenceImageDataUrl;
  if (referenceImageDataUrl !== undefined) {
    const imageError = validateReferenceImage(referenceImageDataUrl);
    if (imageError) {
      return errorResponse(imageError);
    }
  }

  try {
    const task = await new SeedanceProvider().createTask({
      provider: "seedance",
      model: "",
      prompt,
      referenceImageUrl:
        typeof referenceImageDataUrl === "string" ? referenceImageDataUrl : undefined,
    });

    return Response.json(task);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      return errorResponse(error.message, error.statusCode);
    }

    return errorResponse("视频任务创建失败，请稍后重试。", 502);
  }
}

async function parseRequest(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await request.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function validateReferenceImage(value: unknown): string | null {
  if (typeof value !== "string") {
    return "参考图格式不正确。";
  }

  const match = imageDataUrlPattern.exec(value);
  if (!match) {
    return "参考图仅支持 PNG、JPEG 或 WebP 格式。";
  }

  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = (base64.length * 3) / 4 - padding;

  return byteLength > maxImageBytes ? "参考图不能超过 8 MB。" : null;
}

function errorResponse(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
