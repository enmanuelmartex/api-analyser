import { PrismaService } from '../../prisma/prisma.service';
import type { ScanFinding } from '../scanner/types/scanner.types';
export interface ExecutedScope {
    successfulPlugins: string[];
    failedPlugins: string[];
    skippedPlugins: string[];
    pluginVersions: Record<string, string>;
}
export interface PersistScanResultsInput {
    projectId: string;
    assessmentId: string;
    findings: ScanFinding[];
    scope: ExecutedScope;
    detectedAt: Date;
    assessmentConfigHash?: string;
    specVersion?: string;
}
export interface PersistScanResultsOutput {
    issuesCreated: number;
    issuesReopened: number;
    issuesRecurring: number;
    occurrencesCreated: number;
    occurrencesSkipped: number;
    issuesResolved: number;
    issuesNotTested: number;
}
export declare class IssueLifecycleService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    persistScanResults(input: PersistScanResultsInput): Promise<PersistScanResultsOutput>;
    private resolveIdentities;
    private persistDetection;
    private tryCreateOccurrence;
    private decideTransition;
    private reconcile;
}
