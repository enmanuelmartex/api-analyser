"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_PARSER_OPTIONS = void 0;
exports.isExternalRef = isExternalRef;
exports.isOpenApi31Document = isOpenApi31Document;
exports.assertNoExternalRefs = assertNoExternalRefs;
const common_1 = require("@nestjs/common");
const MAX_NODES = 200_000;
const MAX_DEPTH = 100;
function isExternalRef(ref) {
    if (typeof ref !== 'string')
        return false;
    const trimmed = ref.trim();
    if (trimmed === '')
        return false;
    return !trimmed.startsWith('#');
}
function isOpenApi31Document(spec) {
    if (spec === null || typeof spec !== 'object')
        return false;
    const version = spec.openapi;
    return typeof version === 'string' && /^3\.1(?:\.|$)/.test(version.trim());
}
function assertNoExternalRefs(spec) {
    const offenders = [];
    let nodes = 0;
    const visit = (node, depth) => {
        if (node === null || typeof node !== 'object')
            return;
        if (depth > MAX_DEPTH)
            return;
        if (++nodes > MAX_NODES) {
            throw new common_1.BadRequestException('The specification is too large or deeply nested to validate safely.');
        }
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item, depth + 1);
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === '$ref' && isExternalRef(value)) {
                if (offenders.length < 5)
                    offenders.push(String(value).slice(0, 120));
            }
            visit(value, depth + 1);
        }
    };
    visit(spec, 0);
    if (offenders.length > 0) {
        throw new common_1.BadRequestException('This specification contains external $ref references, which are not ' +
            'supported because resolving them would let the specification make ' +
            'network or filesystem requests on the server. Bundle the specification ' +
            'into a single self-contained document and try again. ' +
            `Found: ${offenders.join(', ')}`);
    }
}
exports.SAFE_PARSER_OPTIONS = {
    resolve: {
        external: false,
        http: false,
        file: false,
    },
    dereference: {
        circular: 'ignore',
    },
};
//# sourceMappingURL=openapi-safety.util.js.map