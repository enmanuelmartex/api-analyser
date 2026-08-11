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
exports.AiUsageService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
const provider_pricing_1 = require("./provider-pricing");
let AiUsageService = class AiUsageService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getSummary() {
        const guidance = this.prisma;
        const [rows, byStatus, byProviderModel, failures] = await Promise.all([
            guidance.issueGuidance.aggregate({
                _sum: { tokensInput: true, tokensOutput: true, costUsd: true },
                _count: { _all: true },
            }),
            guidance.issueGuidance.groupBy({
                by: ['status'],
                _count: { _all: true },
            }),
            guidance.issueGuidance.groupBy({
                by: ['provider', 'model'],
                _count: { _all: true },
                _sum: { tokensInput: true, tokensOutput: true, costUsd: true },
            }),
            guidance.issueGuidance.groupBy({
                by: ['errorCode'],
                where: { status: 'FAILED' },
                _count: { _all: true },
            }),
        ]);
        const statusCount = (status) => byStatus.find((row) => row.status === status)?._count?._all ?? 0;
        const succeeded = statusCount('READY');
        const totalCost = Number((rows._sum.costUsd ?? 0).toFixed(6));
        return {
            totalEnrichments: rows._count._all ?? 0,
            succeeded,
            failed: statusCount('FAILED'),
            skipped: statusCount('SKIPPED'),
            tokensInput: rows._sum.tokensInput ?? 0,
            tokensOutput: rows._sum.tokensOutput ?? 0,
            estimatedCostUsd: totalCost,
            averageCostPerEnrichment: succeeded > 0 ? Number((totalCost / succeeded).toFixed(6)) : null,
            byProvider: byProviderModel
                .map((row) => ({
                provider: row.provider,
                model: row.model,
                count: row._count._all,
                tokensInput: row._sum.tokensInput ?? 0,
                tokensOutput: row._sum.tokensOutput ?? 0,
                estimatedCostUsd: Number((row._sum.costUsd ?? 0).toFixed(6)),
            }))
                .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
            failureBreakdown: failures
                .map((row) => ({ errorCode: row.errorCode ?? 'UNKNOWN', count: row._count._all }))
                .sort((a, b) => b.count - a.count),
            pricingTableVersion: provider_pricing_1.PRICING_TABLE_VERSION,
            costIsEstimated: true,
        };
    }
};
exports.AiUsageService = AiUsageService;
exports.AiUsageService = AiUsageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiUsageService);
//# sourceMappingURL=ai-usage.service.js.map