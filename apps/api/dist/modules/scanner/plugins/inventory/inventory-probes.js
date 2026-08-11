"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGEMENT_PROBES = exports.DOCUMENTATION_PROBES = void 0;
exports.indicatesLiveRoute = indicatesLiveRoute;
exports.versionSegmentOf = versionSegmentOf;
exports.siblingVersions = siblingVersions;
exports.swapVersion = swapVersion;
exports.nonProductionMarker = nonProductionMarker;
function indicatesLiveRoute(status) {
    if (status <= 0)
        return false;
    if ([404, 410, 501].includes(status))
        return false;
    return status < 600;
}
function versionSegmentOf(path) {
    for (const segment of path.split('/')) {
        if (/^v\d{1,2}$/i.test(segment))
            return segment.toLowerCase();
    }
    return null;
}
function siblingVersions(version, documented, limit = 3) {
    const major = Number(version.replace(/^v/i, ''));
    if (!Number.isFinite(major))
        return [];
    return [major + 1, major - 1, major + 2]
        .filter((candidate) => candidate >= 0)
        .map((candidate) => `v${candidate}`)
        .filter((candidate) => candidate !== version.toLowerCase() && !documented.has(candidate))
        .slice(0, limit);
}
function swapVersion(path, from, to) {
    return path
        .split('/')
        .map((segment) => (segment.toLowerCase() === from.toLowerCase() ? to : segment))
        .join('/');
}
const NON_PRODUCTION_MARKERS = [
    'dev', 'develop', 'development', 'staging', 'stage', 'test', 'testing',
    'uat', 'qa', 'sandbox', 'sbx', 'preprod', 'preproduction', 'demo', 'internal',
];
function nonProductionMarker(hostname) {
    const labels = hostname.toLowerCase().split(/[.\-_]/);
    return NON_PRODUCTION_MARKERS.find((marker) => labels.includes(marker)) ?? null;
}
exports.DOCUMENTATION_PROBES = [
    {
        path: '/openapi.json',
        label: 'OpenAPI document',
        matches: (body) => /"openapi"\s*:|"swagger"\s*:/.test(body),
        severity: 'MEDIUM',
        discloses: 'the full route, parameter and schema inventory of the API',
    },
    {
        path: '/swagger.json',
        label: 'Swagger document',
        matches: (body) => /"openapi"\s*:|"swagger"\s*:/.test(body),
        severity: 'MEDIUM',
        discloses: 'the full route, parameter and schema inventory of the API',
    },
    {
        path: '/v3/api-docs',
        label: 'Springdoc API document',
        matches: (body) => /"openapi"\s*:|"swagger"\s*:/.test(body),
        severity: 'MEDIUM',
        discloses: 'the full route, parameter and schema inventory of the API',
    },
    {
        path: '/api-docs',
        label: 'API documentation endpoint',
        matches: (body) => /"openapi"\s*:|"swagger"\s*:|swagger-ui/i.test(body),
        severity: 'MEDIUM',
        discloses: 'the full route, parameter and schema inventory of the API',
    },
    {
        path: '/swagger-ui.html',
        label: 'Swagger UI',
        matches: (body) => /swagger-ui/i.test(body),
        severity: 'MEDIUM',
        discloses: 'an interactive console against the live API',
    },
];
exports.MANAGEMENT_PROBES = [
    {
        path: '/actuator',
        label: 'Spring Boot Actuator index',
        matches: (body) => /"_links"|"actuator"/i.test(body),
        severity: 'MEDIUM',
        discloses: 'the list of management endpoints exposed by the runtime',
    },
    {
        path: '/actuator/env',
        label: 'Spring Boot Actuator environment',
        matches: (body) => /"activeProfiles"|"propertySources"/i.test(body),
        severity: 'HIGH',
        discloses: 'environment variables and configuration properties, frequently including credentials',
    },
    {
        path: '/actuator/mappings',
        label: 'Spring Boot Actuator mappings',
        matches: (body) => /"dispatcherServlets"|"handlerMethod"/i.test(body),
        severity: 'HIGH',
        discloses: 'every route the application serves, documented or not',
    },
    {
        path: '/metrics',
        label: 'Prometheus metrics',
        matches: (body) => /^#\s*(HELP|TYPE)\s/m.test(body),
        severity: 'MEDIUM',
        discloses: 'internal route names, traffic volumes and runtime internals',
    },
    {
        path: '/debug/vars',
        label: 'Go expvar debug endpoint',
        matches: (body) => /"cmdline"|"memstats"/.test(body),
        severity: 'MEDIUM',
        discloses: 'the process command line and memory statistics',
    },
];
//# sourceMappingURL=inventory-probes.js.map