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
var AdminBootstrapService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminBootstrapService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcryptjs");
const prisma_service_1 = require("../../prisma/prisma.service");
const auth_1 = require("../../lib/auth");
let AdminBootstrapService = AdminBootstrapService_1 = class AdminBootstrapService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.logger = new common_1.Logger(AdminBootstrapService_1.name);
    }
    async onModuleInit() {
        const email = (this.config.get('ADMIN_EMAIL') ?? AdminBootstrapService_1.DEFAULT_EMAIL)
            .toLowerCase()
            .trim();
        const password = this.config.get('ADMIN_PASSWORD') ?? AdminBootstrapService_1.DEFAULT_PASSWORD;
        try {
            const existing = await this.prisma.user.count();
            if (existing > 0) {
                this.warnIfDefaultPasswordStillInUse(email, password);
                return;
            }
            await auth_1.auth.api.signUpEmail({
                body: { name: 'Administrator', email, password },
            });
            const rounds = this.config.get('security.bcryptRounds', 12);
            await this.prisma.user.update({
                where: { email },
                data: { password: await bcrypt.hash(password, rounds), role: 'ADMIN', isActive: true },
            });
            this.logger.warn(`Created the default administrator: ${email} / ${password} — change this password before exposing the instance.`);
        }
        catch (error) {
            this.logger.error(`Could not create the default administrator: ${error.message}`);
        }
    }
    warnIfDefaultPasswordStillInUse(email, password) {
        if (password !== AdminBootstrapService_1.DEFAULT_PASSWORD)
            return;
        this.logger.warn(`The default administrator password is still in use (${email} / ${password}). ` +
            'Change it in Settings, or set ADMIN_PASSWORD before the first boot.');
    }
};
exports.AdminBootstrapService = AdminBootstrapService;
AdminBootstrapService.DEFAULT_EMAIL = 'admin@apianalyser.local';
AdminBootstrapService.DEFAULT_PASSWORD = 'admin1234';
exports.AdminBootstrapService = AdminBootstrapService = AdminBootstrapService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], AdminBootstrapService);
//# sourceMappingURL=admin-bootstrap.service.js.map