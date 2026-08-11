import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { brand, brandColors } from '@/lib/site';
import './globals.css';

/**
 * Inter is the brand's typeface — SemiBold (600) for the wordmark — and
 * JetBrains Mono carries every command and code block. The same pair the product
 * itself loads, so the site and the app read as one thing.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-jetbrains',
  display: 'swap',
});

/**
 * Where this page is served from.
 *
 * Only used to turn the OG image into the absolute URL crawlers require. Set
 * `NEXT_PUBLIC_SITE_URL` when deploying somewhere other than the brand domain —
 * a GitHub Pages project site, a preview deployment — or the card will point at
 * a host that does not have the image.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://apianalyser.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
  applicationName: brand.name,
  keywords: [
    'API security',
    'OWASP API Top 10',
    'OpenAPI',
    'Swagger',
    'vulnerability scanner',
    'DAST',
    'SARIF',
    'self-hosted',
    'open source',
  ],
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: brand.name,
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: brandColors.canvas,
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `dark` is declared rather than detected: this page has one surface.
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-brand-canvas font-sans antialiased">{children}</body>
    </html>
  );
}
