import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { appBrand, brandColors } from '@/lib/brand';
import { ThemedToaster } from '@/components/layout/themed-toaster';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(appBrand.url),
  title: {
    default: `${appBrand.name} — ${appBrand.tagline}`,
    template: `%s | ${appBrand.name}`,
  },
  description: appBrand.description,
  applicationName: appBrand.name,
  keywords: ['API security', 'OWASP', 'vulnerability scanner', 'penetration testing', 'API testing'],
  /*
   * Icons and the social card come from Next's file conventions in this
   * directory — `favicon.ico`, `icon.png`, `apple-icon.png` and
   * `opengraph-image.png`, all generated from `branding/`. Declaring them here
   * as well would give the framework two sources of truth for the same tags.
   *
   * All four carry the official dark app tile rather than the bare symbol: a
   * tab strip, a launcher and a link preview each sit on a background we do
   * not control, and transparent artwork disappears into half of them.
   */
  openGraph: {
    type: 'website',
    siteName: appBrand.name,
    title: `${appBrand.name} — ${appBrand.tagline}`,
    description: appBrand.description,
    url: appBrand.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${appBrand.name} — ${appBrand.tagline}`,
    description: appBrand.description,
  },
};

/**
 * The browser paints `theme-color` behind the page — on the mobile URL bar, on
 * a PWA splash — before any CSS runs, so it has to be the brand Canvas rather
 * than a token: at that point no theme class exists yet.
 */
export const viewport: Viewport = {
  themeColor: brandColors.canvas,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} font-sans min-h-screen bg-background`}>
        <Providers>
          {children}
          <ThemedToaster />
        </Providers>
      </body>
    </html>
  );
}
