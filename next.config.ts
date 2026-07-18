import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./.agents/**/*",
      "./.brainclaw/**/*",
      "./.continue/**/*",
      "./.cursor/**/*",
      "./.git/**/*",
      "./.github/**/*",
      "./.kilo/**/*",
      "./.roo/**/*",
      "./.windsurf/**/*",
      "./coverage/**/*",
      "./desktop-runtime/**/*",
      "./out/**/*",
      "./playwright-report/**/*",
      "./projects/**/*",
      "./skills/**/*",
      "./desktop/**/*",
      "./test-results/**/*",
      "./tests/**/*",
      "./docs/**/*",
      "./.local-reference-assets/**/*",
      "./.local-project-materials/**/*"
    ]
  },
  // The local browser bridge exposes localhost through this loopback alias.
  // Restrict the exception to development HMR resources for that exact host.
  allowedDevOrigins: ["127.94.0.1"]
};

export default nextConfig;
