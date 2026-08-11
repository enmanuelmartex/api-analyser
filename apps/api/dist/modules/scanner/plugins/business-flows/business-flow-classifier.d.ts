export type BusinessFlowKind = 'PAYMENT' | 'ORDER' | 'BOOKING' | 'ACCOUNT' | 'MESSAGING' | 'CONTENT' | 'REWARD';
export interface BusinessFlowMatch {
    kind: BusinessFlowKind;
    term: string;
    matchedIn: 'path' | 'summary' | 'tag';
}
export interface ClassifiableEndpoint {
    path: string;
    method: string;
    summary?: string;
    tags?: string[];
}
export declare function classifyBusinessFlow(endpoint: ClassifiableEndpoint): BusinessFlowMatch | null;
export declare function isHighImpactFlow(kind: BusinessFlowKind): boolean;
export declare function flowKindLabel(kind: BusinessFlowKind): string;
