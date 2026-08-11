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
exports.PluginsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const plugins_service_1 = require("./plugins.service");
const plugin_executor_service_1 = require("./plugin-executor.service");
const plugin_registry_service_1 = require("./plugin-registry.service");
const plugin_manifest_types_1 = require("../scanner/types/plugin-manifest.types");
let PluginsController = class PluginsController {
    constructor(pluginsService, executor, registry) {
        this.pluginsService = pluginsService;
        this.executor = executor;
        this.registry = registry;
    }
    findAll(req) {
        return this.pluginsService.findAll(req.user.id);
    }
    getCategories() {
        const inUse = new Set(this.registry.getAllManifests().map((manifest) => manifest.category));
        return Object.values(plugin_manifest_types_1.PluginCategory).filter((category) => inUse.has(category));
    }
    getOwaspCoverage() {
        return this.registry.getOwaspCoverage();
    }
    findOne(id, req) {
        return this.pluginsService.findOne(id, req.user.id);
    }
    toggle(id, body, req) {
        return this.pluginsService.toggle(id, req.user.id, body.isEnabled);
    }
    saveConfig(id, body, req) {
        return this.pluginsService.saveConfig(id, req.user.id, body);
    }
    getExecutions(id, req) {
        return this.pluginsService.getExecutionHistory(id, req.user.id);
    }
    getIssues(id, req) {
        return this.pluginsService.getIssues(id, req.user.id);
    }
    runPlugin(pluginId, body, req) {
        return this.executor.runSinglePlugin({
            pluginId,
            projectId: body.projectId,
            userId: req.user.id,
            pluginConfig: body.pluginConfig,
            timeoutMs: body.timeoutMs,
        });
    }
};
exports.PluginsController = PluginsController;
__decorate([
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('categories'),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "getCategories", null);
__decorate([
    (0, common_1.Get)('owasp-coverage'),
    openapi.ApiResponse({ status: 200, type: Object }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "getOwaspCoverage", null);
__decorate([
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Put)(':id/toggle'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "toggle", null);
__decorate([
    (0, common_1.Put)(':id/config'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "saveConfig", null);
__decorate([
    (0, common_1.Get)(':id/executions'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "getExecutions", null);
__decorate([
    (0, common_1.Get)(':id/issues'),
    openapi.ApiResponse({ status: 200, type: [Object] }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "getIssues", null);
__decorate([
    (0, common_1.Post)(':id/run'),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], PluginsController.prototype, "runPlugin", null);
exports.PluginsController = PluginsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('plugins'),
    __metadata("design:paramtypes", [plugins_service_1.PluginsService,
        plugin_executor_service_1.PluginExecutorService,
        plugin_registry_service_1.PluginRegistryService])
], PluginsController);
//# sourceMappingURL=plugins.controller.js.map