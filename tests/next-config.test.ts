import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";

describe("Next 配置", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("allows only the configured Worker origin in connect-src", async () => {
    vi.stubEnv("NEXT_PUBLIC_SEEDANCE_WORKER_ORIGIN", "https://upload.example.com");
    const rules = await nextConfig.headers?.();
    const csp = rules?.flatMap((rule) => rule.headers ?? [])
      .find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("https://upload.example.com");
    expect(csp).not.toContain("*.workers.dev");
  });
  it("不把代理请求体上限配置到 Vercel 4.5 MB 平台限制之上", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("4.5mb");
  });

  it("返回限制第三方脚本的基础 CSP", async () => {
    const rules = await nextConfig.headers?.();
    const csp = rules?.flatMap((rule) => rule.headers ?? [])
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });
});
