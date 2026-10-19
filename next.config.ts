import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: "/docs", permanent: false }];
  },
};

export default nextConfig;
