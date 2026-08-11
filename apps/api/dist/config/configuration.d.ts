declare const _default: () => {
    port: number;
    nodeEnv: string;
    frontendUrl: string;
    database: {
        url: string;
    };
    redis: {
        url: string;
    };
    jwt: {
        secret: string;
        expiresIn: string;
        refreshSecret: string;
        refreshExpiresIn: string;
    };
    security: {
        encryptionKey: string;
        bcryptRounds: number;
    };
    ai: {
        provider: string;
        openai: {
            apiKey: string;
            model: string;
            maxTokens: number;
            temperature: number;
            timeoutMs: number;
            maxFindings: number;
            executiveSummary: boolean;
            analyzeCritical: boolean;
            analyzeHigh: boolean;
            analyzeMedium: boolean;
            analyzeLow: boolean;
        };
        grok: {
            apiKey: string;
            model: string;
            maxTokens: number;
            temperature: number;
            timeoutMs: number;
            maxFindings: number;
            executiveSummary: boolean;
            analyzeCritical: boolean;
            analyzeHigh: boolean;
            analyzeMedium: boolean;
            analyzeLow: boolean;
        };
        claude: {
            apiKey: string;
            model: string;
            maxTokens: number;
            temperature: number;
            timeoutMs: number;
            maxFindings: number;
            executiveSummary: boolean;
            analyzeCritical: boolean;
            analyzeHigh: boolean;
            analyzeMedium: boolean;
            analyzeLow: boolean;
        };
        gemini: {
            apiKey: string;
            model: string;
            maxTokens: number;
            temperature: number;
            timeoutMs: number;
            maxFindings: number;
            executiveSummary: boolean;
            analyzeCritical: boolean;
            analyzeHigh: boolean;
            analyzeMedium: boolean;
            analyzeLow: boolean;
        };
        ollama: {
            baseUrl: string;
            model: string;
            maxTokens: number;
            temperature: number;
            timeoutMs: number;
            maxFindings: number;
            executiveSummary: boolean;
            analyzeCritical: boolean;
            analyzeHigh: boolean;
            analyzeMedium: boolean;
            analyzeLow: boolean;
        };
    };
    scanner: {
        maxConcurrentScans: number;
        scanTimeoutMs: number;
        maxRequestsPerEndpoint: number;
        rateLimitTestRequests: number;
        requestDelayMs: number;
    };
    reports: {
        dir: string;
    };
};
export default _default;
