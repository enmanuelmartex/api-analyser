import { Injectable } from '@nestjs/common';
import type { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_KEYS,
  definitionFor,
  type PreferenceFlags,
} from './notification-catalog';

export { DEFAULT_PREFERENCES, type PreferenceFlags };

@Injectable()
export class NotificationPreferencesService {
  constructor(private prisma: PrismaService) {}

  /**
   * The user's effective preferences.
   *
   * Absence of a row means "never configured", which resolves to
   * DEFAULT_PREFERENCES. It deliberately does NOT create the row: reading a
   * setting should not write to the database, and a user who never changes
   * anything should not accumulate one.
   */
  async get(userId: string): Promise<PreferenceFlags> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (!row) return { ...DEFAULT_PREFERENCES };
    return this.project(row);
  }

  /** Applies a partial update, creating the row on first write. */
  async update(userId: string, patch: Partial<PreferenceFlags>): Promise<PreferenceFlags> {
    // Only known keys reach Prisma. The DTO validates too, but this service is
    // also called from other modules, and an unrecognised key would otherwise
    // surface as an opaque Prisma error rather than being ignored.
    const clean = this.pick(patch);

    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...DEFAULT_PREFERENCES,
        ...clean,
      } satisfies Prisma.NotificationPreferenceUncheckedCreateInput,
      update: clean,
    });

    return this.project(row);
  }

  /**
   * Whether this user wants `type` in the app.
   *
   * Total over the enum: the catalog has an entry for every type, so an unmapped
   * type cannot silently resolve to `undefined` and suppress the notification —
   * which is exactly what the previous partial map did.
   */
  async wants(userId: string, type: NotificationType): Promise<boolean> {
    const preferences = await this.get(userId);
    return preferences[definitionFor(type).preference];
  }

  /** Narrows an arbitrary patch to the keys the model actually has. */
  private pick(patch: Partial<PreferenceFlags>): Partial<PreferenceFlags> {
    const clean: Partial<PreferenceFlags> = {};
    for (const key of PREFERENCE_KEYS) {
      const value = patch[key];
      if (typeof value === 'boolean') clean[key] = value;
    }
    return clean;
  }

  /**
   * Row → flags.
   *
   * Driven by PREFERENCE_KEYS rather than written out field by field, so a new
   * preference is returned by the API as soon as it exists in the catalog and
   * the schema — the previous hand-written projection is why the email columns
   * were in the database but absent from every response.
   */
  private project(row: Record<string, unknown>): PreferenceFlags {
    const flags = { ...DEFAULT_PREFERENCES };
    for (const key of PREFERENCE_KEYS) {
      const value = row[key];
      if (typeof value === 'boolean') flags[key] = value;
    }
    return flags;
  }
}
