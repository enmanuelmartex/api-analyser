"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GUIDANCE_SCHEMA_VERSION = void 0;
exports.parseSecurityGuidance = parseSecurityGuidance;
exports.GUIDANCE_SCHEMA_VERSION = 'guidance-v1';
const REQUIRED = ['summary', 'rootCause'];
const MAX_TEXT = 4000;
const MAX_ITEMS = 20;
function parseSecurityGuidance(raw, options = {}) {
    if (!raw || !raw.trim()) {
        return { ok: false, errorCode: 'EMPTY_RESPONSE', message: 'The provider returned nothing.' };
    }
    const parsed = extractJson(raw);
    if (parsed === undefined) {
        return {
            ok: false,
            errorCode: 'NOT_JSON',
            message: 'The provider response could not be read as JSON.',
        };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            ok: false,
            errorCode: 'NOT_AN_OBJECT',
            message: 'The provider returned JSON that is not a guidance object.',
        };
    }
    const source = parsed;
    const missing = REQUIRED.filter((key) => !isNonEmptyString(source[key]));
    if (missing.length > 0) {
        return {
            ok: false,
            errorCode: 'MISSING_REQUIRED_FIELDS',
            message: `The provider response is missing: ${missing.join(', ')}.`,
        };
    }
    const dropped = [];
    const guidance = {
        schemaVersion: exports.GUIDANCE_SCHEMA_VERSION,
        summary: text(source.summary),
        rootCause: text(source.rootCause),
        businessImpact: text(source.businessImpact) ?? '',
        technicalImpact: text(source.technicalImpact) ?? '',
        remediation: {
            priority: priority(readPath(source, 'remediation.priority')),
            steps: remediationSteps(readPath(source, 'remediation.steps'), dropped),
        },
        environmentGuidance: environmentGuidance(source.environmentGuidance, options.allowedTechnologies, dropped),
        verification: {
            steps: stringArray(readPath(source, 'verification.steps')),
            expectedResult: text(readPath(source, 'verification.expectedResult')) ?? '',
        },
        falsePositiveConsiderations: stringArray(source.falsePositiveConsiderations),
        references: references(source.references, dropped),
        confidence: confidence(source.confidence),
    };
    return { ok: true, guidance, droppedFields: dropped };
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function text(value) {
    return isNonEmptyString(value) ? value.trim().slice(0, MAX_TEXT) : null;
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter(isNonEmptyString).map((v) => v.trim().slice(0, MAX_TEXT)).slice(0, MAX_ITEMS);
}
function priority(value) {
    const normalised = String(value ?? '').toUpperCase().replace(/[\s-]/g, '_');
    if (normalised === 'IMMEDIATE' || normalised === 'CRITICAL' || normalised === 'URGENT') {
        return 'IMMEDIATE';
    }
    if (normalised === 'SHORT_TERM' || normalised === 'HIGH' || normalised === 'SOON') {
        return 'SHORT_TERM';
    }
    return 'PLANNED';
}
function remediationSteps(value, dropped) {
    if (!Array.isArray(value)) {
        if (value !== undefined)
            dropped.push('remediation.steps');
        return [];
    }
    const steps = [];
    for (const entry of value.slice(0, MAX_ITEMS)) {
        if (typeof entry === 'string') {
            if (isNonEmptyString(entry))
                steps.push({ title: entry.trim().slice(0, 200), description: '' });
            continue;
        }
        if (entry && typeof entry === 'object') {
            const record = entry;
            const title = text(record.title) ?? text(record.step);
            if (!title)
                continue;
            steps.push({ title: title.slice(0, 200), description: text(record.description) ?? '' });
        }
    }
    return steps;
}
function environmentGuidance(value, allowed, dropped) {
    if (!Array.isArray(value)) {
        if (value !== undefined)
            dropped.push('environmentGuidance');
        return [];
    }
    const result = [];
    for (const entry of value.slice(0, MAX_ITEMS)) {
        if (!entry || typeof entry !== 'object')
            continue;
        const record = entry;
        const technology = text(record.technology);
        const guidanceText = text(record.guidance);
        if (!technology || !guidanceText)
            continue;
        if (allowed && allowed.size > 0) {
            const basis = allowed.get(technology.toLowerCase());
            if (!basis) {
                dropped.push(`environmentGuidance:${technology}`);
                continue;
            }
            result.push({
                technology,
                basis,
                guidance: guidanceText,
                ...(text(record.example) ? { example: text(record.example) } : {}),
            });
            continue;
        }
        result.push({
            technology,
            basis: 'UNKNOWN',
            guidance: guidanceText,
            ...(text(record.example) ? { example: text(record.example) } : {}),
        });
    }
    return result;
}
function references(value, dropped) {
    if (!Array.isArray(value)) {
        if (value !== undefined)
            dropped.push('references');
        return [];
    }
    const result = [];
    for (const entry of value.slice(0, MAX_ITEMS)) {
        if (typeof entry === 'string' && isNonEmptyString(entry)) {
            result.push({ title: entry.trim().slice(0, 200), source: 'unspecified' });
            continue;
        }
        if (!entry || typeof entry !== 'object')
            continue;
        const record = entry;
        const title = text(record.title);
        if (!title)
            continue;
        const url = text(record.url);
        result.push({
            title: title.slice(0, 200),
            source: text(record.source) ?? 'unspecified',
            ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
        });
    }
    return result;
}
function confidence(value) {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value.replace('%', ''))
            : NaN;
    if (!Number.isFinite(numeric)) {
        const label = String(value ?? '').toUpperCase();
        if (label === 'HIGH')
            return 0.9;
        if (label === 'MEDIUM')
            return 0.6;
        if (label === 'LOW')
            return 0.3;
        return null;
    }
    const scaled = numeric > 1 ? numeric / 100 : numeric;
    return Math.max(0, Math.min(1, Number(scaled.toFixed(2))));
}
function readPath(source, path) {
    return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), source);
}
function extractJson(raw) {
    const attempts = [
        raw,
        raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)?.[1],
        raw.match(/\{[\s\S]*\}/)?.[0],
    ];
    for (const candidate of attempts) {
        if (!candidate)
            continue;
        try {
            return JSON.parse(candidate);
        }
        catch {
        }
    }
    return undefined;
}
//# sourceMappingURL=security-guidance.schema.js.map