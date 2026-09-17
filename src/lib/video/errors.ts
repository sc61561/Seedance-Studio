// Shared API error contract. Routes return a stable `code` (and optional `params`);
// the client localizes it via the i18n dictionary (keys prefixed with `api.`).

export type ApiErrorParams = Record<string, string | number>;

export interface ApiErrorBody {
  code: string;
  params?: ApiErrorParams;
  // Optional already-formatted detail that is language-neutral (e.g. provider HTTP label).
  detail?: string;
}

export function apiError(code: string, params?: ApiErrorParams, detail?: string): ApiErrorBody {
  const body: ApiErrorBody = { code };
  if (params) body.params = params;
  if (detail) body.detail = detail;
  return body;
}
