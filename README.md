# API Analyser — landing page

The marketing site for [API Analyser](https://github.com/enmanuelmartex/api-analyser). One page:
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
NEXT_PUBLIC_SITE_URL=https://enmanuelmartex.github.io/api-analyser bun run build:static
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
  brand-logo.tsx      the official mark, one file, every size
  code-block.tsx      copyable commands
lib/
  site.ts             every claim the page makes, in one file
public/
  api-analyser-example-report.pdf   a real report, linked from the Report step
```

### The example report

`public/api-analyser-example-report.pdf` is a genuine PDF produced by the app, linked from
stage 05 of "How it works" — the one thing a visitor can have without installing anything. To
refresh it, generate a report from a real assessment and overwrite the file, keeping the name;
if the weight changes noticeably, update `exampleReport.size` in `lib/site.ts` so the label
does not lie about the download.

## Editing the content

**`lib/site.ts` is the only file with product facts in it.** The counts (13 checks, 49 rules,
10/10 categories), the OWASP table, the install commands and the environment variables are all
transcribed from the product's `README.md` at the root of `main`. They are a copy, so they can
drift — when the README changes, `lib/site.ts` is the file to re-check.

The three OWASP categories carrying a `scopeNote` are deliberate. The product marks those with
a dagger in its own README, its coverage API, its UI and every report it generates, because a
black-box scan sees less than those categories describe. Do not drop them to tidy the table.

## Brand assets

`public/brand/mark-for-dark-bg.svg` is a byte-identical copy of `branding/05-svg/` on `main` —
the "Primaria — fondo oscuro / Color completo" artwork from the brand sheet — and the icons in
`app/` are the same files the product ships. Do not edit them here; re-copy them if the brand
system is revised.

One file, because this page has one surface and one logo. `components/brand-logo.tsx` draws it
at every size, which is a **deliberate deviation** from `branding/README.md`: the brand says to
substitute the compact artwork below 64 px, and this page renders the full mark at 34 px. That
was the product owner's call, so the navbar shows the same object as the brand sheet rather
than a simplified cousin of it. The measured lockup proportions are still honoured.

The light and monochrome variants, the lockups, the app icons and the full brand sheet live in
`branding/` on `main` — copy what you need from there rather than recolouring this one.

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
