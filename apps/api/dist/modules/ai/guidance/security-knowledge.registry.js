"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityKnowledgeRegistry = exports.KNOWLEDGE_PACK_VERSION = void 0;
const common_1 = require("@nestjs/common");
exports.KNOWLEDGE_PACK_VERSION = 'knowledge-2026.08.1';
const PLAYBOOKS = [
    {
        id: 'owasp/api1-bola',
        scope: 'owasp',
        keys: ['api1:2023'],
        title: 'Broken Object Level Authorization',
        content: 'Every request that names an object must re-check that the authenticated principal may act on THAT object. ' +
            'Enforce the check server-side, in the data access path, not in the controller or the UI. ' +
            'Do not rely on unguessable identifiers as an access control — UUIDs are obscurity, not authorization. ' +
            'Prefer scoping every query by the owning principal (`where: { id, ownerId: caller.id }`) so a missing check ' +
            'fails closed and returns 404 rather than leaking existence.',
        references: [
            {
                title: 'OWASP API1:2023 Broken Object Level Authorization',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api2-authentication',
        scope: 'owasp',
        keys: ['api2:2023'],
        title: 'Broken Authentication',
        content: 'Validate token signature, issuer, audience and expiry on every request, and reject anything malformed with 401. ' +
            'Never accept `alg: none`, never trust a `kid` that selects a caller-supplied key, and do not fall back to an ' +
            'unverified decode when verification fails. Authentication must be enforced by shared middleware applied by ' +
            'default, with public routes opting out explicitly — the reverse leaves new routes unprotected.',
        references: [
            {
                title: 'OWASP API2:2023 Broken Authentication',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
            },
            {
                title: 'OWASP JWT Cheat Sheet',
                url: 'https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api3-bopla',
        scope: 'owasp',
        keys: ['api3:2023'],
        title: 'Broken Object Property Level Authorization',
        content: 'Serialise responses from an explicit allowlist of properties rather than returning the persistence model. ' +
            'On write, bind only the fields the caller is permitted to set — accepting the whole body and saving it lets a ' +
            'caller set `role`, `isAdmin` or `ownerId`. Schema validation with unknown-property rejection is the enforcement ' +
            'point; client-side filtering is not.',
        references: [
            {
                title: 'OWASP API3:2023 Broken Object Property Level Authorization',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api4-resource-consumption',
        scope: 'owasp',
        keys: ['api4:2023'],
        title: 'Unrestricted Resource Consumption',
        content: 'Apply rate limits per authenticated principal and per IP, at the edge and in the application. Bound every ' +
            'pagination parameter with a server-side maximum, cap request body size, and set timeouts on outbound calls. ' +
            'Return 429 with `Retry-After`. Pay particular attention to endpoints that trigger cost — email, SMS, third-party ' +
            'APIs — where the limit protects spend, not just availability.',
        references: [
            {
                title: 'OWASP API4:2023 Unrestricted Resource Consumption',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api5-bfla',
        scope: 'owasp',
        keys: ['api5:2023'],
        title: 'Broken Function Level Authorization',
        content: 'Deny by default and require an explicit role or permission for every route, especially administrative ones. ' +
            'Do not infer privilege from the URL prefix or from the HTTP method. Verify that a standard user receives 403 on ' +
            'every administrative operation, including the ones not linked from any UI.',
        references: [
            {
                title: 'OWASP API5:2023 Broken Function Level Authorization',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api6-business-flows',
        scope: 'owasp',
        keys: ['api6:2023'],
        title: 'Unrestricted Access to Sensitive Business Flows',
        content: 'The control has to sit on the business action, not on the endpoint. Rate-limit per authenticated principal, ' +
            'per payment instrument and per device rather than per IP, which a proxy pool defeats. Require an idempotency ' +
            'key on flows that move money or reserve inventory, and return the stored result for a repeated key. Add a ' +
            'challenge — captcha, OTP, step-up authentication — when a caller exceeds normal usage for that flow, not on ' +
            'every request. Enforce business quotas (orders per customer per hour, invitations per account, redemptions ' +
            'per identity) and alert on the ratio between flow starts and completions, because automation shows up in that ' +
            'ratio long before it shows up in request volume.',
        references: [
            {
                title: 'OWASP API6:2023 Unrestricted Access to Sensitive Business Flows',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
            },
            {
                title: 'OWASP Automated Threats to Web Applications',
                url: 'https://owasp.org/www-project-automated-threats-to-web-applications/',
            },
        ],
        updatedAt: '2026-08-09',
    },
    {
        id: 'owasp/api7-ssrf',
        scope: 'owasp',
        keys: ['api7:2023'],
        title: 'Server Side Request Forgery',
        content: 'Validate any caller-supplied URL against an allowlist of hosts and schemes before fetching it. Resolve DNS first ' +
            'and reject private, loopback, link-local and metadata addresses — including after redirects, which must be ' +
            're-validated at every hop or disabled. Blocklists of literal IPs are bypassed by DNS rebinding and alternate ' +
            'encodings; allowlisting is the control that holds.',
        references: [
            {
                title: 'OWASP API7:2023 Server Side Request Forgery',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/',
            },
            {
                title: 'OWASP SSRF Prevention Cheat Sheet',
                url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api8-misconfiguration',
        scope: 'owasp',
        keys: ['api8:2023'],
        title: 'Security Misconfiguration',
        content: 'Send HSTS on HTTPS origins, `X-Content-Type-Options: nosniff`, a restrictive `Content-Security-Policy` for any ' +
            'browser-rendered response, and a frame-ancestors policy. For CORS, never reflect an arbitrary `Origin` and never ' +
            'combine a wildcard origin with credentials — enumerate permitted origins explicitly. Disable verbose error ' +
            'output and stack traces in production.',
        references: [
            {
                title: 'OWASP API8:2023 Security Misconfiguration',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/',
            },
            {
                title: 'MDN CORS',
                url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'owasp/api9-inventory',
        scope: 'owasp',
        keys: ['api9:2023'],
        title: 'Improper Inventory Management',
        content: 'Generate the inventory of deployed versions and hosts from deployment configuration rather than maintaining ' +
            'it by hand, and scan every entry — an undocumented version is untested by definition and stops receiving the ' +
            'authorization fixes applied to its replacement. Give retired versions an announced sunset date, return ' +
            '`Deprecation` and `Sunset` headers while they are still up, then remove the routes; a deprecation that never ' +
            'ends is documentation, not a control. Keep specifications, management endpoints and debug surfaces off the ' +
            'public interface: bind actuator and metrics to a separate port with their own authentication, and expose only ' +
            'the endpoints operations actually needs rather than the default wildcard. Non-production environments belong ' +
            'behind a VPN or an allowlist and should hold synthetic data.',
        references: [
            {
                title: 'OWASP API9:2023 Improper Inventory Management',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-inventory-management/',
            },
            {
                title: 'RFC 8594 — The Sunset HTTP Header Field',
                url: 'https://datatracker.ietf.org/doc/html/rfc8594',
            },
        ],
        updatedAt: '2026-08-09',
    },
    {
        id: 'owasp/api10-unsafe-consumption',
        scope: 'owasp',
        keys: ['api10:2023'],
        title: 'Unsafe Consumption of APIs',
        content: 'Treat every response from a third party as untrusted input: validate it against a schema before it reaches ' +
            'business logic, and never relay an upstream error to your own callers — translate it into your error contract ' +
            'and log the original against a correlation id. Reach upstreams over TLS with certificate verification, and ' +
            'reject plain-HTTP upstream URLs in configuration validation at start-up so a mistyped variable fails the ' +
            'deploy rather than the transport. Apply timeouts and a circuit breaker so a failing dependency degrades the ' +
            'API instead of shaping it, and do not follow redirects into hosts outside the allowlist. For inbound ' +
            'webhooks, verify the provider signature over the raw body before parsing, compare digests in constant time, ' +
            'reject a missing signature as firmly as a wrong one, enforce the signed timestamp, and re-read the affected ' +
            'object from the provider rather than trusting the payload as truth.',
        references: [
            {
                title: 'OWASP API10:2023 Unsafe Consumption of APIs',
                url: 'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/',
            },
            {
                title: 'OWASP Webhook Security Cheat Sheet',
                url: 'https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html',
            },
        ],
        updatedAt: '2026-08-09',
    },
    {
        id: 'frameworks/express',
        scope: 'framework',
        keys: ['express'],
        title: 'Express',
        content: 'Use `helmet()` for security headers and configure `cors()` with an explicit origin list rather than `true`. ' +
            'Apply authentication as app-level middleware so routes are protected by default. Use `express-rate-limit` keyed ' +
            'on the authenticated principal where one exists. Set `express.json({ limit })` to bound body size.',
        references: [
            { title: 'Express security best practices', url: 'https://expressjs.com/en/advanced/best-practice-security.html' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'frameworks/nestjs',
        scope: 'framework',
        keys: ['nestjs', 'nest'],
        title: 'NestJS',
        content: 'Register a global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted` so unknown properties are ' +
            'rejected rather than ignored — this is the mass-assignment control, and it only applies to bodies typed with a ' +
            'DTO class, not inline TypeScript types. Bind `JwtAuthGuard` globally with an explicit `@Public()` opt-out. Use ' +
            'guards for role checks and interceptors for response serialisation via `@Exclude`/`@Expose`.',
        references: [
            { title: 'NestJS Security', url: 'https://docs.nestjs.com/security/authentication' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'frameworks/django',
        scope: 'framework',
        keys: ['django', 'django rest framework', 'drf'],
        title: 'Django / DRF',
        content: 'Set `DEFAULT_PERMISSION_CLASSES` to a deny-by-default value such as `IsAuthenticated`, and add object-level ' +
            'permissions via `get_object`/`check_object_permissions` for BOLA. Use serializers with explicit `fields` rather ' +
            'than `__all__`. Enable `SECURE_HSTS_SECONDS`, `SECURE_CONTENT_TYPE_NOSNIFF` and set `DEBUG = False`.',
        references: [
            { title: 'Django security', url: 'https://docs.djangoproject.com/en/stable/topics/security/' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'frameworks/spring',
        scope: 'framework',
        keys: ['spring', 'spring boot'],
        title: 'Spring Boot',
        content: 'Configure `SecurityFilterChain` to `authenticated()` by default with explicit `permitAll()` exceptions. Use ' +
            '`@PreAuthorize` for function-level checks and `@PostAuthorize`/repository scoping for object-level ones. Bind ' +
            'request bodies to dedicated DTOs rather than entities to prevent mass assignment.',
        references: [
            { title: 'Spring Security', url: 'https://docs.spring.io/spring-security/reference/' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'frameworks/fastapi',
        scope: 'framework',
        keys: ['fastapi', 'uvicorn', 'starlette'],
        title: 'FastAPI',
        content: 'Declare dependencies (`Depends`) for authentication on the router so routes inherit protection. Use separate ' +
            'Pydantic models for input and output — returning the ORM model leaks properties. Set `response_model` explicitly ' +
            'to bound what is serialised.',
        references: [{ title: 'FastAPI security', url: 'https://fastapi.tiangolo.com/tutorial/security/' }],
        updatedAt: '2026-08-01',
    },
    {
        id: 'frameworks/aspnet',
        scope: 'framework',
        keys: ['asp.net', 'aspnet', 'kestrel'],
        title: 'ASP.NET Core',
        content: 'Apply `[Authorize]` via a global filter with `[AllowAnonymous]` as the explicit exception. Use policy-based ' +
            'authorization for function-level checks and resource-based handlers for object-level ones. Bind to explicit DTOs, ' +
            'or use `[Bind]`, to prevent over-posting.',
        references: [
            { title: 'ASP.NET Core security', url: 'https://learn.microsoft.com/aspnet/core/security/' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'cloud/aws-api-gateway',
        scope: 'cloud',
        keys: ['aws', 'amazon', 'api gateway', 'cloudfront'],
        title: 'AWS API Gateway',
        content: 'Enforce authentication with a Lambda authorizer or Cognito authorizer at the gateway, and keep the same check in ' +
            'the service — the gateway is defence in depth, not the only control. Configure usage plans and throttling for ' +
            'rate limiting, and WAF for coarse filtering. Configure CORS on the gateway rather than emitting duplicate ' +
            'headers from both gateway and origin.',
        references: [
            {
                title: 'AWS API Gateway security',
                url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-control-access-to-api.html',
            },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'cloud/azure-api-management',
        scope: 'cloud',
        keys: ['azure', 'azure api management', 'apim'],
        title: 'Azure API Management',
        content: 'Use inbound policies — `validate-jwt` for authentication, `rate-limit-by-key` for throttling, and `cors` for ' +
            'origin control. Keep the backend independently authenticated so a direct call that bypasses APIM is still ' +
            'rejected.',
        references: [
            { title: 'Azure APIM policies', url: 'https://learn.microsoft.com/azure/api-management/api-management-policies' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'cloud/gcp-api-gateway',
        scope: 'cloud',
        keys: ['gcp', 'google', 'cloud run', 'app engine'],
        title: 'Google Cloud',
        content: 'Use API Gateway or Cloud Endpoints with a JWT provider for authentication, and Cloud Armor for rate limiting and ' +
            'IP controls. On Cloud Run, keep the service private and require IAM invocation where the API is internal.',
        references: [
            { title: 'Google Cloud API Gateway auth', url: 'https://cloud.google.com/api-gateway/docs/authentication-method' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'infra/nginx',
        scope: 'cloud',
        keys: ['nginx'],
        title: 'nginx',
        content: 'Add security headers with `add_header ... always` so they are present on error responses too. Use `limit_req` ' +
            'zones for rate limiting. Note that `add_header` in a nested block replaces inherited headers rather than adding ' +
            'to them — a common cause of headers appearing on some routes only.',
        references: [{ title: 'nginx http headers', url: 'https://nginx.org/en/docs/http/ngx_http_headers_module.html' }],
        updatedAt: '2026-08-01',
    },
    {
        id: 'auth/jwt',
        scope: 'auth',
        keys: ['jwt'],
        title: 'JWT',
        content: 'Pin the accepted algorithm explicitly and reject tokens that declare another. Verify `exp`, `nbf`, `iss` and ' +
            '`aud`. Keep access-token lifetime short and revoke via a short-lived cache or token version rather than trusting ' +
            'expiry alone. Never place secrets or personal data in the payload — it is signed, not encrypted.',
        references: [
            { title: 'RFC 8725 JWT Best Current Practices', url: 'https://datatracker.ietf.org/doc/html/rfc8725' },
        ],
        updatedAt: '2026-08-01',
    },
    {
        id: 'auth/oauth2',
        scope: 'auth',
        keys: ['oauth', 'oauth2', 'oidc'],
        title: 'OAuth 2 / OIDC',
        content: 'Use authorization code with PKCE for public clients. Validate `state` to prevent CSRF and register exact redirect ' +
            'URIs — no wildcards. Validate the ID token signature and `aud` before trusting any claim, and treat scopes as ' +
            'coarse capability grants, not as object-level authorization.',
        references: [
            {
                title: 'OAuth 2.0 Security Best Current Practice',
                url: 'https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics',
            },
        ],
        updatedAt: '2026-08-01',
    },
];
let SecurityKnowledgeRegistry = class SecurityKnowledgeRegistry {
    constructor() {
        this.byKey = new Map();
        for (const playbook of PLAYBOOKS) {
            for (const key of playbook.keys) {
                const bucket = this.byKey.get(key) ?? [];
                bucket.push(playbook);
                this.byKey.set(key, bucket);
            }
        }
    }
    get version() {
        return exports.KNOWLEDGE_PACK_VERSION;
    }
    all() {
        return [...PLAYBOOKS];
    }
    select(input) {
        const seen = new Set();
        const playbooks = [];
        const collect = (key) => {
            if (!key)
                return;
            for (const playbook of this.byKey.get(key.toLowerCase()) ?? []) {
                if (seen.has(playbook.id))
                    continue;
                seen.add(playbook.id);
                playbooks.push(playbook);
            }
        };
        collect(input.owaspCategory);
        collect(input.ruleId);
        for (const technology of input.technologies ?? [])
            collect(technology);
        return { playbooks, version: exports.KNOWLEDGE_PACK_VERSION };
    }
};
exports.SecurityKnowledgeRegistry = SecurityKnowledgeRegistry;
exports.SecurityKnowledgeRegistry = SecurityKnowledgeRegistry = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], SecurityKnowledgeRegistry);
//# sourceMappingURL=security-knowledge.registry.js.map