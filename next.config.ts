import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // allow server to import these packages without bundling their internals
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core'],
  webpack: (config) => {
    // keep Node built-ins external so Webpack doesn't try to polyfill/inline them
    config.externals = config.externals || [];
    config.externals.push({
      'worker_threads': 'commonjs worker_threads',
      'node:worker_threads': 'commonjs node:worker_threads',
      'fs': 'commonjs fs',
      'path': 'commonjs path',
    });
    return config;
  },
};

export default nextConfig;
