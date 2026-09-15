import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 8 MB 原图编码为 data URL 后约为 10.7 MB，需留出 JSON 请求体余量。
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
