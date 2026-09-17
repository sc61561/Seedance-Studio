import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  registerSeedanceServiceWorker,
  ServiceWorkerRegister,
} from "@/components/pwa/service-worker-register";

describe("ServiceWorkerRegister", () => {
  it("registers the local worker for the whole app without producing UI", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "https://studio.test/" });

    await expect(registerSeedanceServiceWorker({ register })).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(renderToStaticMarkup(<ServiceWorkerRegister />)).toBe("");
  });

  it("is a silent no-op when service workers are unsupported or registration fails", async () => {
    await expect(registerSeedanceServiceWorker(undefined)).resolves.toBe(false);
    await expect(
      registerSeedanceServiceWorker({
        register: vi.fn().mockRejectedValue(new Error("unsupported")),
      }),
    ).resolves.toBe(false);
  });
});
