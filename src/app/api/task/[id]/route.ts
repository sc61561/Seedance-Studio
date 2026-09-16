import { SeedanceProvider, VideoProviderError } from "@/lib/video/providers/seedance";

type TaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: TaskRouteContext,
): Promise<Response> {
  void request;
  const { id } = await context.params;

  if (!id) {
    return Response.json({ error: "任务编号不正确。" }, { status: 400 });
  }

  try {
    const task = await new SeedanceProvider().getTask(id);
    return Response.json(task);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    return Response.json(
      { error: "视频任务查询失败，请稍后重试。" },
      { status: 502 },
    );
  }
}
