export type AuthGateState =
  | "disabled"
  | "authenticated"
  | "unauthenticated"
  | "unconfigured";

export type UnauthorizedRequestSource = "generate" | "upload" | "task";

export function isSessionUnauthorizedResponse(status: number, code?: string): boolean {
  return status === 401 && code === "api.unauthorized";
}

export function shouldPreserveActiveTaskOnUnauthorized(
  source: UnauthorizedRequestSource,
): boolean {
  return source === "upload" || source === "task";
}
