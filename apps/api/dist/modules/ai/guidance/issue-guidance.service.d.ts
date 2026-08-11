import { PrismaService } from '../../../prisma/prisma.service';
import { AiProviderFactory } from '../ai-provider.factory';
import { AiConfigService } from '../ai-config.service';
import { GuidanceContextResolver } from './guidance-context.resolver';
import { SecurityKnowledgeRegistry } from './security-knowledge.registry';
export interface EnrichIssuesInput {
    issueIds: string[];
    projectId: string;
    authType?: string | null;
}
export interface EnrichIssuesResult {
    requested: number;
    succeeded: number;
    failed: number;
    skipped: number;
    tokensInput: number;
    tokensOutput: number;
    estimatedCostUsd: number;
    provider: string;
    model: string;
}
export declare class IssueGuidanceService {
    private readonly prisma;
    private readonly factory;
    private readonly aiConfigService;
    private readonly contextResolver;
    private readonly knowledge;
    private readonly logger;
    constructor(prisma: PrismaService, factory: AiProviderFactory, aiConfigService: AiConfigService, contextResolver: GuidanceContextResolver, knowledge: SecurityKnowledgeRegistry);
    enrichIssues(input: EnrichIssuesInput): Promise<EnrichIssuesResult>;
    private enrichOne;
    private store;
    private isProviderUnavailable;
}
