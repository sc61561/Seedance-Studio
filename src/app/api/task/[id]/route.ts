import { requireApiAuth } from "@/lib/auth/guard";
import { apiError } from "@/lib/video/errors";
import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";

type TaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: TaskRouteContext,
): Promise<Response> {
  const authError = requireApiAuth(request);
  if (authError) return authError;

  const { id } = await context.params;

  if (!id) {
    return Response.json(apiError("api.taskIdInvalid"), { status: 400 });
  }

  try {
    const task = await new SeedanceProvider().getTask(id);
    return Response.json(task);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      return Response.json(
        apiError(error.code, error.params, error.detail),
        { status: error.statusCode },
      );
    }

    return Response.json(apiError("api.queryFailed"), { status: 502 });
  }
}
