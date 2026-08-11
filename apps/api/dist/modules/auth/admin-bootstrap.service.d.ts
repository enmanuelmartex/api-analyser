import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
export declare class AdminBootstrapService implements OnModuleInit {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    static readonly DEFAULT_EMAIL = "admin@apianalyser.local";
    static readonly DEFAULT_PASSWORD = "admin1234";
    constructor(prisma: PrismaService, config: ConfigService);
    onModuleInit(): Promise<void>;
    private warnIfDefaultPasswordStillInUse;
}
