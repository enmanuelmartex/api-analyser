import type { MetadataRoute } from 'next';
import { appBrand } from '@/lib/brand';

/**
 * Web app manifest, generated from the central brand config via Next's
 * `manifest.ts` convention rather than a static JSON file — so the installed
 * app name can never disagree with the name in the sidebar.
 *
 * Colours match the application shell's dark surface.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${appBrand.name} — ${appBrand.tagline}`,
    short_name: appBrand.shortName,
    description: appBrand.description,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      {
        src: appBrand.logos.icon,
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
    ],
  };
}
