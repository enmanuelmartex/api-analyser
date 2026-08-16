import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        cyan: {
          DEFAULT: 'hsl(var(--cyan) / <alpha-value>)',
        },
        /* Reserved for AI-generated affordances. See `--ai` in globals.css. */
        ai: {
          DEFAULT: 'hsl(var(--ai) / <alpha-value>)',
        },
        /*
         * The literal brand palette. Use the semantic tokens above for
         * anything the theme owns; reach for `brand-*` only when the value has
         * to be the brand value regardless of theme — the mark's ink, an AI
         * affordance, a chart series.
         */
        brand: {
          ink: 'hsl(var(--brand-ink) / <alpha-value>)',
          canvas: 'hsl(var(--brand-canvas) / <alpha-value>)',
          white: 'hsl(var(--brand-white) / <alpha-value>)',
          violet: 'hsl(var(--brand-violet) / <alpha-value>)',
          indigo: 'hsl(var(--brand-indigo) / <alpha-value>)',
          blue: 'hsl(var(--brand-blue) / <alpha-value>)',
          cyan: 'hsl(var(--brand-cyan) / <alpha-value>)',
          ice: 'hsl(var(--brand-ice) / <alpha-value>)',
        },
        severity: {
          critical: 'hsl(var(--severity-critical) / <alpha-value>)',
          high: 'hsl(var(--severity-high) / <alpha-value>)',
          medium: 'hsl(var(--severity-medium) / <alpha-value>)',
          low: 'hsl(var(--severity-low) / <alpha-value>)',
          info: 'hsl(var(--severity-info) / <alpha-value>)',
        },
        chart: {
          1: 'hsl(var(--chart-1) / <alpha-value>)',
          2: 'hsl(var(--chart-2) / <alpha-value>)',
          3: 'hsl(var(--chart-3) / <alpha-value>)',
          4: 'hsl(var(--chart-4) / <alpha-value>)',
          5: 'hsl(var(--chart-5) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
          primary: 'hsl(var(--sidebar-primary) / <alpha-value>)',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground) / <alpha-value>)',
          accent: 'hsl(var(--sidebar-accent) / <alpha-value>)',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground) / <alpha-value>)',
          border: 'hsl(var(--sidebar-border) / <alpha-value>)',
          ring: 'hsl(var(--sidebar-ring) / <alpha-value>)',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 3px)',
        sm: 'calc(var(--radius) - 5px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.35' }],
        sm: ['0.8125rem', { lineHeight: '1.45' }],
        base: ['0.875rem', { lineHeight: '1.55' }],
        lg: ['1rem', { lineHeight: '1.5' }],
        xl: ['1.125rem', { lineHeight: '1.4' }],
        '2xl': ['1.375rem', { lineHeight: '1.35' }],
        '3xl': ['1.75rem', { lineHeight: '1.25' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--radix-collapsible-content-height)' },
          to: { height: '0' },
        },
        /*
         * The halo behind the sidebar avatar.
         *
         * Written out rather than reusing Tailwind's built-in `spin` through an
         * arbitrary `animate-[spin_6s_linear_infinite]`: v3 only emits the
         * keyframes for animations it can see in `theme.animation`, so an
         * arbitrary value referencing `spin` compiles to an `animation`
         * declaration pointing at keyframes that may not be in the stylesheet.
         * It happens to work today because `animate-spin` is used elsewhere —
         * that is a dependency on an unrelated file, not a guarantee.
         */
        'avatar-ring-spin': {
          to: { transform: 'rotate(360deg)' },
        },
        /*
         * The breathing that rides on top of the rotation.
         *
         * Opacity only, and nothing else may touch opacity on that element: a
         * running animation outranks an ordinary declaration, so a
         * `hover:opacity-*` there would simply never apply. Hover intensifies
         * the ring through `filter` instead, which this leaves alone.
         */
        'avatar-ring-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.75' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-out',
        'collapsible-up': 'collapsible-up 0.2s ease-out',
        /*
         * Two animations on one element: the turn and the breath.
         *
         * Six seconds for the rotation, not the three of the pattern this came
         * from, and the pulse deliberately runs on a different period so the
         * two never lock into a single obvious beat. The ring sits in permanent
         * view in the sidebar footer rather than on a profile card, and
         * anything faster is motion in the corner of the eye of somebody
         * reading a findings table. `prefers-reduced-motion` stops both
         * outright, via the global rule in `globals.css`.
         */
        'avatar-ring': 'avatar-ring-spin 6s linear infinite, avatar-ring-pulse 3.2s ease-in-out infinite',
      },
      backgroundImage: {
        /* The core gradient, for the few affordances entitled to it. */
        'brand-core': 'var(--brand-gradient)',
        /*
         * The sidebar avatar's rotating ring.
         *
         * Conic rather than linear so the sweep follows the circle, and the
         * first and last stops are the same colour so a full turn has no seam
         * to catch the eye. The two colours are not fixed here: they come from
         * `--avatar-ring-a`/`-b`, which the account's chosen avatar colour sets
         * (see `AVATAR_COLORS` in `components/shared/user-avatar.tsx`), so the
         * ring is a brighter version of whatever the person picked for their
         * initials. The fallbacks are the brand blue, which is what an avatar
         * that has never chosen renders as anyway.
         */
        'avatar-ring':
          'conic-gradient(from 0deg, var(--avatar-ring-a, hsl(var(--primary))), var(--avatar-ring-b, hsl(var(--brand-cyan))), var(--avatar-ring-a, hsl(var(--primary))), var(--avatar-ring-b, hsl(var(--brand-cyan))), var(--avatar-ring-a, hsl(var(--primary))))',
      },
    },
  },
  plugins: [animate],
};

export default config;
