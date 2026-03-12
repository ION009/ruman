import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const publicBackendBaseURL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const rewriteBackendBaseURL = (
  process.env.BACKEND_PROXY_URL ||
  (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicBackendBaseURL)
    ? "http://backend:3001"
    : publicBackendBaseURL)
).replace(/\/$/, "");

const withNextIntl = createNextIntlPlugin({
  experimental: {
    srcPath: "./src",
    extract: { sourceLocale: "en" },
    messages: {
      path: "./messages",
      format: "json",
      locales: ["en", "de", "fr", "zh", "es", "pl", "it", "ko", "pt", "ja", "cs"],
    },
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_DISABLE_SIGNUP: process.env.NEXT_PUBLIC_DISABLE_SIGNUP,
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
  async rewrites() {
    return [
      {
        source: "/api/script.js",
        destination: `${rewriteBackendBaseURL}/api/script.js`,
      },
      {
        source: "/api/replay.js",
        destination: `${rewriteBackendBaseURL}/api/replay.js`,
      },
      {
        source: "/api/track",
        destination: `${rewriteBackendBaseURL}/api/track`,
      },
      {
        source: "/api/identify",
        destination: `${rewriteBackendBaseURL}/api/identify`,
      },
      {
        source: "/api/site/:path*",
        destination: `${rewriteBackendBaseURL}/api/site/:path*`,
      },
      {
        source: "/api/session-replay/:path*",
        destination: `${rewriteBackendBaseURL}/api/session-replay/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
