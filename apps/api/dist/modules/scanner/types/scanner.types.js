"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasePlugin = void 0;
const redact_util_1 = require("../../../common/utils/redact.util");
const brand_1 = require("../../../brand/brand");
class BasePlugin {
    get id() { return this.manifest.id; }
    get name() { return this.manifest.name; }
    get description() { return this.manifest.description; }
    get owaspCategories() { return this.manifest.owaspMappings; }
    buildRequestString(method, url, headers, body) {
        const headerLines = Object.entries((0, redact_util_1.redactHeaders)(headers))
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');
        const rawBody = body ? (typeof body === 'string' ? body : JSON.stringify((0, redact_util_1.redactObject)(body), null, 2)) : '';
        const bodyStr = rawBody ? `\n\n${rawBody}` : '';
        return (0, redact_util_1.redactHttpMessage)(`${method.toUpperCase()} ${(0, redact_util_1.redactUrl)(url)} HTTP/1.1\n${headerLines}${bodyStr}`);
    }
    buildResponseString(status, headers, body) {
        const headerLines = Object.entries((0, redact_util_1.redactHeaders)(headers))
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');
        const rawBody = body ? (typeof body === 'string' ? body : JSON.stringify((0, redact_util_1.redactObject)(body), null, 2)) : '';
        const bodyStr = rawBody ? `\n\n${rawBody}` : '';
        return (0, redact_util_1.redactHttpMessage)(`HTTP/1.1 ${status}\n${headerLines}${bodyStr}`);
    }
    getAuthHeaders(auth) {
        const headers = {
            'User-Agent': brand_1.appBrand.scannerUserAgent,
            'Accept': 'application/json, */*',
        };
        switch (auth.type) {
            case 'BEARER':
                if (auth.token)
                    headers['Authorization'] = `Bearer ${auth.token}`;
                break;
            case 'BASIC':
                if (auth.username && auth.password) {
                    const creds = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
                    headers['Authorization'] = `Basic ${creds}`;
                }
                break;
            case 'API_KEY':
                if (auth.apiKey && auth.apiKeyLocation !== 'query') {
                    headers[auth.apiKeyHeader || 'X-API-Key'] = auth.apiKey;
                }
                break;
            case 'CUSTOM':
                Object.assign(headers, auth.customHeaders || {});
                break;
        }
        return headers;
    }
    getApiKeyQueryParam(auth) {
        if (auth.type === 'API_KEY' && auth.apiKeyLocation === 'query' && auth.apiKey) {
            return { [auth.apiKeyHeader || 'api_key']: auth.apiKey };
        }
        return {};
    }
    buildUrl(baseUrl, path, params) {
        const cleanBase = baseUrl.replace(/\/$/, '');
        const cleanPath = path.replace(/^\//, '');
        let url = `${cleanBase}/${cleanPath}`;
        if (params && Object.keys(params).length > 0) {
            const qs = new URLSearchParams(params).toString();
            url += `?${qs}`;
        }
        return url;
    }
    fillPathParams(path) {
        return path.replace(/\{[^}]+\}/g, (match) => {
            const paramName = match.slice(1, -1).toLowerCase();
            if (paramName.includes('id') || paramName.includes('uuid'))
                return '1';
            if (paramName.includes('name'))
                return 'test';
            if (paramName.includes('slug'))
                return 'test-slug';
            if (paramName.includes('code'))
                return 'ABC123';
            return 'test';
        });
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.BasePlugin = BasePlugin;
//# sourceMappingURL=scanner.types.js.map