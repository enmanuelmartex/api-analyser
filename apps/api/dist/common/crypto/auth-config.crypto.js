"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_AUTH_FIELDS = exports.ENCRYPTED_AUTH_FIELDS = void 0;
exports.encryptAuthFields = encryptAuthFields;
exports.decryptAuthFields = decryptAuthFields;
exports.stripAuthSecrets = stripAuthSecrets;
exports.ENCRYPTED_AUTH_FIELDS = [
    'token',
    'password',
    'apiKey',
    'clientId',
    'clientSecret',
];
exports.SECRET_AUTH_FIELDS = [
    ...exports.ENCRYPTED_AUTH_FIELDS,
    'customHeaders',
];
function encryptAuthFields(crypto, authData) {
    const result = { ...authData };
    for (const field of exports.ENCRYPTED_AUTH_FIELDS) {
        const value = result[field];
        if (typeof value === 'string' && value.length > 0) {
            result[field] = crypto.encryptIfNeeded(value);
        }
    }
    return result;
}
function decryptAuthFields(crypto, authConfig) {
    if (!authConfig)
        return null;
    const result = { ...authConfig };
    for (const field of exports.ENCRYPTED_AUTH_FIELDS) {
        const value = result[field];
        if (typeof value === 'string' && value.length > 0) {
            result[field] = crypto.decryptIfNeeded(value) ?? null;
        }
    }
    return result;
}
function stripAuthSecrets(authConfig) {
    if (!authConfig)
        return authConfig;
    const safe = { ...authConfig };
    for (const field of exports.SECRET_AUTH_FIELDS)
        delete safe[field];
    return safe;
}
//# sourceMappingURL=auth-config.crypto.js.map