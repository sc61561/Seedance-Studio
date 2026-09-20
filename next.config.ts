import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Match Vercel's request ceiling; route/client validation keeps raw images
    // at 3 MiB so Base64 JSON and multipart framing remain below this value.
    proxyClientMaxBodySize: "4.5mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "img-src 'self' data: blob: https:",
              "media-src 'self' data: blob: https:",
              "connect-src 'self' https://ark.cn-beijing.volces.com",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
