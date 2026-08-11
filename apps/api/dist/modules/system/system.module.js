"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const plugins_module_1 = require("../plugins/plugins.module");
const system_controller_1 = require("./system.controller");
const health_controller_1 = require("./health.controller");
const system_service_1 = require("./system.service");
let SystemModule = class SystemModule {
};
exports.SystemModule = SystemModule;
exports.SystemModule = SystemModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, plugins_module_1.PluginsModule],
        controllers: [system_controller_1.SystemController, health_controller_1.HealthController],
        providers: [system_service_1.SystemService],
    })
], SystemModule);
//# sourceMappingURL=system.module.js.map