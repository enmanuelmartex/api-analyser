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
exports.UsersController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const users_service_1 = require("./users.service");
const audit_service_1 = require("../audit/audit.service");
const create_user_dto_1 = require("./dto/create-user.dto");
const update_user_dto_1 = require("./dto/update-user.dto");
const change_role_dto_1 = require("./dto/change-role.dto");
const reset_password_dto_1 = require("./dto/reset-password.dto");
const set_status_dto_1 = require("./dto/set-status.dto");
const invite_user_dto_1 = require("./dto/invite-user.dto");
let UsersController = class UsersController {
    constructor(users, audit) {
        this.users = users;
        this.audit = audit;
    }
    findAll() {
        return this.users.findAll();
    }
    getAuditLogs(limit, offset, userId, action, resource) {
        return this.audit.findAll({
            userId,
            action: action,
            resource,
            limit,
            offset,
        });
    }
    invite(dto, actor) {
        return this.users.sendInvitation(dto, actor.id);
    }
    listAssignable() {
        return this.users.findAssignable();
    }
    verifyInvite(token) {
        if (!token)
            throw new common_1.NotFoundException('Token is required');
        return this.users.verifyInvitation(token);
    }
    acceptInvite(token, user) {
        return this.users.acceptInvitation(token, user.id);
    }
    findOne(id) {
        return this.users.findOne(id);
    }
    create(dto, actor) {
        return this.users.create(dto, actor.id);
    }
    update(id, dto, actor) {
        return this.users.update(id, dto, actor.id);
    }
    changeRole(id, dto, actor) {
        return this.users.changeRole(id, dto.role, actor.id);
    }
    setStatus(id, dto, actor) {
        return this.users.setActive(id, dto.isActive, actor.id);
    }
    resetPassword(id, dto, actor) {
        return this.users.resetPassword(id, dto.newPassword, actor.id);
    }
    remove(id, actor) {
        return this.users.remove(id, actor.id);
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('audit-logs'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('limit', new common_1.DefaultValuePipe(50), common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('offset', new common_1.DefaultValuePipe(0), common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)('userId')),
    __param(3, (0, common_1.Query)('action')),
    __param(4, (0, common_1.Query)('resource')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number, String, String, String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getAuditLogs", null);
__decorate([
    (0, common_1.Post)('invite'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [invite_user_dto_1.InviteUserDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "invite", null);
__decorate([
    (0, roles_decorator_1.Roles)(),
    (0, common_1.Get)('assignable'),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "listAssignable", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, roles_decorator_1.Roles)(),
    (0, common_1.Get)('verify-invite'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "verifyInvite", null);
__decorate([
    (0, roles_decorator_1.Roles)(),
    (0, common_1.Post)('accept-invite'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)('token')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "acceptInvite", null);
__decorate([
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.CreateUserDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_user_dto_1.UpdateUserDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/role'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, change_role_dto_1.ChangeRoleDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "changeRole", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, set_status_dto_1.SetStatusDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "setStatus", null);
__decorate([
    (0, common_1.Post)(':id/password-reset'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reset_password_dto_1.ResetPasswordDto, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "remove", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        audit_service_1.AuditService])
], UsersController);
//# sourceMappingURL=users.controller.js.map