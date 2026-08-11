export declare const KNOWLEDGE_PACK_VERSION = "knowledge-2026.08.1";
export type PlaybookScope = 'owasp' | 'rule' | 'framework' | 'cloud' | 'auth';
export interface SecurityPlaybook {
    id: string;
    scope: PlaybookScope;
    keys: string[];
    title: string;
    content: string;
    references: {
        title: string;
        url: string;
    }[];
    updatedAt: string;
}
export interface KnowledgeSelection {
    playbooks: SecurityPlaybook[];
    version: string;
}
export declare class SecurityKnowledgeRegistry {
    private readonly byKey;
    constructor();
    get version(): string;
    all(): SecurityPlaybook[];
    select(input: {
        owaspCategory?: string | null;
        ruleId?: string | null;
        technologies?: string[];
    }): KnowledgeSelection;
}
