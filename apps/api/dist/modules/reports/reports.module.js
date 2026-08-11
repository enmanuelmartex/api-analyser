"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsModule = void 0;
const common_1 = require("@nestjs/common");
const reports_controller_1 = require("./reports.controller");
const reports_service_1 = require("./reports.service");
const report_generator_service_1 = require("./report-generator.service");
const report_storage_service_1 = require("./report-storage.service");
const audit_module_1 = require("../audit/audit.module");
const plugins_module_1 = require("../plugins/plugins.module");
let ReportsModule = class ReportsModule {
};
exports.ReportsModule = ReportsModule;
exports.ReportsModule = ReportsModule = __decorate([
    (0, common_1.Module)({
        imports: [audit_module_1.AuditModule, plugins_module_1.PluginsModule],
        controllers: [reports_controller_1.ReportsController],
        providers: [reports_service_1.ReportsService, report_generator_service_1.ReportGeneratorService, report_storage_service_1.ReportStorageService],
        exports: [reports_service_1.ReportsService, report_generator_service_1.ReportGeneratorService, report_storage_service_1.ReportStorageService],
    })
], ReportsModule);
//# sourceMappingURL=reports.module.js.map