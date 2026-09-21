import {
  readSeedanceApiKey,
  seedanceApiKeyErrorResponse,
} from "@/lib/security/api-key";
import { enforceTaskRateLimit } from "@/lib/security/rate-limit";
import { apiError } from "@/lib/video/errors";
import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";

type TaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: TaskRouteContext,
): Promise<Response> {
  const apiKey = readSeedanceApiKey(request);
  if (!apiKey.ok) return seedanceApiKeyErrorResponse(apiKey);

  const { id } = await context.params;

  if (!id) {
    return Response.json(apiError("api.taskIdInvalid"), { status: 400 });
  }

  const rateLimitError = enforceTaskRateLimit(request);
  if (rateLimitError) return rateLimitError;

  try {
    const task = await new SeedanceProvider(apiKey.apiKey).getTask(id);
    return Response.json(task);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      return Response.json(
        apiError(error.code, error.params, error.detail, error.requestId),
        { status: error.statusCode },
      );
    }

    return Response.json(apiError("api.queryFailed"), { status: 502 });
  }
}
