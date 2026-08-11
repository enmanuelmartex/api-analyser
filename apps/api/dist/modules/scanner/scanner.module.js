"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const scanner_service_1 = require("./scanner.service");
const scanner_processor_1 = require("./scanner.processor");
const ai_module_1 = require("../ai/ai.module");
const plugins_module_1 = require("../plugins/plugins.module");
const reports_module_1 = require("../reports/reports.module");
const issues_module_1 = require("../issues/issues.module");
const scoring_module_1 = require("../scoring/scoring.module");
let ScannerModule = class ScannerModule {
};
exports.ScannerModule = ScannerModule;
exports.ScannerModule = ScannerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.registerQueue({ name: 'scanner' }),
            ai_module_1.AiModule,
            plugins_module_1.PluginsModule,
            reports_module_1.ReportsModule,
            issues_module_1.IssuesModule,
            scoring_module_1.ScoringModule,
        ],
        providers: [scanner_service_1.ScannerService, scanner_processor_1.ScannerProcessor],
        exports: [scanner_service_1.ScannerService],
    })
], ScannerModule);
//# sourceMappingURL=scanner.module.js.map