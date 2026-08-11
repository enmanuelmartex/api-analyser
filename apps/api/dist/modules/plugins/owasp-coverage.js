"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWASP_API_TOP_10_2023 = void 0;
exports.computeOwaspCoverage = computeOwaspCoverage;
exports.OWASP_API_TOP_10_2023 = [
    {
        id: 'API1:2023',
        shortId: 'API1',
        title: 'Broken Object Level Authorization',
        description: 'Endpoints that expose object identifiers without verifying the caller may access that specific object.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API2:2023',
        shortId: 'API2',
        title: 'Broken Authentication',
        description: 'Authentication that can be bypassed, is missing entirely, or accepts credentials it should reject.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API3:2023',
        shortId: 'API3',
        title: 'Broken Object Property Level Authorization',
        description: 'Excessive data exposure and mass assignment — reading or writing object properties the caller should not reach.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API4:2023',
        shortId: 'API4',
        title: 'Unrestricted Resource Consumption',
        description: 'Missing rate limiting or quota enforcement, allowing a caller to exhaust compute, bandwidth or third-party spend.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API5:2023',
        shortId: 'API5',
        title: 'Broken Function Level Authorization',
        description: 'Administrative or privileged operations reachable by callers who should not hold that role.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API6:2023',
        shortId: 'API6',
        title: 'Unrestricted Access to Sensitive Business Flows',
        description: 'Business flows — purchase, booking, posting — that can be automated at scale to the detriment of the business.',
        gapReason: 'No check declares this category.',
        scopeNote: 'Flows are identified from the naming in the specification, and each finding names the term that matched so the classification can be judged. A sensitive flow named in terms the vocabulary does not recognise is not examined, and whether a flow is genuinely business-critical remains a judgement only the API owner can make.',
    },
    {
        id: 'API7:2023',
        shortId: 'API7',
        title: 'Server Side Request Forgery',
        description: 'Endpoints that fetch a caller-supplied URL without validating its destination.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API8:2023',
        shortId: 'API8',
        title: 'Security Misconfiguration',
        description: 'Missing or permissive security headers, over-broad CORS policies, and other transport and platform misconfiguration.',
        gapReason: 'No check declares this category.',
    },
    {
        id: 'API9:2023',
        shortId: 'API9',
        title: 'Improper Inventory Management',
        description: 'Undocumented, deprecated or non-production API versions still reachable in the environment under test.',
        gapReason: 'No check declares this category.',
        scopeNote: 'Probing is confined to the host under assessment: undocumented versions, deprecated operations and exposed documentation, actuator and metrics surfaces on that host. A shadow API on a different hostname cannot be found this way — that needs an asset inventory the scanner is not given, and probing hosts nobody nominated would be scanning something nobody authorised.',
    },
    {
        id: 'API10:2023',
        shortId: 'API10',
        title: 'Unsafe Consumption of APIs',
        description: 'Trusting data from third-party APIs the service itself calls, without validating it.',
        gapReason: 'No check declares this category.',
        scopeNote: 'Only what crosses the client boundary is observable: upstream references returned over plain HTTP, upstream errors relayed verbatim, and inbound webhooks that accept unverified senders. The traffic the target sends to its own upstreams is invisible to a black-box scan, so whether it validates what those upstreams return cannot be settled here — that needs code or egress analysis.',
    },
];
function computeOwaspCoverage(manifests) {
    const categories = exports.OWASP_API_TOP_10_2023.map((definition) => {
        const matching = manifests.filter((manifest) => manifest.owaspMappings.includes(definition.id));
        const covered = matching.length > 0;
        return {
            id: definition.id,
            shortId: definition.shortId,
            title: definition.title,
            description: definition.description,
            status: covered ? 'COVERED' : 'NOT_COVERED',
            checkIds: matching.map((m) => m.id),
            checkNames: matching.map((m) => m.name),
            ruleCount: matching.reduce((total, m) => total + m.ruleIds.length, 0),
            ...(covered
                ? definition.scopeNote
                    ? { scopeNote: definition.scopeNote }
                    : {}
                : { gapReason: definition.gapReason }),
        };
    });
    const coveredCount = categories.filter((c) => c.status === 'COVERED').length;
    return {
        edition: '2023',
        categories,
        coveredCount,
        totalCount: categories.length,
        label: `${coveredCount}/${categories.length}`,
        checkCount: manifests.length,
        ruleCount: manifests.reduce((total, m) => total + m.ruleIds.length, 0),
    };
}
//# sourceMappingURL=owasp-coverage.js.map