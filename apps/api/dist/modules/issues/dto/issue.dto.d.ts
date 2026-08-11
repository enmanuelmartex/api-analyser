export declare enum IssueStatusDto {
    OPEN = "OPEN",
    ACKNOWLEDGED = "ACKNOWLEDGED",
    RESOLVED = "RESOLVED",
    ACCEPTED_RISK = "ACCEPTED_RISK",
    FALSE_POSITIVE = "FALSE_POSITIVE"
}
export declare enum SeverityDto {
    CRITICAL = "CRITICAL",
    HIGH = "HIGH",
    MEDIUM = "MEDIUM",
    LOW = "LOW",
    INFO = "INFO"
}
export declare class IssueQueryDto {
    projectId?: string;
    status?: string;
    severity?: string;
    owaspCategory?: string;
    pluginId?: string;
    ruleId?: string;
    assigneeId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}
export declare class UpdateIssueStatusDto {
    status: string;
    reason?: string;
    acceptedRiskUntil?: string;
}
export declare class AssignIssueDto {
    assigneeId?: string | null;
}
