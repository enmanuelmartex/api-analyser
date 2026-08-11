export type ReportFormat = 'PDF' | 'HTML' | 'MARKDOWN' | 'JSON' | 'SARIF';
export type ReportType = 'TECHNICAL' | 'EXECUTIVE' | 'DEVELOPER' | 'COMPLIANCE';
export declare const REPORT_FORMATS: readonly ReportFormat[];
export declare const REPORT_TYPES: readonly ReportType[];
export declare const GENERATOR_VERSION = "1.0.0";
interface FormatSpec {
    extension: string;
    contentType: string;
    binary: boolean;
}
export declare function isReportFormat(value: unknown): value is ReportFormat;
export declare function isReportType(value: unknown): value is ReportType;
export declare function formatSpec(format: ReportFormat): FormatSpec;
export declare function contentTypeFor(format: ReportFormat): string;
export declare function extensionFor(format: ReportFormat): string;
export declare function isBinaryFormat(format: ReportFormat): boolean;
export declare function slugify(value: string, fallback?: string): string;
export declare function buildFileName(input: {
    projectName: string;
    type: ReportType;
    format: ReportFormat;
    generatedAt: Date;
    version?: number;
}): string;
export declare function buildStoredFileName(reportId: string, format: ReportFormat): string;
export declare function assertStoredFileName(filePath: string): string;
export declare function contentDisposition(fileName: string): string;
export {};
