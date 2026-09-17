import "server-only";

import { apiError } from "@/lib/video/errors";
import {
  getAuthConfiguration,
  readSessionCookie,
  verifySessionToken,
} from "@/lib/auth/session";

export function requireApiAuth(request: Request): Response | null {
  const config = getAuthConfiguration();

  if (config.mode === "disabled") return null;
  if (config.mode === "unconfigured") {
    return Response.json(apiError("api.authNotConfigured"), { status: 503 });
  }

  const token = readSessionCookie(request.headers.get("cookie"));
  if (!token || !verifySessionToken(token, config.secret)) {
    return Response.json(apiError("api.unauthorized"), { status: 401 });
  }

  return null;
}
