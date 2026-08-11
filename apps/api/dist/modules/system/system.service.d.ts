import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistryService } from '../plugins/plugin-registry.service';
import type { OwaspCoverageSummary } from '../plugins/owasp-coverage';
export interface SystemCheckState {
    id: string;
    name: string;
    category: string;
    owaspMappings: string[];
    ruleCount: number;
    isEnabled: boolean;
}
export interface SystemInfo {
    product: {
        name: string;
        version: string;
        tagline: string;
        domain: string;
    };
    runtime: {
        apiFramework: string;
        bunVersion: string | null;
        nodeVersion: string;
        uptimeSeconds: number;
        environment: string;
    };
    securityChecks: {
        total: number;
        enabled: number;
        totalRules: number;
        checks: SystemCheckState[];
    };
    owasp: OwaspCoverageSummary;
}
export declare class SystemService {
    private readonly prisma;
    private readonly registry;
    constructor(prisma: PrismaService, registry: PluginRegistryService);
    getInfo(): Promise<SystemInfo>;
}
