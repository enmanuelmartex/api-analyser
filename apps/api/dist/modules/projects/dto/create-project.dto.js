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
exports.UpdateProjectDto = exports.SaveProjectDraftDto = exports.CreateProjectDto = exports.ProjectEnvironment = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var ProjectEnvironment;
(function (ProjectEnvironment) {
    ProjectEnvironment["DEVELOPMENT"] = "DEVELOPMENT";
    ProjectEnvironment["STAGING"] = "STAGING";
    ProjectEnvironment["PRODUCTION"] = "PRODUCTION";
})(ProjectEnvironment || (exports.ProjectEnvironment = ProjectEnvironment = {}));
class CreateProjectDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String, maxLength: 100 }, description: { required: false, type: () => String, maxLength: 500 }, baseUrl: { required: true, type: () => String, format: "uri" }, environment: { required: false, enum: require("./create-project.dto").ProjectEnvironment }, tags: { required: false, type: () => [String] } };
    }
}
exports.CreateProjectDto = CreateProjectDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'My REST API' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Project name is required.' }),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateProjectDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Main backend API for mobile app' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateProjectDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'http://localhost:8000' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsUrl)({ require_protocol: true, require_tld: false, protocols: ['http', 'https'] }, { message: 'Enter a valid HTTP or HTTPS API base URL.' }),
    __metadata("design:type", String)
], CreateProjectDto.prototype, "baseUrl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ProjectEnvironment, default: 'DEVELOPMENT' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(ProjectEnvironment),
    __metadata("design:type", String)
], CreateProjectDto.prototype, "environment", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateProjectDto.prototype, "tags", void 0);
class SaveProjectDraftDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 100 }, description: { required: false, type: () => String, maxLength: 500 }, baseUrl: { required: false, type: () => String, maxLength: 2048 }, environment: { required: false, enum: require("./create-project.dto").ProjectEnvironment }, setupStep: { required: false, type: () => Number, minimum: 1, maximum: 3 } };
    }
}
exports.SaveProjectDraftDto = SaveProjectDraftDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], SaveProjectDraftDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], SaveProjectDraftDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2048),
    __metadata("design:type", String)
], SaveProjectDraftDto.prototype, "baseUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(ProjectEnvironment),
    __metadata("design:type", String)
], SaveProjectDraftDto.prototype, "environment", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(3),
    __metadata("design:type", Number)
], SaveProjectDraftDto.prototype, "setupStep", void 0);
class UpdateProjectDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: false, type: () => String, maxLength: 100 }, description: { required: false, type: () => String, maxLength: 500 }, baseUrl: { required: false, type: () => String }, environment: { required: false, enum: require("./create-project.dto").ProjectEnvironment }, tags: { required: false, type: () => [String] } };
    }
}
exports.UpdateProjectDto = UpdateProjectDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateProjectDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], UpdateProjectDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateProjectDto.prototype, "baseUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(ProjectEnvironment),
    __metadata("design:type", String)
], UpdateProjectDto.prototype, "environment", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UpdateProjectDto.prototype, "tags", void 0);
//# sourceMappingURL=create-project.dto.js.map