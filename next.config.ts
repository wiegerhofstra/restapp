import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: { position: "bottom-right" },
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
