import { Injectable } from '@nestjs/common';
import type { ContextConfidence } from './security-guidance.schema';

/**
 * What we actually know about the API under test.
 *
 * The rule this enforces: the product must never tell a developer "In NestJS,
 * add a global ValidationPipe" unless there is a reason to believe the API is
 * NestJS. Confidently wrong, framework-specific advice is worse than generic
 * advice, because it is actionable — a developer may go looking for a file that
 * does not exist, or worse, apply a control in the wrong place and believe the
 * issue is fixed.
 *
 * Every signal is therefore labelled with how it was obtained:
 *
 *   USER_CONFIGURED  the user told us (project metadata)
 *   DETECTED         read from response evidence the scanner collected
 *   INFERRED         deduced from a weaker signal, e.g. a cookie name
 *   UNKNOWN          not established — remediation stays technology-neutral
 *
 * Only technologies present here are allowed through the guidance parser's
 * `allowedTechnologies` filter, so the model cannot introduce its own.
 */

export interface DetectedTechnology {
  /** Canonical lowercase name, matched against knowledge playbook keys. */
  name: string;
  label: string;
  confidence: ContextConfidence;
  /** The specific observation behind this conclusion, shown in the UI. */
  evidence: string;
}

export interface GuidanceContext {
  technologies: DetectedTechnology[];
  /** Lookup used to filter model-supplied environment guidance. */
  allowed: Map<string, ContextConfidence>;
  /** True when nothing could be established — prompt asks for neutral advice. */
  isUnknown: boolean;
}

/**
 * Header signatures, most specific first.
 *
 * Deliberately conservative. `Server: nginx` proves a reverse proxy is nginx;
 * it says nothing about the application framework behind it, so nginx is
 * recorded as infrastructure rather than treated as the API's stack.
 */
const HEADER_SIGNATURES: {
  header: string;
  pattern: RegExp;
  name: string;
  label: string;
  confidence: ContextConfidence;
}[] = [
  { header: 'x-powered-by', pattern: /express/i, name: 'express', label: 'Express', confidence: 'DETECTED' },
  { header: 'x-powered-by', pattern: /asp\.net/i, name: 'asp.net', label: 'ASP.NET Core', confidence: 'DETECTED' },
  { header: 'x-powered-by', pattern: /next\.js/i, name: 'express', label: 'Next.js (Node)', confidence: 'DETECTED' },
  { header: 'x-powered-by', pattern: /php/i, name: 'php', label: 'PHP', confidence: 'DETECTED' },
  { header: 'server', pattern: /gunicorn|uvicorn/i, name: 'fastapi', label: 'Python ASGI/WSGI', confidence: 'INFERRED' },
  { header: 'server', pattern: /kestrel/i, name: 'asp.net', label: 'ASP.NET Core (Kestrel)', confidence: 'DETECTED' },
  { header: 'server', pattern: /nginx/i, name: 'nginx', label: 'nginx', confidence: 'DETECTED' },
  { header: 'server', pattern: /apache/i, name: 'apache', label: 'Apache', confidence: 'DETECTED' },
  { header: 'server', pattern: /cloudflare/i, name: 'cloudflare', label: 'Cloudflare', confidence: 'DETECTED' },
  { header: 'server', pattern: /awselb|amazon/i, name: 'aws', label: 'AWS', confidence: 'DETECTED' },
  { header: 'x-amzn-requestid', pattern: /./, name: 'aws', label: 'AWS API Gateway', confidence: 'DETECTED' },
  { header: 'x-amz-apigw-id', pattern: /./, name: 'aws', label: 'AWS API Gateway', confidence: 'DETECTED' },
  { header: 'x-azure-ref', pattern: /./, name: 'azure', label: 'Azure', confidence: 'DETECTED' },
  { header: 'x-ms-request-id', pattern: /./, name: 'azure', label: 'Azure', confidence: 'DETECTED' },
  { header: 'x-goog-trace', pattern: /./, name: 'gcp', label: 'Google Cloud', confidence: 'DETECTED' },
  { header: 'x-cloud-trace-context', pattern: /./, name: 'gcp', label: 'Google Cloud', confidence: 'DETECTED' },
  { header: 'x-django-version', pattern: /./, name: 'django', label: 'Django', confidence: 'DETECTED' },
];

