import type { MetadataRoute } from 'next';
import { appBrand, brandColors } from '@/lib/brand';

/**
 * Web app manifest, generated from the central brand config via Next's
 * `manifest.ts` convention rather than a static JSON file — so the installed
 * app name can never disagree with the name in the sidebar.
 *
 * The icons are the official app icon, not the bare symbol: an installed app
 * lands on a launcher whose wallpaper we do not control, so the artwork has to
 * bring its own dark tile rather than rely on a transparent background.
 *
 * Colours are the brand Canvas, matching the splash the shell paints.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${appBrand.name} — ${appBrand.tagline}`,
    short_name: appBrand.shortName,
    description: appBrand.description,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: brandColors.canvas,
    theme_color: brandColors.canvas,
    icons: [
      { src: '/brand/app-icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/brand/app-icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
    ],
  };
}
