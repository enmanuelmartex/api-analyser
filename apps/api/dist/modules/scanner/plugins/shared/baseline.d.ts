export interface ProbeObservation {
    status: number;
    bodyLength: number;
}
export declare function isDistinctFromBaseline(probe: ProbeObservation, baseline: ProbeObservation): boolean;
