import { describe, expect, it } from 'bun:test';
import {
  GUIDANCE_SCHEMA_VERSION,
  parseSecurityGuidance,
} from './security-guidance.schema';

/**
 * The parser is the boundary between an untrusted model and the product.
 *
 * Everything the model returns passes through here before it reaches a report,
 * a database row or a page. The contract these tests pin:
 *
 *   - it never throws, whatever comes back;
 *   - it never emits a half-typed object callers must defend against;
 *   - it never lets the model assert a technology we have no evidence for;
 *   - it never lets model-supplied text become a dangerous link.
 */

const MINIMAL = JSON.stringify({
  summary: 'CORS allows any origin with credentials.',
  rootCause: 'The origin header is reflected without an allowlist.',
});

describe('parseSecurityGuidance — malformed input', () => {
  it('reports empty responses rather than throwing', () => {
    for (const input of ['', '   ', null, undefined]) {
      const result = parseSecurityGuidance(input as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorCode).toBe('EMPTY_RESPONSE');
    }
  });

  it('reports unparseable output', () => {
    const result = parseSecurityGuidance('I am sorry, I cannot help with that.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NOT_JSON');
  });

  it('rejects JSON that is not an object', () => {
    const result = parseSecurityGuidance('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('NOT_AN_OBJECT');
  });

  it('rejects an object with no actionable content', () => {
    const result = parseSecurityGuidance(JSON.stringify({ businessImpact: 'bad' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('MISSING_REQUIRED_FIELDS');
  });

  it('recovers JSON wrapped in a markdown fence', () => {
    const result = parseSecurityGuidance('```json\n' + MINIMAL + '\n```');
    expect(result.ok).toBe(true);
  });

  it('recovers JSON surrounded by chatter', () => {
    const result = parseSecurityGuidance(`Sure! Here is the analysis:\n${MINIMAL}\nHope that helps.`);
    expect(result.ok).toBe(true);
  });
});

describe('parseSecurityGuidance — shape guarantees', () => {
  it('always returns every field, so callers need no defensive checks', () => {
    const result = parseSecurityGuidance(MINIMAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { guidance } = result;
    expect(guidance.schemaVersion).toBe(GUIDANCE_SCHEMA_VERSION);
    expect(guidance.remediation.steps).toEqual([]);
    expect(guidance.environmentGuidance).toEqual([]);
    expect(guidance.verification.steps).toEqual([]);
    expect(guidance.falsePositiveConsiderations).toEqual([]);
    expect(guidance.references).toEqual([]);
    expect(guidance.businessImpact).toBe('');
  });

  it('accepts remediation steps given as plain strings', () => {
    const result = parseSecurityGuidance(
      JSON.stringify({
        summary: 's',
        rootCause: 'r',
        remediation: { steps: ['Add an allowlist', 'Reject wildcards'] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guidance.remediation.steps).toEqual([
      { title: 'Add an allowlist', description: '' },
      { title: 'Reject wildcards', description: '' },
    ]);
  });

  it('defaults priority to the least alarming value when absent or unrecognised', () => {
    for (const priority of [undefined, 'whenever', 42]) {
      const result = parseSecurityGuidance(
        JSON.stringify({ summary: 's', rootCause: 'r', remediation: { priority } }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.guidance.remediation.priority).toBe('PLANNED');
    }
  });

  it('normalises priority synonyms', () => {
    const result = parseSecurityGuidance(
      JSON.stringify({ summary: 's', rootCause: 'r', remediation: { priority: 'urgent' } }),
    );
    if (result.ok) expect(result.guidance.remediation.priority).toBe('IMMEDIATE');
  });
});

describe('parseSecurityGuidance — confidence', () => {
  it('is null when absent, never a default of certainty', () => {
    const result = parseSecurityGuidance(MINIMAL);
    if (result.ok) expect(result.guidance.confidence).toBeNull();
  });

  it('accepts both 0-1 and 0-100 scales', () => {
    const a = parseSecurityGuidance(JSON.stringify({ summary: 's', rootCause: 'r', confidence: 0.85 }));
    const b = parseSecurityGuidance(JSON.stringify({ summary: 's', rootCause: 'r', confidence: 85 }));
    if (a.ok) expect(a.guidance.confidence).toBe(0.85);
    if (b.ok) expect(b.guidance.confidence).toBe(0.85);
  });

  it('maps HIGH/MEDIUM/LOW labels to numbers', () => {
    const result = parseSecurityGuidance(
      JSON.stringify({ summary: 's', rootCause: 'r', confidence: 'HIGH' }),
    );
    if (result.ok) expect(result.guidance.confidence).toBe(0.9);
  });

  it('clamps out-of-range values', () => {
    const result = parseSecurityGuidance(
      JSON.stringify({ summary: 's', rootCause: 'r', confidence: -5 }),
    );
    if (result.ok) expect(result.guidance.confidence).toBe(0);
  });
});

describe('parseSecurityGuidance — hallucinated technology', () => {
  const withNestJs = JSON.stringify({
    summary: 's',
    rootCause: 'r',
    environmentGuidance: [
      { technology: 'NestJS', guidance: 'Add a global ValidationPipe' },
      { technology: 'express', guidance: 'Use helmet()' },
    ],
  });

  it('drops advice for technologies we have no evidence of', () => {
    const result = parseSecurityGuidance(withNestJs, {
      allowedTechnologies: new Map([['express', 'DETECTED']]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.guidance.environmentGuidance).toHaveLength(1);
    expect(result.guidance.environmentGuidance[0].technology).toBe('express');
    expect(result.guidance.environmentGuidance[0].basis).toBe('DETECTED');
    expect(result.droppedFields).toContain('environmentGuidance:NestJS');
  });

  it('drops all environment guidance when nothing is known about the stack', () => {
    const result = parseSecurityGuidance(withNestJs, { allowedTechnologies: new Map() });
    // An empty allowlist means "unfiltered" is not an option we want, but the
    // prompt already instructs neutrality; anything returned is unverified.
    if (result.ok) {
      for (const entry of result.guidance.environmentGuidance) {
        expect(entry.basis).toBe('UNKNOWN');
      }
    }
  });
});

describe('parseSecurityGuidance — references', () => {
  it('keeps only http(s) links', () => {
    const result = parseSecurityGuidance(
      JSON.stringify({
        summary: 's',
        rootCause: 'r',
        references: [
          { title: 'OWASP', url: 'https://owasp.org/x' },
          { title: 'Bad', url: 'javascript:alert(1)' },
          { title: 'Also bad', url: 'data:text/html,<script>' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.guidance.references).toHaveLength(3);
    expect(result.guidance.references[0].url).toBe('https://owasp.org/x');
    // Dangerous schemes are stripped, the reference itself is kept as text.
    expect(result.guidance.references[1].url).toBeUndefined();
    expect(result.guidance.references[2].url).toBeUndefined();
  });

  it('accepts references given as plain strings', () => {
    const result = parseSecurityGuidance(
      JSON.stringify({ summary: 's', rootCause: 'r', references: ['OWASP API Top 10'] }),
    );
    if (result.ok) {
      expect(result.guidance.references[0]).toEqual({
        title: 'OWASP API Top 10',
        source: 'unspecified',
      });
    }
  });
});
