export declare function isExternalRef(ref: unknown): boolean;
export declare function isOpenApi31Document(spec: unknown): boolean;
export declare function assertNoExternalRefs(spec: unknown): void;
export declare const SAFE_PARSER_OPTIONS: {
    resolve: {
        external: boolean;
        http: boolean;
        file: boolean;
    };
    dereference: {
        circular: "ignore";
    };
};
