import { auth } from './auth';

/** Better Auth's provider id for an email + password login. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

/**
 * Writes the credential the login form actually checks.
 *
 * The product has two auth surfaces over one `users` table (see `auth.ts` and
 * `modules/auth/auth.service.ts`). Better Auth owns the login form and keeps its
 * password hash in `accounts`; the Nest JWT surface reads the bcrypt hash in
 * `users.password`. Better Auth never writes the second, and nothing but Better
 * Auth can write the first correctly — so any path that creates a user with a
 * plain `prisma.user.create` produces an account that looks complete in the
 * Users panel and is rejected by the login form with INVALID_EMAIL_OR_PASSWORD,
 * because sign-in finds no credential account for that user at all.
 *
 * Every path that sets a password must call this in addition to writing
 * `users.password`. The two-step is deliberate rather than a signUpEmail call:
 * `signUpEmail` also opens a session, which would stamp `lastLogin` on an
 * account whose owner has never logged in.
 *
 * Mirrors Better Auth's own reset-password route: update the credential account
 * when there is one, create it when there is not.
 */
export async function setBetterAuthPassword(userId: string, password: string): Promise<void> {
  const ctx = await auth.$context;
  await writeCredential(ctx, userId, await ctx.password.hash(password));
}

/**
 * Attaches an already-hashed password to a user as their credential account,
 * leaving an existing credential account untouched.
 *
 * Used to repair accounts created before `setBetterAuthPassword` existed, whose
 * bcrypt hash in `users.password` is the only copy of the password anywhere —
 * a plaintext-taking function cannot help them, since a bcrypt hash cannot be
 * turned back into the password it came from. Better Auth verifies the adopted
 * hash through the bcrypt branch of `password.verify` in `auth.ts`.
 */
export async function adoptExistingHashAsCredential(
  userId: string,
  passwordHash: string,
): Promise<void> {
  const ctx = await auth.$context;
  if (await findCredentialAccount(ctx, userId)) return;
  await writeCredential(ctx, userId, passwordHash);
}

async function writeCredential(ctx: any, userId: string, passwordHash: string): Promise<void> {
  if (await findCredentialAccount(ctx, userId)) {
    await ctx.internalAdapter.updatePassword(userId, passwordHash);
    return;
  }

  await ctx.internalAdapter.createAccount({
    userId,
    // Better Auth stores the user's own id as the accountId of a credential
    // login — there is no external provider to carry an id of its own.
    accountId: userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    password: passwordHash,
  });
}

async function findCredentialAccount(ctx: any, userId: string) {
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  return accounts.find((account: any) => account.providerId === CREDENTIAL_PROVIDER_ID);
}
