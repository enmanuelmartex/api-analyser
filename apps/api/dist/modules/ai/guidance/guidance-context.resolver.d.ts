import type { ContextConfidence } from './security-guidance.schema';
export interface DetectedTechnology {
    name: string;
    label: string;
    confidence: ContextConfidence;
    evidence: string;
}
export interface GuidanceContext {
    technologies: DetectedTechnology[];
    allowed: Map<string, ContextConfidence>;
    isUnknown: boolean;
}
export declare class GuidanceContextResolver {
    resolve(input: {
        httpResponse?: string | null;
        authType?: string | null;
        declaredStack?: string | null;
    }): GuidanceContext;
}
