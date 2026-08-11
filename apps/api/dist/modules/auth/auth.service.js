"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcryptjs");
const prisma_service_1 = require("../../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let AuthService = AuthService_1 = class AuthService {
    constructor(prisma, jwtService, configService, audit) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.configService = configService;
        this.audit = audit;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    async register(dto) {
        const email = dto.email.toLowerCase().trim();
        const existing = await this.prisma.user.findUnique({
            where: { email },
        });
        if (existing) {
            throw new common_1.ConflictException('Email already registered');
        }
        const role = 'ADMIN';
        const rounds = this.configService.get('security.bcryptRounds', 12);
        const passwordHash = await bcrypt.hash(dto.password, rounds);
        const user = await this.prisma.user.create({
            data: {
                email,
                name: dto.name,
                password: passwordHash,
                role,
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
            },
        });
        this.logger.log(`New user registered: ${user.email}`);
        this.audit.log({
            userId: user.id,
            action: 'CREATE',
            resource: 'user',
            resourceId: user.id,
            metadata: { email: user.email, source: 'self-register' },
        });
        const tokens = await this.generateTokens(user.id, user.email, user.role);
        return { user, ...tokens };
    }
    async login(dto) {
        const user = await this.prisma.user.findFirst({
            where: { email: { equals: dto.email.trim(), mode: 'insensitive' } },
        });
        if (!user || !user.isActive) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        if (!user.password) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        const passwordMatch = await bcrypt.compare(dto.password, user.password);
        if (!passwordMatch) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });
        this.logger.log(`User logged in: ${user.email}`);
        this.audit.log({
            userId: user.id,
            action: 'LOGIN',
            resource: 'auth',
            resourceId: user.id,
        });
        const tokens = await this.generateTokens(user.id, user.email, user.role);
        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            ...tokens,
        };
    }
    async me(userId) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                avatar: true,
                lastLogin: true,
                createdAt: true,
            },
        });
    }
    async updateProfile(userId, data) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { name: data.name },
        });
        return this.me(userId);
    }
    async exchangeSession(sessionToken) {
        const session = await this.prisma.session.findFirst({
            where: { token: sessionToken, expiresAt: { gt: new Date() } },
            include: { user: true },
        });
        if (!session)
            throw new common_1.UnauthorizedException('Invalid or expired session');
        const user = session.user;
        if (!user.isActive)
            throw new common_1.UnauthorizedException('Account is inactive');
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        }).catch(() => { });
        const tokens = await this.generateTokens(user.id, user.email, user.role);
        return {
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
            ...tokens,
        };
    }
    async generateTokens(userId, email, role) {
        const payload = { sub: userId, email, role };
        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: this.configService.get('jwt.secret'),
                expiresIn: this.configService.get('jwt.expiresIn', '7d'),
            }),
            this.jwtService.signAsync(payload, {
                secret: this.configService.get('jwt.refreshSecret'),
                expiresIn: this.configService.get('jwt.refreshExpiresIn', '30d'),
            }),
        ]);
        return { accessToken, refreshToken };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService,
        audit_service_1.AuditService])
], AuthService);
//# sourceMappingURL=auth.service.js.map