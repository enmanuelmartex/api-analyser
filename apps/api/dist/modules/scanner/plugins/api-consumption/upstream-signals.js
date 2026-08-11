"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identifyProvider = identifyProvider;
exports.extractExternalUrls = extractExternalUrls;
exports.detectUpstreamErrorLeak = detectUpstreamErrorLeak;
exports.webhookIntakeTerm = webhookIntakeTerm;
exports.declaredSignatureHeader = declaredSignatureHeader;
const tokenise_1 = require("../shared/tokenise");
function isInternalHost(host, targetHost) {
    const lower = host.toLowerCase();
    if (lower === targetHost.toLowerCase())
        return true;
    if (lower === 'localhost' || lower.endsWith('.localhost'))
        return true;
    if (lower === '::1' || lower === '[::1]')
        return true;
    if (/^127\./.test(lower))
        return true;
    if (/^10\./.test(lower))
        return true;
    if (/^192\.168\./.test(lower))
        return true;
    if (/^169\.254\./.test(lower))
        return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower))
        return true;
    return false;
}
const PROVIDERS = [
    { suffix: 'stripe.com', name: 'Stripe' },
    { suffix: 'paypal.com', name: 'PayPal' },
    { suffix: 'braintreegateway.com', name: 'Braintree' },
    { suffix: 'adyen.com', name: 'Adyen' },
    { suffix: 'twilio.com', name: 'Twilio' },
    { suffix: 'sendgrid.net', name: 'SendGrid' },
    { suffix: 'sendgrid.com', name: 'SendGrid' },
    { suffix: 'mailgun.net', name: 'Mailgun' },
    { suffix: 'mailgun.org', name: 'Mailgun' },
    { suffix: 'amazonaws.com', name: 'AWS' },
    { suffix: 'googleapis.com', name: 'Google Cloud' },
    { suffix: 'firebaseio.com', name: 'Firebase' },
    { suffix: 'azure.com', name: 'Azure' },
    { suffix: 'azurewebsites.net', name: 'Azure' },
    { suffix: 'cloudinary.com', name: 'Cloudinary' },
    { suffix: 'slack.com', name: 'Slack' },
    { suffix: 'github.com', name: 'GitHub' },
    { suffix: 'openai.com', name: 'OpenAI' },
    { suffix: 'anthropic.com', name: 'Anthropic' },
    { suffix: 'algolia.net', name: 'Algolia' },
    { suffix: 'auth0.com', name: 'Auth0' },
    { suffix: 'okta.com', name: 'Okta' },
    { suffix: 'shopify.com', name: 'Shopify' },
    { suffix: 'salesforce.com', name: 'Salesforce' },
    { suffix: 'hubapi.com', name: 'HubSpot' },
    { suffix: 'zendesk.com', name: 'Zendesk' },
    { suffix: 'segment.io', name: 'Segment' },
    { suffix: 'mixpanel.com', name: 'Mixpanel' },
    { suffix: 'elastic-cloud.com', name: 'Elastic Cloud' },
];
function identifyProvider(host) {
    const lower = host.toLowerCase();
    return PROVIDERS.find(({ suffix }) => lower === suffix || lower.endsWith(`.${suffix}`))?.name ?? null;
}
function extractExternalUrls(body, targetHost, limit = 10) {
    const found = new Map();
    for (const match of body.matchAll(/https?:\/\/[^\s"'`<>\\)\]}]+/gi)) {
        let parsed;
        try {
            parsed = new URL(match[0]);
        }
        catch {
            continue;
        }
        if (isInternalHost(parsed.hostname, targetHost))
            continue;
        const key = `${parsed.protocol}//${parsed.hostname}`;
        if (found.has(key))
            continue;
        found.set(key, {
            url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
            host: parsed.hostname,
            insecure: parsed.protocol === 'http:',
            provider: identifyProvider(parsed.hostname),
        });
        if (found.size >= limit)
            break;
    }
    return [...found.values()];
}
const ERROR_TOKENS = [
    'econnrefused', 'econnreset', 'etimedout', 'enotfound', 'getaddrinfo',
    'socket hang up', 'fetch failed', 'axioserror', 'requesterror',
    'traceback', 'stack trace', 'at async', 'upstream', 'bad gateway',
    'gateway timeout', 'unhandled', 'exception',
];
function detectUpstreamErrorLeak(body, targetHost) {
    const lower = body.toLowerCase();
    const errorToken = ERROR_TOKENS.find((token) => lower.includes(token));
    if (!errorToken)
        return null;
    for (const reference of extractExternalUrls(body, targetHost, 5)) {
        return {
            provider: reference.provider ?? reference.host,
            host: reference.host,
            errorToken,
        };
    }
    for (const { suffix, name } of PROVIDERS) {
        const bareName = name.toLowerCase();
        if (lower.includes(suffix) || new RegExp(`\\b${bareName}\\b`).test(lower)) {
            return { provider: name, host: suffix, errorToken };
        }
    }
    return null;
}
const INTAKE_TERMS = ['webhook', 'callback', 'hook', 'ipn', 'postback'];
const SIGNATURE_HEADERS = [
    'x-hub-signature', 'x-hub-signature-256', 'stripe-signature', 'x-signature',
    'x-webhook-signature', 'x-hook-signature', 'signature', 'x-slack-signature',
    'x-shopify-hmac-sha256', 'x-twilio-signature', 'x-amz-sns-message-id',
    'x-github-delivery', 'paypal-transmission-sig', 'x-pagerduty-signature',
];
function webhookIntakeTerm(path, summary) {
    const fromPath = (0, tokenise_1.tokenise)(path).find((token) => INTAKE_TERMS.includes(token));
    if (fromPath)
        return fromPath;
    return (0, tokenise_1.tokenise)(summary ?? '').find((token) => INTAKE_TERMS.includes(token)) ?? null;
}
function declaredSignatureHeader(headerNames) {
    const lowered = headerNames.map((name) => name.toLowerCase());
    return (SIGNATURE_HEADERS.find((header) => lowered.includes(header)) ??
        lowered.find((name) => name.includes('signature') || name.includes('hmac')) ??
        null);
}
//# sourceMappingURL=upstream-signals.js.map