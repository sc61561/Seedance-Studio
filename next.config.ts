import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Match Vercel's request ceiling; route/client validation keeps raw images
    // at 3 MiB so Base64 JSON and multipart framing remain below this value.
    proxyClientMaxBodySize: "4.5mb",
  },
};

export default nextConfig;
