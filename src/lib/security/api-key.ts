import "server-only";

import { apiError, type ApiErrorBody } from "@/lib/video/errors";

export const seedanceApiKeyHeader = "x-seedance-api-key";
export const maxSeedanceApiKeyLength = 512;

type ApiKeySuccess = { ok: true; apiKey: string };
type ApiKeyFailure = {
  ok: false;
  code: "api.apiKeyRequired" | "api.apiKeyInvalid";
};

export type SeedanceApiKeyResult = ApiKeySuccess | ApiKeyFailure;

/**
 * Reads a per-request Seedance key without ever including it in an error body.
 * The browser sends this value in a header so it cannot leak through URLs or
 * task payloads. Only printable ASCII is accepted because the upstream
 * Authorization header is a token value, not free-form text.
 */
export function readSeedanceApiKey(request: Request): SeedanceApiKeyResult {
  const raw = request.headers.get(seedanceApiKeyHeader);
  if (raw === null || raw.trim() === "") {
    return { ok: false, code: "api.apiKeyRequired" };
  }

  const apiKey = raw.trim();
  if (
    apiKey.length > maxSeedanceApiKeyLength
    || !/^[\x21-\x7e]+$/.test(apiKey)
  ) {
    return { ok: false, code: "api.apiKeyInvalid" };
  }

  return { ok: true, apiKey };
}

export function seedanceApiKeyErrorResponse(result: ApiKeyFailure): Response {
  const body: ApiErrorBody = apiError(result.code);
  return Response.json(body, {
    status: result.code === "api.apiKeyRequired" ? 401 : 400,
  });
}
