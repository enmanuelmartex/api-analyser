export type RequestOutcome = 'processed' | 'challenged' | 'absent' | 'error';
export declare function classifyOutcome(status: number): RequestOutcome;
export declare function wasProcessed(status: number): boolean;
export declare function wasChallenged(status: number): boolean;
