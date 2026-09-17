import {
  createSessionToken,
  getAuthConfiguration,
  passwordMatches,
  serializeSessionCookie,
} from "@/lib/auth/session";
import { apiError } from "@/lib/video/errors";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const config = getAuthConfiguration();
  if (config.mode === "unconfigured") {
    return Response.json(apiError("api.authNotConfigured"), { status: 503 });
  }
  if (config.mode === "disabled") {
    return Response.json({ authenticated: true });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(apiError("api.invalidRequest"), { status: 400 });
  }

  if (!isRecord(payload)) {
    return Response.json(apiError("api.invalidRequest"), { status: 400 });
  }

  if (typeof payload.password !== "string" || !payload.password) {
    return Response.json(apiError("api.passwordRequired"), { status: 400 });
  }

  if (!passwordMatches(payload.password, config.password)) {
    return Response.json(apiError("api.invalidPassword"), { status: 401 });
  }

  return Response.json(
    { authenticated: true },
    { headers: { "Set-Cookie": serializeSessionCookie(createSessionToken(config.secret)) } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
