import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { verifyPassword } from 'better-auth/crypto';
import { bearer } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { getAllowedOrigins } from '../config/cors.util';

// Separate PrismaClient for Better Auth (lazy connection, same DB as NestJS)
const prisma = new PrismaClient();

/** `$2a$`, `$2b$` and `$2y$` are the bcrypt hash prefixes; scrypt hashes carry none. */
const BCRYPT_PREFIX = /^\$2[aby]?\$/;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
  basePath: '/api/auth',
  secret:
    process.env.BETTER_AUTH_SECRET ||
    'api-analyser-dev-secret-change-in-production-min-32-chars!!',

  // Same allowlist as the rest of the API (see cors.util.ts) — one variable,
  // one list, rather than a second independent single-origin default that
  // could silently drift from the NestJS CORS configuration.
  trustedOrigins: getAllowedOrigins(),

  database: prismaAdapter(prisma as any, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,

    password: {
      /*
       * Accepts a bcrypt hash as well as Better Auth's own scrypt.
       *
       * The bcrypt hash in `users.password` is the only copy of the password for
       * accounts created before every write went through
       * `better-auth-credentials.ts`, and a hash cannot be turned back into the
       * password it came from. So the repair on boot adopts that hash as the
       * credential account verbatim (see `admin-bootstrap.service.ts`), and this
       * is what lets the login form check it. New and changed passwords are
       * always written as scrypt by `hash` below, which is left untouched.
       */
      verify: ({ hash, password }: { hash: string; password: string }) =>
        BCRYPT_PREFIX.test(hash)
          ? bcrypt.compare(password, hash)
          : verifyPassword({ hash, password }),
    },
  },

  /*
   * No social providers, deliberately.
   *
   * This is a self-hosted security scanner that an operator runs on their own
   * network, in the shape of Wazuh or Grafana: the first boot creates an admin
   * account, that admin creates the rest. An OAuth button would make the
   * install depend on a third party reaching the browser and on the operator
   * registering an application with Google before they can log in to software
   * running on their own laptop — for an audience that is, by construction,
   * running this somewhere that may not reach the internet at all.
   */

  // Bearer plugin: session token is returned in the response body and sent via
  // Authorization header instead of cookies — required for cross-origin SPA usage.
  plugins: [bearer()],

  user: {
    // Map Better Auth's generic 'image' field to our 'avatar' column
    fields: { image: 'avatar' },
    additionalFields: {
      role:     { type: 'string'  as const, defaultValue: 'ADMIN', input: false },
      isActive: { type: 'boolean' as const, defaultValue: true,    input: false },
      ownerId:  { type: 'string'  as const, required: false,       input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        // Every self-registered user is always an ADMIN (owner of their own space).
        // Analysts and viewers are created by an administrator from
        // Settings → Users, never by self-registration.
        before: async (user: any) => ({
          data: { ...user, role: 'ADMIN', isActive: true, emailVerified: true },
        }),
      },
    },
    session: {
      create: {
        after: async (session: any) => {
          try {
            await prisma.user.update({
              where: { id: session.userId },
              data: { lastLogin: new Date() },
            });
          } catch {
            // Non-critical — ignore errors updating lastLogin
          }
        },
      },
    },
  },
});
