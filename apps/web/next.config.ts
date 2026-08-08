import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [],
  /**
   * `next build` and `next dev` cannot share an output directory — a build wipes
   * the manifests the running dev server is serving from. Setting NEXT_DIST_DIR
   * lets a production build (or a Lighthouse run against one) happen alongside a
   * live `bun dev` instead of killing it.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Nothing reads this header and it announces the framework version on every
  // response.
  poweredByHeader: false,
  experimental: {
    /**
     * Rewrites barrel imports (`import { IconShield } from '@tabler/icons-react'`)
     * into direct module paths so the bundler pulls one icon instead of walking
     * an index that re-exports thousands.
     *
     * Several of these are in Next's built-in default list, but that list is an
     * implementation detail that has changed between releases — and this app has
     * 55 files importing from `@tabler/icons-react` alone. Declaring them makes
     * the optimisation a property of the project rather than of the Next version.
     */
    optimizePackageImports: [
      '@tabler/icons-react',
      'lucide-react',
      'recharts',
      'date-fns',
      '@tanstack/react-table',
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
