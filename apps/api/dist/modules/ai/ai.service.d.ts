import { AiProviderFactory } from './ai-provider.factory';
import { AiConfigService } from './ai-config.service';
import type { AiAnalysisMeta, AiProviderStatus } from './interfaces/ai-provider.interface';
import type { ScanFinding, ScanContext } from '../scanner/types/scanner.types';
export declare class AiService {
    private readonly factory;
    private readonly aiConfigService;
    private readonly logger;
    constructor(factory: AiProviderFactory, aiConfigService: AiConfigService);
    analyzeFindings(findings: ScanFinding[], context: ScanContext): Promise<AiAnalysisMeta>;
    getProviderStatus(): Promise<AiProviderStatus>;
    private selectCandidates;
    private isProviderUnavailable;
    private analyzeBatch;
    private generateExecutiveSummary;
    private parseJsonSafely;
    private buildMeta;
}
