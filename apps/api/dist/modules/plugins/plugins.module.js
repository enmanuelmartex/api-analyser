"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginsModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const audit_module_1 = require("../audit/audit.module");
const plugin_registry_service_1 = require("./plugin-registry.service");
const plugins_service_1 = require("./plugins.service");
const plugin_executor_service_1 = require("./plugin-executor.service");
const profiles_service_1 = require("./profiles.service");
const plugins_controller_1 = require("./plugins.controller");
const profiles_controller_1 = require("./profiles.controller");
let PluginsModule = class PluginsModule {
};
exports.PluginsModule = PluginsModule;
exports.PluginsModule = PluginsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, audit_module_1.AuditModule],
        providers: [
            plugin_registry_service_1.PluginRegistryService,
            plugins_service_1.PluginsService,
            plugin_executor_service_1.PluginExecutorService,
            profiles_service_1.ProfilesService,
        ],
        controllers: [profiles_controller_1.ProfilesController, plugins_controller_1.PluginsController],
        exports: [plugin_registry_service_1.PluginRegistryService, plugin_executor_service_1.PluginExecutorService],
    })
], PluginsModule);
//# sourceMappingURL=plugins.module.js.map