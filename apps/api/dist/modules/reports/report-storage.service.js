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
var ReportStorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportStorageService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const report_artifact_1 = require("./report-artifact");
let ReportStorageService = ReportStorageService_1 = class ReportStorageService {
    constructor() {
        this.logger = new common_1.Logger(ReportStorageService_1.name);
        const configured = process.env.REPORTS_DIR?.trim();
        this.storageRoot = configured
            ? (0, node_path_1.isAbsolute)(configured)
                ? (0, node_path_1.resolve)(configured)
                : (0, node_path_1.resolve)(process.cwd(), configured)
            : (0, node_path_1.resolve)(process.cwd(), 'storage', 'reports');
    }
    resolveWithinRoot(fileName) {
        const absolute = (0, node_path_1.resolve)((0, node_path_1.join)(this.storageRoot, (0, report_artifact_1.assertStoredFileName)(fileName)));
        const rootWithSep = this.storageRoot.endsWith(node_path_1.sep) ? this.storageRoot : this.storageRoot + node_path_1.sep;
        if (!absolute.startsWith(rootWithSep)) {
            throw new Error('Refusing to access a report artifact outside the storage root');
        }
        return absolute;
    }
    static checksum(bytes) {
        return (0, node_crypto_1.createHash)('sha256')
            .update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'))
            .digest('hex');
    }
    async write(fileName, bytes) {
        try {
            const absolute = this.resolveWithinRoot(fileName);
            await (0, promises_1.mkdir)(this.storageRoot, { recursive: true });
            await (0, promises_1.writeFile)(absolute, bytes);
            return fileName;
        }
        catch (error) {
            this.logger.warn(`Could not persist report artifact ${fileName}; it will be re-rendered from its snapshot on download. ${error.message}`);
            return null;
        }
    }
    async read(fileName) {
        try {
            return await (0, promises_1.readFile)(this.resolveWithinRoot(fileName));
        }
        catch {
            return null;
        }
    }
    async delete(fileName) {
        if (!fileName)
            return;
        try {
            await (0, promises_1.rm)(this.resolveWithinRoot(fileName), { force: true });
        }
        catch (error) {
            this.logger.warn(`Could not delete report artifact ${fileName}: ${error.message}`);
        }
    }
};
exports.ReportStorageService = ReportStorageService;
exports.ReportStorageService = ReportStorageService = ReportStorageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ReportStorageService);
//# sourceMappingURL=report-storage.service.js.map