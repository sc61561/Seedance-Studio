import { describe, expect, it } from "vitest";

import {
  isSessionUnauthorizedResponse,
  shouldPreserveActiveTaskOnUnauthorized,
} from "@/lib/auth/types";

describe("API unauthorized response policy", () => {
  it("treats only the app session error code as a session expiry", () => {
    expect(isSessionUnauthorizedResponse(401, "api.unauthorized")).toBe(true);
    expect(isSessionUnauthorizedResponse(401, "api.providerAuthFailed")).toBe(false);
    expect(isSessionUnauthorizedResponse(403, "api.unauthorized")).toBe(false);
  });

  it("preserves paid/recovered tasks when upload or polling requires re-authentication", () => {
    expect(shouldPreserveActiveTaskOnUnauthorized("upload")).toBe(true);
    expect(shouldPreserveActiveTaskOnUnauthorized("task")).toBe(true);
    expect(shouldPreserveActiveTaskOnUnauthorized("generate")).toBe(false);
  });
});
