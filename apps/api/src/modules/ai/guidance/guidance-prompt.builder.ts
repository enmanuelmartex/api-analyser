import type { GuidanceContext } from './guidance-context.resolver';
import type { SecurityPlaybook } from './security-knowledge.registry';

/**
 * Builds the guidance prompt, versioned.
 *
 * `GUIDANCE_PROMPT_VERSION` is stamped onto every stored result. Without it,
 * two pieces of guidance written months apart are indistinguishable, and a
 * regression caused by a prompt change cannot be traced to the change.
 *
 * Bump the version whenever the wording or the requested shape changes.
 */
export const GUIDANCE_PROMPT_VERSION = 'guidance-prompt-v4';

export interface GuidancePromptInput {
  title: string;
  severity: string;
  owaspCategory: string;
  ruleId: string;
  method: string;
  route: string;
  component: string;
  description: string;
  /** Redacted scanner evidence. */
  httpRequest?: string | null;
  httpResponse?: string | null;
  context: GuidanceContext;
  playbooks: SecurityPlaybook[];
}

const SYSTEM_PROMPT = [
  'You are a senior API security engineer writing remediation guidance for a developer.',
  '',
  'Rules you must follow:',
  '1. Return ONLY a single JSON object. No markdown, no prose outside the JSON.',
  '2. The scanner evidence is authoritative. Never contradict it, never restate it as',
  '   uncertain, and never invent evidence, requests, responses or credentials.',
  '3. Never claim the issue is fixed, exploited, or compliant with any standard.',
  '4. Only give technology-specific advice for technologies listed as KNOWN CONTEXT.',
  '   If none are listed, give technology-neutral advice and leave environmentGuidance empty.',
  '5. Ground your answer in the REFERENCE MATERIAL provided. Do not cite sources that',
  '   are not listed there.',
  '6. If the finding could plausibly be a false positive, say so honestly in',
  '   falsePositiveConsiderations. An honest caveat is more useful than false confidence.',
  '7. A login, sign-in, token-exchange, password-reset-request or registration operation is',
  '   PUBLIC BY DESIGN — that is what it is for. Never recommend requiring the caller to already',
  '   be authenticated, hold a session, or be otherwise "logged in" before using it; that would',
  '   make the operation impossible to use for its own purpose. If the finding is about weak',
  '   protection on such an operation, the primary remediation is anti-automation and anti-abuse',
  '   controls specific to that operation, prioritized in this order: rate limiting / throttling',
  '   scoped to both the caller\'s IP and the account being targeted, monitoring and alerting on',
  '   abnormal attempt volume, a step-up challenge (CAPTCHA, delay, MFA) triggered by suspicious',
  '   behavior rather than every request, protection against user enumeration (a uniform response',
  '   regardless of whether the account exists), and multi-factor or step-up authentication for the',
  '   account itself. Do not propose an authentication requirement on the operation as a fix.',
  '8. Idempotency keys prevent a retried request from being applied twice — they solve duplicate',
  '   side effects (a payment charged twice, an order placed twice), not unauthorized access.',
  '   Never recommend an idempotency key as a defense against brute force, credential stuffing,',
  '   scraping, or any other volumetric abuse; that is what rule 7\'s controls are for. An',
  '   idempotency key is only ever appropriate remediation for a finding about a repeatable',
  '   side-effecting action producing duplicate results, never for a missing anti-automation or',
  '   authentication control.',
].join('\n');

export function buildGuidanceSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildGuidanceUserPrompt(input: GuidancePromptInput): string {
  const sections: string[] = [];

  sections.push(
    [
      'SCANNER FINDING (authoritative)',
      `Title: ${input.title}`,
      `Severity: ${input.severity}`,
      `OWASP: ${input.owaspCategory}`,
      `Rule: ${input.ruleId}`,
      `Endpoint: ${input.method} ${input.route}`,
      `Affected component: ${input.component}`,
      `Description: ${truncate(input.description, 1200)}`,
    ].join('\n'),
  );

  if (input.httpRequest || input.httpResponse) {
    sections.push(
      [
        'OBSERVED EVIDENCE (already redacted — do not attempt to reconstruct secrets)',
        input.httpRequest ? `Request:\n${truncate(input.httpRequest, 900)}` : '',
        input.httpResponse ? `Response:\n${truncate(input.httpResponse, 900)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  /*
   * Context is stated positively when known and negatively when not. Saying
   * nothing invites the model to assume a stack; saying "unknown" explicitly
   * and instructing neutrality is what actually suppresses invented framework
   * advice.
   */
  if (input.context.isUnknown) {
    sections.push(
      [
        'KNOWN CONTEXT',
        'None. The technology stack behind this API could not be determined.',
        'Give technology-neutral remediation only. Return an empty environmentGuidance array.',
        'Do NOT guess a framework, language or cloud provider.',
      ].join('\n'),
    );
  } else {
    sections.push(
      [
        'KNOWN CONTEXT',
        'Only these technologies may appear in environmentGuidance.technology:',
        ...input.context.technologies.map(
          (t) => `- ${t.name} (${t.label}) — basis: ${t.confidence}; evidence: ${t.evidence}`,
        ),
      ].join('\n'),
    );
  }

  if (input.playbooks.length > 0) {
    sections.push(
      [
        'REFERENCE MATERIAL (ground your answer in this)',
        ...input.playbooks.map((playbook) =>
          [
            `## ${playbook.title} [${playbook.id}]`,
            playbook.content,
            `Sources: ${playbook.references.map((r) => `${r.title} — ${r.url}`).join(' | ')}`,
          ].join('\n'),
        ),
      ].join('\n\n'),
    );
  }

  sections.push(
    [
      'RETURN EXACTLY THIS JSON SHAPE',
      '{',
      '  "summary": "2-3 sentences: what was found and why it matters for THIS endpoint",',
      '  "rootCause": "the most likely underlying cause, stated as a likelihood not a fact",',
      '  "businessImpact": "consequence in business terms",',
      '  "technicalImpact": "what an attacker gains technically",',
      '  "remediation": {',
      '    "priority": "IMMEDIATE | SHORT_TERM | PLANNED",',
      '    "steps": [{ "title": "short imperative", "description": "how to do it" }]',
      '  },',
      '  "environmentGuidance": [{ "technology": "<from KNOWN CONTEXT only>", "guidance": "...", "example": "optional code" }],',
      '  "verification": { "steps": ["non-destructive checks"], "expectedResult": "what proves it is fixed" },',
      '  "falsePositiveConsiderations": ["when this finding might not be a real problem"],',
      '  "references": [{ "title": "...", "source": "...", "url": "..." }],',
      '  "confidence": 0.0',
      '}',
    ].join('\n'),
  );

  return sections.join('\n\n---\n\n');
}

function truncate(value: string, max: number): string {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated]`;
}
