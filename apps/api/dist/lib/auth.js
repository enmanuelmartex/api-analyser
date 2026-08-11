"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const better_auth_1 = require("better-auth");
const prisma_1 = require("better-auth/adapters/prisma");
const plugins_1 = require("better-auth/plugins");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
exports.auth = (0, better_auth_1.betterAuth)({
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET ||
        'api-analyser-dev-secret-change-in-production-min-32-chars!!',
    trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:3000'],
    database: (0, prisma_1.prismaAdapter)(prisma, {
        provider: 'postgresql',
    }),
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
    },
    plugins: [(0, plugins_1.bearer)()],
    user: {
        fields: { image: 'avatar' },
        additionalFields: {
            role: { type: 'string', defaultValue: 'ADMIN', input: false },
            isActive: { type: 'boolean', defaultValue: true, input: false },
            ownerId: { type: 'string', required: false, input: false },
        },
    },
    databaseHooks: {
        user: {
            create: {
                before: async (user) => ({
                    data: { ...user, role: 'ADMIN', isActive: true, emailVerified: true },
                }),
            },
        },
        session: {
            create: {
                after: async (session) => {
                    try {
                        await prisma.user.update({
                            where: { id: session.userId },
                            data: { lastLogin: new Date() },
                        });
                    }
                    catch {
                    }
                },
            },
        },
    },
});
//# sourceMappingURL=auth.js.map