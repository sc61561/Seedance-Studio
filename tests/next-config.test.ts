import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Next 配置", () => {
  it("不把代理请求体上限配置到 Vercel 4.5 MB 平台限制之上", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("4.5mb");
  });
});
