import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ScannerService } from './scanner.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { IssueLifecycleService } from '../issues/issue-lifecycle.service';
import { ScoringService } from '../scoring/scoring.service';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import { ReportsService } from '../reports/reports.service';
import { IssueGuidanceService } from '../ai/guidance/issue-guidance.service';
interface JobData {
    assessmentId: string;
    projectId: string;
    specId: string;
    userId?: string;
}
export declare class ScannerProcessor extends WorkerHost {
    private prisma;
    private scannerService;
    private eventEmitter;
    private pluginRegistry;
    private reportsService;
    private crypto;
    private issueLifecycle;
    private scoring;
    private issueGuidance;
    private readonly logger;
    constructor(prisma: PrismaService, scannerService: ScannerService, eventEmitter: EventEmitter2, pluginRegistry: PluginRegistryService, reportsService: ReportsService, crypto: CryptoService, issueLifecycle: IssueLifecycleService, scoring: ScoringService, issueGuidance: IssueGuidanceService);
    private hashConfig;
    process(job: Job<JobData>): Promise<{
        assessmentId: string;
        findingsCount: number;
        duration: number;
        pluginPlan: import("./scanner.service").PluginExecutionPlan;
        aiMeta: import("../ai/interfaces/ai-provider.interface").AiAnalysisMeta;
    }>;
    private emit;
    private updateProgress;
    private addLog;
    private autoGenerateReport;
    private summariseDetections;
}
export {};
