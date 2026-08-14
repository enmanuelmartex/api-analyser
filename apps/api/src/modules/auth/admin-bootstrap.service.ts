import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { auth } from '../../lib/auth';
import {
  CREDENTIAL_PROVIDER_ID,
  adoptExistingHashAsCredential,
} from '../../lib/better-auth-credentials';

/**
 * Creates the first administrator so a fresh install has a way in.
 *
 * The product has no sign-up-from-nothing path any more and no email transport,
 * which leaves a new deployment with a login form and no credentials that work.
 * This closes that gap the way self-hosted security tools normally do — Wazuh,
 * Grafana, Sonatype all ship a known default admin and tell you to change it.
 *
 * Two things make this safe enough to run unconditionally on every boot:
 *
 *  1. **It only fires on an empty user table.** Not "if the admin is missing" —
 *     if *any* user exists, this does nothing. An operator who deletes the
 *     default admin after creating their own account does not get it back on
 *     the next restart, and an operator who changes its password does not get
 *     it reset.
 *  2. **It is loud.** When the password is still the default, every boot logs a
 *     warning naming it. A default credential nobody is reminded of is the
 *     vulnerability this product exists to find.
 *
 * The account is written twice on purpose, because the product has two auth
 * surfaces (see `apps/api/src/lib/auth.ts` and `auth.service.ts`):
 *
 *  - **Better Auth** owns the web login. It stores a scrypt hash in `accounts`,
 *    and it is the only thing that can write one correctly — hence the call
 *    through `auth.api.signUpEmail` rather than an INSERT.
 *  - **The Nest JWT surface** (`POST /api/v1/auth/login`) reads `users.password`,
 *    a bcrypt hash Better Auth never populates.
 *
 * Writing only the first would leave `curl` unable to authenticate; writing only
 * the second reproduces the long-standing trap where the seeded accounts exist
 * but the login form rejects them.
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  /** Defaults an operator can predict, and override before first boot. */
  static readonly DEFAULT_EMAIL = 'admin@apianalyser.local';
  static readonly DEFAULT_PASSWORD = 'admin1234';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const email = (this.config.get<string>('ADMIN_EMAIL') ?? AdminBootstrapService.DEFAULT_EMAIL)
      .toLowerCase()
      .trim();
    const password =
      this.config.get<string>('ADMIN_PASSWORD') ?? AdminBootstrapService.DEFAULT_PASSWORD;

    try {
      const existing = await this.prisma.user.count();
      if (existing > 0) {
        this.warnIfDefaultPasswordStillInUse(email, password);
        await this.repairUsersWithNoCredentialAccount();
        return;
      }

      // Better Auth first: it creates the `users` row *and* the `accounts` row
      // with the scrypt hash the login form checks. `databaseHooks` in
      // `lib/auth.ts` stamps role ADMIN and emailVerified on the way through.
      await auth.api.signUpEmail({
        body: { name: 'Administrator', email, password },
      });

      // Then the bcrypt hash for the REST surface, which Better Auth leaves null.
      const rounds = this.config.get<number>('security.bcryptRounds', 12);
      await this.prisma.user.update({
        where: { email },
        data: { password: await bcrypt.hash(password, rounds), role: 'ADMIN', isActive: true },
      });

      this.logger.warn(
        `Created the default administrator: ${email} / ${password} — change this password before exposing the instance.`,
      );
    } catch (error) {
      // A failed bootstrap must not stop the API from starting: the operator can
      // still create an account another way, and a crash loop here would take
      // down an install whose only problem is that it already has users.
      this.logger.error(
        `Could not create the default administrator: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Gives a credential account to users who have a password but no way to use it.
   *
   * The Users panel and `POST /auth/register` used to create accounts with a
   * bare `prisma.user.create`, which writes the bcrypt hash in `users.password`
   * and no `accounts` row — so Better Auth had nothing to check and the login
   * form rejected a perfectly real account as a bad password. Those writes now
   * go through `setBetterAuthPassword`, but the accounts created before that do
   * not fix themselves: a bcrypt hash cannot be turned back into the password it
   * came from, so the only repair that preserves the password its owner already
   * has is to adopt the existing hash as the credential and let
   * `password.verify` in `lib/auth.ts` check it through bcrypt.
   *
   * Idempotent, and narrow enough to run on every boot: users who already have a
   * credential account are excluded by the query, so a repaired or
   * normally-created account is never touched again.
   */
  private async repairUsersWithNoCredentialAccount() {
    const stranded = await this.prisma.user.findMany({
      where: {
        password: { not: null },
        accounts: { none: { providerId: CREDENTIAL_PROVIDER_ID } },
      },
      select: { id: true, email: true, password: true },
    });

    if (stranded.length === 0) return;

    for (const user of stranded) {
      try {
        await adoptExistingHashAsCredential(user.id, user.password as string);
        this.logger.log(`Restored login for ${user.email} — it had no credential account.`);
      } catch (error) {
        this.logger.error(
          `Could not restore login for ${user.email}: ${(error as Error).message}`,
        );
      }
    }
  }

  private warnIfDefaultPasswordStillInUse(email: string, password: string) {
    if (password !== AdminBootstrapService.DEFAULT_PASSWORD) return;
    this.logger.warn(
      `The default administrator password is still in use (${email} / ${password}). ` +
        'Change it in Settings, or set ADMIN_PASSWORD before the first boot.',
    );
  }
}
