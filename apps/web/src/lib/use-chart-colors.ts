'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

const VAR_NAMES = [
  'severity-critical',
  'severity-high',
  'severity-medium',
  'severity-low',
  'severity-info',
  'success',
  'primary',
  'border',
  'muted-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
] as const;

type ChartColorKey = (typeof VAR_NAMES)[number];
type ChartColors = Record<ChartColorKey, string>;

/**
 * Used for the first paint and if a variable is ever missing. Mirrors the dark
 * theme in `globals.css` — a fallback that disagrees with the stylesheet shows
 * up as a colour flash on the first render of every chart.
 */
const FALLBACK: ChartColors = {
  'severity-critical': 'hsl(0 84% 60%)',
  'severity-high': 'hsl(25 95% 53%)',
  'severity-medium': 'hsl(38 92% 50%)',
  'severity-low': 'hsl(199 89% 58%)',
  'severity-info': 'hsl(240 5% 58%)',
  success: 'hsl(142 70% 45%)',
  primary: 'hsl(211 92% 62%)',
  border: 'hsl(240 6% 16%)',
  'muted-foreground': 'hsl(240 5% 64%)',
  'chart-1': 'hsl(191 81% 55%)',
  'chart-2': 'hsl(211 92% 64%)',
  'chart-3': 'hsl(251 100% 72%)',
};

/**
 * Resolves the app's CSS custom properties (`--severity-critical`, etc.) into concrete
 * `hsl(...)` strings, recomputed on theme change — needed because SVG-based chart libraries
 * (Recharts) don't reliably resolve `var()` inside `fill`/`stroke` presentation attributes.
 */
export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<ChartColors>(FALLBACK);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const next = { ...FALLBACK };
    for (const name of VAR_NAMES) {
      const value = styles.getPropertyValue(`--${name}`).trim();
      if (value) next[name] = `hsl(${value})`;
    }
    setColors(next);
  }, [resolvedTheme]);

  return colors;
}
