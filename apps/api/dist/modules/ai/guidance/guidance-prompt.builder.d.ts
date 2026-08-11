import type { GuidanceContext } from './guidance-context.resolver';
import type { SecurityPlaybook } from './security-knowledge.registry';
export declare const GUIDANCE_PROMPT_VERSION = "guidance-prompt-v3";
export interface GuidancePromptInput {
    title: string;
    severity: string;
    owaspCategory: string;
    ruleId: string;
    method: string;
    route: string;
    component: string;
    description: string;
    httpRequest?: string | null;
    httpResponse?: string | null;
    context: GuidanceContext;
    playbooks: SecurityPlaybook[];
}
export declare function buildGuidanceSystemPrompt(): string;
export declare function buildGuidanceUserPrompt(input: GuidancePromptInput): string;
