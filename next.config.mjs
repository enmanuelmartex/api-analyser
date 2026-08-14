/**
 * The mail relay has no UI. Everything it serves lives under `app/api`, so the
 * config exists mostly to strip things a public API should not advertise.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Nothing here renders, so there is no reason to name the framework in a
  // response header to anyone scanning the host.
  poweredByHeader: false,

  reactStrictMode: true,

  // Linting is `bun run lint`, against a plain typescript-eslint config. Let
  // the build build: it otherwise looks for the Next ESLint plugin, does not
  // find it, and warns about a config this project deliberately does not use.
  eslint: { ignoreDuringBuilds: true },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // No browser is meant to load this host, and nothing it returns is
          // embeddable.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Crawlers occasionally find subdomains. There is nothing to index.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
