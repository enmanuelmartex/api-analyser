export declare enum PluginCategory {
    AUTHENTICATION = "Authentication",
    AUTHORIZATION = "Authorization",
    HEADERS = "Headers",
    INJECTION = "Injection",
    API_DESIGN = "API Design",
    PERFORMANCE = "Performance",
    INFRASTRUCTURE = "Infrastructure",
    COMPLIANCE = "Compliance",
    AI = "AI",
    CLOUD = "Cloud",
    GRAPHQL = "GraphQL",
    GRPC = "gRPC",
    SOAP = "SOAP"
}
export type ApiType = 'REST' | 'GraphQL' | 'gRPC' | 'SOAP';
export type PluginPermission = 'http:read' | 'http:write' | 'findings:write' | 'ai:read' | 'db:read' | 'cache:read' | 'cache:write';
export interface PluginConfigField {
    key: string;
    label: string;
    description?: string;
    type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
    default?: any;
    options?: Array<{
        value: string | number;
        label: string;
    }>;
    min?: number;
    max?: number;
    required?: boolean;
}
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    longDescription?: string;
    author: string;
    license: string;
    category: PluginCategory;
    owaspMappings: string[];
    cweIds?: string[];
    tags: string[];
    supportedApiTypes: ApiType[];
    permissions: PluginPermission[];
    configFields?: PluginConfigField[];
    defaultConfig?: Record<string, any>;
    documentationUrl?: string;
    changelog?: string;
    minimumCoreVersion: string;
    isBuiltin: boolean;
    ruleNamespace: string;
    ruleIds: string[];
}