/** Cookie names that identify a stack. Weaker than a header — always INFERRED. */
const COOKIE_SIGNATURES: { pattern: RegExp; name: string; label: string }[] = [
  { pattern: /\bconnect\.sid\b/i, name: 'express', label: 'Express (session cookie)' },
  { pattern: /\bsessionid\b/i, name: 'django', label: 'Django (session cookie)' },
  { pattern: /\bcsrftoken\b/i, name: 'django', label: 'Django (CSRF cookie)' },
  { pattern: /\bJSESSIONID\b/i, name: 'spring', label: 'Java servlet container' },
  { pattern: /\b\.AspNetCore\./i, name: 'asp.net', label: 'ASP.NET Core' },
  { pattern: /\blaravel_session\b/i, name: 'php', label: 'Laravel' },
];

@Injectable()
export class GuidanceContextResolver {
  /**
   * Builds the context for one finding.
   *
   * `httpResponse` is the scanner's own redacted evidence string, so no secret
   * reaches this code path even though headers are being read.
   */
  resolve(input: {
    httpResponse?: string | null;
    /** Auth type configured on the project, e.g. BEARER. */
    authType?: string | null;
    /** Free-text stack description supplied by the user, if any. */
    declaredStack?: string | null;
  }): GuidanceContext {
    const found = new Map<string, DetectedTechnology>();

    const add = (technology: DetectedTechnology) => {
      const existing = found.get(technology.name);
      // A stronger basis wins: user-configured beats detected beats inferred.
      if (!existing || rank(technology.confidence) > rank(existing.confidence)) {
        found.set(technology.name, technology);
      }
    };

    if (input.declaredStack) {
      for (const token of tokenise(input.declaredStack)) {
        add({
          name: token,
          label: token,
          confidence: 'USER_CONFIGURED',
          evidence: 'Declared in the project configuration',
        });
      }
    }

    const headers = parseHeaders(input.httpResponse);

    for (const signature of HEADER_SIGNATURES) {
      const value = headers.get(signature.header);
      if (value && signature.pattern.test(value)) {
        add({
          name: signature.name,
          label: signature.label,
          confidence: signature.confidence,
          evidence: `Response header ${signature.header}: ${value.slice(0, 80)}`,
        });
      }
    }

    const cookies = headers.get('set-cookie');
    if (cookies) {
      for (const signature of COOKIE_SIGNATURES) {
        if (signature.pattern.test(cookies)) {
          add({
            name: signature.name,
            label: signature.label,
            confidence: 'INFERRED',
            evidence: 'Inferred from a session cookie name',
          });
        }
      }
    }

    // The auth mechanism is configured by the user, so it is known rather than
    // detected, and it selects the JWT/OAuth playbooks.
    if (input.authType && input.authType !== 'NONE') {
      const name = input.authType.toLowerCase() === 'bearer' ? 'jwt' : input.authType.toLowerCase();
      add({
        name,
        label: input.authType,
        confidence: 'USER_CONFIGURED',
        evidence: 'Authentication type configured for this project',
      });
    }

    const technologies = [...found.values()].sort(
      (a, b) => rank(b.confidence) - rank(a.confidence),
    );

    return {
      technologies,
      allowed: new Map(technologies.map((t) => [t.name.toLowerCase(), t.confidence])),
      isUnknown: technologies.length === 0,
    };
  }
}

function rank(confidence: ContextConfidence): number {
  switch (confidence) {
    case 'USER_CONFIGURED':
      return 3;
    case 'DETECTED':
      return 2;
    case 'INFERRED':
      return 1;
    default:
      return 0;
  }
}

function tokenise(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .slice(0, 8);
}

/**
 * Reads headers out of the scanner's serialised response evidence.
 *
 * The format is `HTTP/1.1 200\nheader: value\n...\n\nbody`, produced by
 * `BasePlugin.buildResponseString`. Parsing stops at the blank line so body
 * content can never be mistaken for a header.
 */
function parseHeaders(httpResponse?: string | null): Map<string, string> {
  const headers = new Map<string, string>();
  if (!httpResponse) return headers;

  const [head] = httpResponse.split(/\n\s*\n/, 1);
  for (const line of head.split('\n').slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!key || !value) continue;
    // Repeated headers (notably Set-Cookie) are joined rather than overwritten.
    headers.set(key, headers.has(key) ? `${headers.get(key)}; ${value}` : value);
  }
  return headers;
}
