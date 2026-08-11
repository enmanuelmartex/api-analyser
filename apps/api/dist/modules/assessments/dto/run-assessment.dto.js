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
exports.RunAssessmentDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class RunAssessmentDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { executionMode: { required: false, type: () => Object, enum: ['all', 'profile', 'manual'] }, scanProfileId: { required: false, type: () => String }, manualPlugins: { required: false, type: () => [String] }, enableAiAnalysis: { required: false, type: () => Boolean }, maxRequestsPerEndpoint: { required: false, type: () => Number, minimum: 1, maximum: 100 }, requestDelayMs: { required: false, type: () => Number, minimum: 0, maximum: 60000 }, timeoutMs: { required: false, type: () => Number, minimum: 1000, maximum: 120000 } };
    }
}
exports.RunAssessmentDto = RunAssessmentDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ['all', 'profile', 'manual'], default: 'all' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['all', 'profile', 'manual']),
    __metadata("design:type", String)
], RunAssessmentDto.prototype, "executionMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RunAssessmentDto.prototype, "scanProfileId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], RunAssessmentDto.prototype, "manualPlugins", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RunAssessmentDto.prototype, "enableAiAnalysis", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], RunAssessmentDto.prototype, "maxRequestsPerEndpoint", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(60_000),
    __metadata("design:type", Number)
], RunAssessmentDto.prototype, "requestDelayMs", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1_000),
    (0, class_validator_1.Max)(120_000),
    __metadata("design:type", Number)
], RunAssessmentDto.prototype, "timeoutMs", void 0);
//# sourceMappingURL=run-assessment.dto.js.map