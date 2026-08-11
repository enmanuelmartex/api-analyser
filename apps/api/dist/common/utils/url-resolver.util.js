"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTargetUrl = resolveTargetUrl;
exports.assertSafeRemoteUrl = assertSafeRemoteUrl;
const common_1 = require("@nestjs/common");
const promises_1 = require("node:dns/promises");
const node_net_1 = require("node:net");
const IS_DOCKER = process.env.DOCKER_ENV === 'true';
const LOCALHOST_PATTERN = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?/;
function resolveTargetUrl(url) {
    if (!IS_DOCKER)
        return url;
    return url.replace(LOCALHOST_PATTERN, '$1host.docker.internal$3');
}
async function assertSafeRemoteUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new common_1.BadRequestException('Enter a valid HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new common_1.BadRequestException('Only credential-free HTTP and HTTPS URLs are allowed.');
    }
    if (process.env.ALLOW_PRIVATE_TARGETS === 'true')
        return url.toString();
    let addresses;
    try {
        addresses = (0, node_net_1.isIP)(url.hostname)
            ? [{ address: url.hostname }]
            : await (0, promises_1.lookup)(url.hostname, { all: true, verbatim: true });
    }
    catch {
        throw new common_1.BadRequestException('The URL hostname could not be resolved.');
    }
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new common_1.BadRequestException('Private, loopback, link-local and reserved network targets are not allowed.');
    }
    return url.toString();
}
function isPrivateAddress(address) {
    const normalized = address.toLowerCase().replace(/^::ffff:/, '');
    if (normalized.includes(':')) {
        return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
            normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('2001:db8:');
    }
    const parts = normalized.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
        return true;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51) || (a === 203 && b === 0);
}
//# sourceMappingURL=url-resolver.util.js.map