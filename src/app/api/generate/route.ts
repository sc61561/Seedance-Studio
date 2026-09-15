import { Buffer } from "node:buffer";

import { defaultSeedanceModel, getSeedanceModel } from "@/lib/video/models";
import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";

export const runtime = "nodejs";

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

  const modelResolution = resolveModel(payload.model);
  if ("error" in modelResolution) {
    return errorResponse(modelResolution.error);
  }

  try {
    const task = await new SeedanceProvider().createTask({
      provider: "seedance",
      model: modelResolution.model,
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
  if (base64.length % 4 !== 0) {
    return "参考图格式不正确。";
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = (base64.length * 3) / 4 - padding;

  if (byteLength > maxImageBytes) {
    return "参考图不能超过 8 MB。";
  }

  const imageBytes = Buffer.from(base64, "base64");
  return hasMatchingImageSignature(match[1], imageBytes)
    ? null
    : "参考图内容不是有效的 PNG、JPEG 或 WebP 图片。";
}

function resolveModel(value: unknown): { model: string } | { error: string } {
  if (value !== undefined && typeof value !== "string") {
    return { error: "请选择支持的官方 Seedance 模型。" };
  }

  const modelId = value?.trim() || defaultSeedanceModel();
  const model = getSeedanceModel(modelId);

  if (!model) {
    return { error: "请选择支持的官方 Seedance 模型。" };
  }

  return { model: model.id };
}

function hasMatchingImageSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === "jpeg") {
    return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }

  return (
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  );
}

function errorResponse(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
