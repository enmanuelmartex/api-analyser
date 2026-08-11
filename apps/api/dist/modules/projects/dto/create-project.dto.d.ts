export declare enum ProjectEnvironment {
    DEVELOPMENT = "DEVELOPMENT",
    STAGING = "STAGING",
    PRODUCTION = "PRODUCTION"
}
export declare class CreateProjectDto {
    name: string;
    description?: string;
    baseUrl: string;
    environment?: ProjectEnvironment;
    tags?: string[];
}
export declare class SaveProjectDraftDto {
    name?: string;
    description?: string;
    baseUrl?: string;
    environment?: ProjectEnvironment;
    setupStep?: number;
}
export declare class UpdateProjectDto {
    name?: string;
    description?: string;
    baseUrl?: string;
    environment?: ProjectEnvironment;
    tags?: string[];
}
