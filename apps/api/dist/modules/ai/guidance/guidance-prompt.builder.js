"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GUIDANCE_PROMPT_VERSION = void 0;
exports.buildGuidanceSystemPrompt = buildGuidanceSystemPrompt;
exports.buildGuidanceUserPrompt = buildGuidanceUserPrompt;
exports.GUIDANCE_PROMPT_VERSION = 'guidance-prompt-v3';
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
].join('\n');
function buildGuidanceSystemPrompt() {
    return SYSTEM_PROMPT;
}
function buildGuidanceUserPrompt(input) {
    const sections = [];
    sections.push([
        'SCANNER FINDING (authoritative)',
        `Title: ${input.title}`,
        `Severity: ${input.severity}`,
        `OWASP: ${input.owaspCategory}`,
        `Rule: ${input.ruleId}`,
        `Endpoint: ${input.method} ${input.route}`,
        `Affected component: ${input.component}`,
        `Description: ${truncate(input.description, 1200)}`,
    ].join('\n'));
    if (input.httpRequest || input.httpResponse) {
        sections.push([
            'OBSERVED EVIDENCE (already redacted — do not attempt to reconstruct secrets)',
            input.httpRequest ? `Request:\n${truncate(input.httpRequest, 900)}` : '',
            input.httpResponse ? `Response:\n${truncate(input.httpResponse, 900)}` : '',
        ]
            .filter(Boolean)
            .join('\n\n'));
    }
    if (input.context.isUnknown) {
        sections.push([
            'KNOWN CONTEXT',
            'None. The technology stack behind this API could not be determined.',
            'Give technology-neutral remediation only. Return an empty environmentGuidance array.',
            'Do NOT guess a framework, language or cloud provider.',
        ].join('\n'));
    }
    else {
        sections.push([
            'KNOWN CONTEXT',
            'Only these technologies may appear in environmentGuidance.technology:',
            ...input.context.technologies.map((t) => `- ${t.name} (${t.label}) — basis: ${t.confidence}; evidence: ${t.evidence}`),
        ].join('\n'));
    }
    if (input.playbooks.length > 0) {
        sections.push([
            'REFERENCE MATERIAL (ground your answer in this)',
            ...input.playbooks.map((playbook) => [
                `## ${playbook.title} [${playbook.id}]`,
                playbook.content,
                `Sources: ${playbook.references.map((r) => `${r.title} — ${r.url}`).join(' | ')}`,
            ].join('\n')),
        ].join('\n\n'));
    }
    sections.push([
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
    ].join('\n'));
    return sections.join('\n\n---\n\n');
}
function truncate(value, max) {
    if (!value)
        return '';
    return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated]`;
}
//# sourceMappingURL=guidance-prompt.builder.js.map