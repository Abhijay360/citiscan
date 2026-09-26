import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The API routes read data/*.json from disk at runtime; make sure those files ship with the functions.
  outputFileTracingIncludes: {
    "/api/*": ["./data/**/*"],
  },
};

export default nextConfig;
