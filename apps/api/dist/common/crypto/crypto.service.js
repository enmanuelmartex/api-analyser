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
var CryptoService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const env_validation_1 = require("../../config/env.validation");
let CryptoService = CryptoService_1 = class CryptoService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(CryptoService_1.name);
        this.key = (0, env_validation_1.deriveEncryptionKey)(this.configService.get('security.encryptionKey'));
    }
    encrypt(plaintext) {
        const iv = (0, crypto_1.randomBytes)(CryptoService_1.IV_BYTES);
        const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', this.key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return [
            CryptoService_1.VERSION,
            iv.toString('hex'),
            tag.toString('hex'),
            ciphertext.toString('hex'),
        ].join(':');
    }
    decrypt(encoded) {
        const parts = encoded.split(':');
        if (parts[0] !== CryptoService_1.VERSION || parts.length !== 4) {
            throw new Error('Ciphertext is malformed or uses an unsupported scheme. ' +
                'Only AES-256-GCM (v1) is supported; the credential must be re-entered.');
        }
        const [, ivHex, tagHex, ctHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        if (iv.length !== CryptoService_1.IV_BYTES || tag.length !== CryptoService_1.TAG_BYTES) {
            throw new Error('Ciphertext envelope is invalid: unexpected nonce or authentication tag length.');
        }
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', this.key, iv, {
            authTagLength: CryptoService_1.TAG_BYTES,
        });
        decipher.setAuthTag(tag);
        return Buffer.concat([
            decipher.update(Buffer.from(ctHex, 'hex')),
            decipher.final(),
        ]).toString('utf8');
    }
    isEncrypted(value) {
        if (!value)
            return false;
        const parts = value.split(':');
        return (parts.length === 4 &&
            parts[0] === CryptoService_1.VERSION &&
            /^[0-9a-f]+$/i.test(parts[1]) &&
            /^[0-9a-f]+$/i.test(parts[2]) &&
            /^[0-9a-f]+$/i.test(parts[3]));
    }
    encryptIfNeeded(value) {
        return this.isEncrypted(value) ? value : this.encrypt(value);
    }
    decryptIfNeeded(value) {
        if (!value)
            return undefined;
        if (!this.isEncrypted(value))
            return value;
        try {
            return this.decrypt(value);
        }
        catch {
            this.logger.error('Failed to decrypt a stored secret. It was encrypted with a different ' +
                'ENCRYPTION_KEY or has been tampered with. The credential must be re-entered.');
            return undefined;
        }
    }
    safeEquals(a, b) {
        const bufA = Buffer.from(a, 'utf8');
        const bufB = Buffer.from(b, 'utf8');
        if (bufA.length !== bufB.length)
            return false;
        return (0, crypto_1.timingSafeEqual)(bufA, bufB);
    }
};
exports.CryptoService = CryptoService;
CryptoService.VERSION = 'v1';
CryptoService.IV_BYTES = 12;
CryptoService.TAG_BYTES = 16;
exports.CryptoService = CryptoService = CryptoService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CryptoService);
//# sourceMappingURL=crypto.service.js.map