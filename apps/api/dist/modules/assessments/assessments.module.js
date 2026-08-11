"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssessmentsModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const assessments_controller_1 = require("./assessments.controller");
const assessments_service_1 = require("./assessments.service");
const plugins_module_1 = require("../plugins/plugins.module");
const scoring_module_1 = require("../scoring/scoring.module");
const audit_module_1 = require("../audit/audit.module");
let AssessmentsModule = class AssessmentsModule {
};
exports.AssessmentsModule = AssessmentsModule;
exports.AssessmentsModule = AssessmentsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.registerQueue({ name: 'scanner' }),
            plugins_module_1.PluginsModule,
            scoring_module_1.ScoringModule,
            audit_module_1.AuditModule,
        ],
        controllers: [assessments_controller_1.AssessmentsController],
        providers: [assessments_service_1.AssessmentsService],
        exports: [assessments_service_1.AssessmentsService],
    })
], AssessmentsModule);
//# sourceMappingURL=assessments.module.js.map