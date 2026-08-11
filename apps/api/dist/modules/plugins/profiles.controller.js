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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfilesController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const profiles_service_1 = require("./profiles.service");
const audit_service_1 = require("../audit/audit.service");
const scan_profile_dto_1 = require("./dto/scan-profile.dto");
let ProfilesController = class ProfilesController {
    constructor(profilesService, audit) {
        this.profilesService = profilesService;
        this.audit = audit;
    }
    findAll(req) {
        return this.profilesService.findAll(req.user.id);
    }
    findOne(id, req) {
        return this.profilesService.findOne(id, req.user.id);
    }
    async create(body, req) {
        const profile = await this.profilesService.create(req.user.id, body);
        this.audit.log({
            userId: req.user.id,
            action: client_1.AuditAction.CREATE,
            resource: 'scanProfile',
            resourceId: profile?.id,
            metadata: { name: body.name, checks: body.enabledPlugins },
        });
        return profile;
    }
    async update(id, body, req) {
        const profile = await this.profilesService.update(id, req.user.id, body);
        this.audit.log({
            userId: req.user.id,
            action: client_1.AuditAction.UPDATE,
            resource: 'scanProfile',
            resourceId: id,
            metadata: { fields: Object.keys(body ?? {}) },
        });
        return profile;
    }
    async remove(id, req) {
        const result = await this.profilesService.remove(id, req.user.id);
        this.audit.log({
            userId: req.user.id,
            action: client_1.AuditAction.DELETE,
            resource: 'scanProfile',
            resourceId: id,
        });
        return result;
    }
};
exports.ProfilesController = ProfilesController;
__decorate([
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProfilesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProfilesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [scan_profile_dto_1.CreateScanProfileDto, Object]),
    __metadata("design:returntype", Promise)
], ProfilesController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, scan_profile_dto_1.UpdateScanProfileDto, Object]),
    __metadata("design:returntype", Promise)
], ProfilesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ProfilesController.prototype, "remove", null);
exports.ProfilesController = ProfilesController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('plugins/profiles'),
    __metadata("design:paramtypes", [profiles_service_1.ProfilesService,
        audit_service_1.AuditService])
], ProfilesController);
//# sourceMappingURL=profiles.controller.js.map