"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const issue_lifecycle_service_1 = require("./issue-lifecycle.service");
const issues_service_1 = require("./issues.service");
const issues_controller_1 = require("./issues.controller");
const audit_module_1 = require("../audit/audit.module");
let IssuesModule = class IssuesModule {
};
exports.IssuesModule = IssuesModule;
exports.IssuesModule = IssuesModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, audit_module_1.AuditModule],
        controllers: [issues_controller_1.IssuesController],
        providers: [issue_lifecycle_service_1.IssueLifecycleService, issues_service_1.IssuesService],
        exports: [issue_lifecycle_service_1.IssueLifecycleService, issues_service_1.IssuesService],
    })
], IssuesModule);
//# sourceMappingURL=issues.module.js.map