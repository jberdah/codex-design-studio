import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./desktop-runtime/**/*",
      "./out/**/*",
      "./projects/**/*",
      "./skills/**/*",
      "./desktop/**/*",
      "./tests/**/*",
      "./docs/**/*",
      "./.local-reference-assets/**/*"
    ]
  },
  // The local browser bridge exposes localhost through this loopback alias.
  // Restrict the exception to development HMR resources for that exact host.
  allowedDevOrigins: ["127.94.0.1"]
};

export default nextConfig;
