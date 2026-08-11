export declare const REDACTED = "[REDACTED]";
export declare function isSensitiveHeader(name: string): boolean;
export declare function isSensitiveParam(name: string): boolean;
export declare function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string>;
export declare function redactUrl(rawUrl: string): string;
export declare function redactObject<T>(value: T, depth?: number): T;
export declare function redactHttpMessage(message: string | undefined): string | undefined;
