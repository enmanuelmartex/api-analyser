# API Analyser — landing page

The marketing site for [API Analyser](https://github.com/enmanuelmartex/iasa). One page:
what the scanner does, what it covers, and how to clone and run it locally.

> **This branch contains only the landing page.** It is an orphan branch — it shares no
> history with `main` and none of the product's code. `main` holds the monorepo (the NestJS
> API, the Next.js app, Docker, migrations); this branch holds a self-contained Next.js site
> that can be deployed on its own without building or shipping any of that.

---

## Run it

```bash
bun i
bun dev
```

Then open <http://localhost:3000>.

If you are working on the product at the same time, the app also takes :3000 — start this one
elsewhere with `PORT=3001 bun dev`.

## Build it

```bash
bun run build          # a Next server build, for Vercel or a container
bun run build:static   # a folder of static files in out/, for any static host
```

The page has no server-side logic, no API calls and no runtime environment variables, so the
static export is the whole thing. `bun run build:static` is what to use for GitHub Pages,
Netlify, S3 or a plain nginx root.

### Deploying somewhere other than the brand domain

Metadata defaults to `https://apianalyser.com`. Set the real origin so the Open Graph image and
`sitemap.xml` point at the host that actually serves them:

```bash
NEXT_PUBLIC_SITE_URL=https://enmanuelmartex.github.io/iasa bun run build:static
```

On a GitHub Pages **project** site the page is served from a sub-path, which Next needs to be
told about as well (`basePath` in `next.config.mjs`). A user/organisation site, a custom domain
or Vercel serves from the root and needs nothing.

---

## Structure

```
app/
  layout.tsx          metadata, fonts, the single dark surface
  page.tsx            section order + SoftwareApplication structured data
  globals.css         brand palette as Tailwind v4 theme tokens
  icon.png            favicon / app icon / OG image, copied from the product
components/
  navbar.tsx          fixed chrome; transparent over the hero, blurred after
  hero.tsx            headline + the 3D stage the dashboard sits on
  dashboard-mockup.tsx the product's dashboard, redrawn in markup
  how-it-works.tsx    the five stages of an assessment
  feature-cards.tsx   evidence, AI triage, CI gate
  coverage.tsx        the OWASP table, scope notes included
  install.tsx         the quick start — the reason this page exists
  stack.tsx           tech stack, the CI workflow, a plugin
  cta.tsx             authorised-use notice + final call to action
  footer.tsx          links, licence, the IASA/API Analyser note
  brand-logo.tsx      the official mark, drawn to the brand's size rules
  code-block.tsx      copyable commands
lib/
  site.ts             every claim the page makes, in one file
```

## Editing the content

**`lib/site.ts` is the only file with product facts in it.** The counts (13 checks, 49 rules,
10/10 categories), the OWASP table, the install commands and the environment variables are all
transcribed from the product's `README.md` at the root of `main`. They are a copy, so they can
drift — when the README changes, `lib/site.ts` is the file to re-check.

The three OWASP categories carrying a `scopeNote` are deliberate. The product marks those with
a dagger in its own README, its coverage API, its UI and every report it generates, because a
black-box scan sees less than those categories describe. Do not drop them to tidy the table.

## Brand assets

`public/brand/*.svg` are byte-identical copies of `branding/05-svg/` on `main`, and the icons
in `app/` are the same files the product ships. Do not edit them here; re-copy them if the
brand system is revised. `components/brand-logo.tsx` carries the two rules that travel with the
artwork — the compact symbol below 64 px, and the measured lockup proportions.

Only the two dark-surface files are here, because this page has one surface. The light and
monochrome variants, the lockups, the app icons and the full brand sheet live in `branding/`
on `main` — copy what you need from there rather than recolouring these.

Palette, from `branding/README.md`:

| Name   | Hex       | Use                        |
|--------|-----------|----------------------------|
| Ink    | `#0A0A0B` | Text on light surfaces     |
| Canvas | `#08080A` | The dark surface — this page |
| Violet | `#6D4BFF` | Core gradient, start       |
| Indigo | `#5566FF` | Transition                 |
| Blue   | `#2E8BF5` | Primary accent, links      |
| Cyan   | `#1FC2E8` | Nodes, CTA                 |
| Ice    | `#9BE4F7` | Highlight / hover          |

The gradient belongs to the mark's core and to decorative rules. It never goes on the wordmark.

---

MIT licensed, same as the product.
