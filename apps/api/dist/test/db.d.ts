import { PrismaClient } from '@prisma/client';
export declare function testDatabaseUrl(): string;
export declare function setupTestDatabase(): Promise<PrismaClient>;
export declare function resetTestDatabase(prisma: PrismaClient): Promise<void>;
export declare function teardownTestDatabase(): Promise<void>;
export declare function seedProjectAndAssessment(prisma: PrismaClient, options?: {
    projectId?: string;
    assessmentId?: string;
}): Promise<{
    user: {
        id: string;
        createdAt: Date;
        name: string;
        email: string;
        password: string | null;
        role: import("@prisma/client").$Enums.Role;
        avatar: string | null;
        isActive: boolean;
        lastLogin: Date | null;
        emailVerified: boolean;
        ownerId: string | null;
        updatedAt: Date;
    };
    project: {
        id: string;
        createdAt: Date;
        userId: string;
        name: string;
        isActive: boolean;
        updatedAt: Date;
        description: string | null;
        tags: string[];
        baseUrl: string;
        environment: import("@prisma/client").$Enums.Environment;
        setupStep: number;
        assetCriticality: import("@prisma/client").$Enums.AssetCriticality;
        status: import("@prisma/client").$Enums.ProjectStatus;
        completedAt: Date | null;
    };
    assessment: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        duration: number | null;
        status: import("@prisma/client").$Enums.AssessmentStatus;
        completedAt: Date | null;
        projectId: string;
        progress: number;
        currentStep: string | null;
        jobId: string | null;
        startedAt: Date | null;
    };
}>;
