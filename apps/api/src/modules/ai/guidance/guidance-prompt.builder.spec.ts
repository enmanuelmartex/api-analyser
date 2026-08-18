import { describe, expect, it } from 'bun:test';
import { buildGuidanceSystemPrompt, buildGuidanceUserPrompt, GUIDANCE_PROMPT_VERSION } from './guidance-prompt.builder';
import type { GuidanceContext } from './guidance-context.resolver';

/**
 * Section 9 of the audit: the AI Security Guidance shown for login findings
 * recommended requiring authentication before login (which would make login
 * unusable) and idempotency keys as a defense against credential stuffing
 * (which idempotency keys do not do — they prevent a duplicate side effect,
 * not an unauthorized one). These tests pin the guardrails added to the
 * system prompt to stop the model proposing either.
 */

const unknownContext: GuidanceContext = { technologies: [], allowed: new Map(), isUnknown: true };

describe('buildGuidanceSystemPrompt — authentication guardrails', () => {
  const prompt = buildGuidanceSystemPrompt();

  it('forbids requiring authentication on a public-by-design operation', () => {
    expect(prompt).toMatch(/never recommend requiring the caller to already\s+be authenticated/i);
    expect(prompt).toMatch(/public by design/i);
  });

  it('names login, registration and password-reset explicitly as public-by-design', () => {
    expect(prompt).toMatch(/login, sign-in, token-exchange, password-reset-request or registration/i);
  });

  it('directs the model toward rate limiting, monitoring, step-up and anti-enumeration instead', () => {
    expect(prompt).toMatch(/rate limiting/i);
    expect(prompt).toMatch(/monitoring and alerting/i);
    expect(prompt).toMatch(/step-up challenge/i);
    expect(prompt).toMatch(/user enumeration/i);
    expect(prompt).toMatch(/multi-factor or step-up authentication/i);
  });

  it('forbids idempotency keys as an anti-automation or authentication control', () => {
    expect(prompt).toMatch(/never recommend an idempotency key as a defense against brute force, credential stuffing/i);
  });

  it('explains what idempotency keys are actually for, so the model has the correct alternative', () => {
    expect(prompt).toMatch(/idempotency keys prevent a retried request from being applied twice/i);
  });

  it('bumped the prompt version, since the wording changed', () => {
    expect(GUIDANCE_PROMPT_VERSION).toBe('guidance-prompt-v4');
  });
});

describe('buildGuidanceUserPrompt', () => {
  it('still produces the expected JSON contract regardless of the new system-prompt rules', () => {
    const prompt = buildGuidanceUserPrompt({
      title: 'Sensitive authentication flow has no anti-automation control',
      severity: 'HIGH',
      owaspCategory: 'API6:2023',
      ruleId: 'business-flow.no-anti-automation',
      method: 'POST',
      route: '/auth/login',
      component: 'endpoint',
      description: 'No rate limiting observed on the login endpoint.',
      context: unknownContext,
      playbooks: [],
    });

    expect(prompt).toContain('SCANNER FINDING (authoritative)');
    expect(prompt).toContain('POST /auth/login');
    expect(prompt).toContain('RETURN EXACTLY THIS JSON SHAPE');
    expect(prompt).toContain('"remediation"');
  });
});
