/**
 * Each build serves the game's ES modules (public/legacy/js) under its own
 * path, so a browser can never run cached modules from an older deploy next
 * to newer ones (Safari can reuse cached modules without revalidating them).
 */
const legacyAssetVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now());

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    LEGACY_ASSET_VERSION: legacyAssetVersion
  },
  async rewrites() {
    return [
      { source: '/legacy-v/:version/js/:path*', destination: '/legacy/js/:path*' }
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org'
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com'
      }
    ]
  }
};

module.exports = nextConfig;
