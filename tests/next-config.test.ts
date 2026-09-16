import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Next 配置", () => {
  it("允许接收编码后的 8 MB 参考图请求", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("12mb");
  });
});
