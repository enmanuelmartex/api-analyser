import { Navbar } from '@/components/navbar';
import { Hero } from '@/components/hero';
import { HowItWorks } from '@/components/how-it-works';
import { FeatureCards } from '@/components/feature-cards';
import { Coverage } from '@/components/coverage';
import { Install } from '@/components/install';
import { Stack } from '@/components/stack';
import { CallToAction } from '@/components/cta';
import { Footer } from '@/components/footer';
import { brand, repo, stats } from '@/lib/site';

/**
 * One page, in the order someone evaluating the project reads it:
 *
 *   what it is  →  how it works  →  what you get  →  what it covers
 *               →  how to run it →  what it is built from →  clone it
 *
 * The install section is deliberately two thirds of the way down rather than
 * last: by then a visitor has decided, and the thing they decided to do should
 * be in front of them before the footer.
 */
export default function HomePage() {
  return (
    <>
      <SoftwareSchema />
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <FeatureCards />
        <Coverage />
        <Install />
        <Stack />
        <CallToAction />
      </main>
      <Footer />
    </>
  );
}

/**
 * Structured data for the one thing this page is about.
 *
 * `SoftwareApplication` is what search engines and AI answer engines read to
 * decide that this is a free, self-hosted security tool rather than a SaaS trial
 * page — which is the single most common thing to get wrong about it.
 */
function SoftwareSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: brand.name,
    alternateName: brand.legacyName,
    applicationCategory: 'SecurityApplication',
    applicationSubCategory: 'API security testing',
    operatingSystem: 'Linux, macOS, Windows',
    description: brand.description,
    url: repo.url,
    codeRepository: repo.url,
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      'OpenAPI and Swagger specification parsing',
      `${stats[0].value} security checks across all 10 OWASP API Security Top 10 categories`,
      'AI-assisted finding analysis (OpenAI, Claude, Gemini, Grok, Ollama)',
      'PDF, HTML, JSON, SARIF and Markdown reports',
      'GitHub Actions security gate with SARIF upload',
    ],
  };

  return (
    <script
      type="application/ld+json"
      // The object is a literal defined above — there is no user input in it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
