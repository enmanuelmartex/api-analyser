export interface ScanContext {
    assessmentId: string;
    projectId: string;
    baseUrl: string;
    auth: AuthConfig;
    endpoints: ParsedEndpoint[];
    config: ScanConfig;
}
export interface AuthConfig {
    type: 'NONE' | 'BEARER' | 'BASIC' | 'API_KEY' | 'OAUTH2' | 'CUSTOM';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    apiKeyHeader?: string;
    apiKeyLocation?: 'header' | 'query';
    customHeaders?: Record<string, string>;
}
export interface ParsedEndpoint {
    id: string;
    path: string;
    method: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: EndpointParameter[];
    requestBody?: any;
    responses?: any;
    security?: any[];
    deprecated?: boolean;
}
export interface EndpointParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    schema?: any;
    example?: any;
}
export interface ScanConfig {
    executionMode: 'all' | 'profile' | 'manual';
    selectedPlugins?: string[];
    enableAiAnalysis: boolean;
    maxRequestsPerEndpoint: number;
    requestDelayMs: number;
    timeoutMs: number;
}
export interface ScanFinding {
    title: string;
    category: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    cvssScore?: number;
    cvssVector?: string;
    owaspCategory: string;
    cweId?: string;
    pluginId: string;
    ruleId: string;
    component?: string;
    route?: string;
    method?: string;
    endpointId?: string;
    affectedUrl?: string;
    description: string;
    impact?: string;
    likelihood?: string;
    riskScore?: number;
    evidence?: any;
    httpRequest?: string;
    httpResponse?: string;
    remediation?: string;
    references?: string[];
    aiAnalysis?: {
        executiveSummary?: string;
        technicalAnalysis?: string;
        businessImpact?: string;
        confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
        falsePositiveRisk?: 'HIGH' | 'MEDIUM' | 'LOW';
        codeExamples?: {
            vulnerable?: string;
            fixed?: string;
        };
    };
}
export interface PluginResult {
    pluginId: string;
    pluginName: string;
    findings: ScanFinding[];
    scanDuration: number;
    endpointsTested: number;
    error?: string;
}
export interface ScanProgress {
    assessmentId: string;
    step: string;
    stepIndex: number;
    totalSteps: number;
    progress: number;
    message: string;
    findingsCount: number;
    currentPlugin?: string;
}
export declare abstract class BasePlugin {
    abstract readonly manifest: import('./plugin-manifest.types').PluginManifest;
    get id(): string;
    get name(): string;
    get description(): string;
    get owaspCategories(): string[];
    abstract run(context: ScanContext, pluginConfig?: Record<string, any>): Promise<PluginResult>;
    protected buildRequestString(method: string, url: string, headers: Record<string, string>, body?: any): string;
    protected buildResponseString(status: number, headers: Record<string, string>, body: any): string;
    protected getAuthHeaders(auth: AuthConfig): Record<string, string>;
    protected getApiKeyQueryParam(auth: AuthConfig): Record<string, string>;
    protected buildUrl(baseUrl: string, path: string, params?: Record<string, string>): string;
    protected fillPathParams(path: string): string;
    protected delay(ms: number): Promise<void>;
}
