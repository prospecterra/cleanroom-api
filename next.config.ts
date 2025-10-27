import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security and performance configuration

  // Limit request body size to 500KB (prevents large payload attacks)
  // Note: Individual endpoints validate company objects separately
  experimental: {
    // Max request body size (in bytes)
    serverActions: {
      bodySizeLimit: '500kb',
    },
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
