export type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';
export declare function esc(value: unknown): string;
interface Sections {
    evidence: boolean;
    narrative: boolean;
    reproduction: boolean;
    owasp: boolean;
    methodology: boolean;
    detailedFindingLimit: number | null;
    subtitle: string;
}
export declare function sectionsFor(type: ReportType): Sections;
export interface TemplateInput {
    assessment: any;
    type: ReportType;
    reportId?: string;
    version?: number;
}
export declare function renderReportHtml({ assessment, type, reportId, version }: TemplateInput): string;
export {};
