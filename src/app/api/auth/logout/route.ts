import { serializeClearedSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": serializeClearedSessionCookie() } },
  );
}
