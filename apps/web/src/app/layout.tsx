import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { appBrand } from '@/lib/brand';
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
  // The browser-tab icon comes from `src/app/icon.svg` via Next's file
  // convention — same artwork as the in-app mark, no separate .ico to drift.
  openGraph: {
    type: 'website',
    siteName: appBrand.name,
    title: `${appBrand.name} — ${appBrand.tagline}`,
    description: appBrand.description,
    url: appBrand.url,
  },
  twitter: {
    card: 'summary',
    title: `${appBrand.name} — ${appBrand.tagline}`,
    description: appBrand.description,
  },
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
