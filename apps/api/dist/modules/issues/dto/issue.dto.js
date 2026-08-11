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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignIssueDto = exports.UpdateIssueStatusDto = exports.IssueQueryDto = exports.SeverityDto = exports.IssueStatusDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
var IssueStatusDto;
(function (IssueStatusDto) {
    IssueStatusDto["OPEN"] = "OPEN";
    IssueStatusDto["ACKNOWLEDGED"] = "ACKNOWLEDGED";
    IssueStatusDto["RESOLVED"] = "RESOLVED";
    IssueStatusDto["ACCEPTED_RISK"] = "ACCEPTED_RISK";
    IssueStatusDto["FALSE_POSITIVE"] = "FALSE_POSITIVE";
})(IssueStatusDto || (exports.IssueStatusDto = IssueStatusDto = {}));
var SeverityDto;
(function (SeverityDto) {
    SeverityDto["CRITICAL"] = "CRITICAL";
    SeverityDto["HIGH"] = "HIGH";
    SeverityDto["MEDIUM"] = "MEDIUM";
    SeverityDto["LOW"] = "LOW";
    SeverityDto["INFO"] = "INFO";
})(SeverityDto || (exports.SeverityDto = SeverityDto = {}));
class IssueQueryDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { projectId: { required: false, type: () => String }, status: { required: false, type: () => String }, severity: { required: false, type: () => String }, owaspCategory: { required: false, type: () => String }, pluginId: { required: false, type: () => String }, ruleId: { required: false, type: () => String }, assigneeId: { required: false, type: () => String }, search: { required: false, type: () => String, maxLength: 200 }, page: { required: false, type: () => Number, minimum: 1 }, pageSize: { required: false, type: () => Number, minimum: 1, maximum: 100 } };
    }
}
exports.IssueQueryDto = IssueQueryDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: IssueStatusDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(IssueStatusDto),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: SeverityDto }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(SeverityDto),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "severity", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "owaspCategory", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "pluginId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "ruleId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "assigneeId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], IssueQueryDto.prototype, "search", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], IssueQueryDto.prototype, "page", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: 20, maximum: 100 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], IssueQueryDto.prototype, "pageSize", void 0);
class UpdateIssueStatusDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { status: { required: true, type: () => String }, reason: { required: false, type: () => String, maxLength: 2000 }, acceptedRiskUntil: { required: false, type: () => String } };
    }
}
exports.UpdateIssueStatusDto = UpdateIssueStatusDto;
__decorate([
    (0, class_validator_1.IsEnum)(IssueStatusDto),
    __metadata("design:type", String)
], UpdateIssueStatusDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], UpdateIssueStatusDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsISO8601)(),
    __metadata("design:type", String)
], UpdateIssueStatusDto.prototype, "acceptedRiskUntil", void 0);
class AssignIssueDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { assigneeId: { required: false, type: () => String, nullable: true } };
    }
}
exports.AssignIssueDto = AssignIssueDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssignIssueDto.prototype, "assigneeId", void 0);
//# sourceMappingURL=issue.dto.js.map