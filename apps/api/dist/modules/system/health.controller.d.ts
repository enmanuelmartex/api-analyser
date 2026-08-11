import { PrismaService } from '../../prisma/prisma.service';
export declare class HealthController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    live(): {
        status: string;
        service: string;
        uptime: number;
        timestamp: string;
    };
    ready(): Promise<{
        status: string;
        checks: {
            database: "up" | "down";
        };
        timestamp: string;
    }>;
}
