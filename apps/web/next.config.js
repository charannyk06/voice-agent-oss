/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@voice-agent/shared"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};

module.exports = nextConfig;
