import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { NotificationCategory, NotificationType, LogSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsRetentionPort } from '../audit/notifications-retention.port';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { SECTION_CATEGORIES, definitionFor, type NotificationSection } from './notification-catalog';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  /** Defaults to the catalog's category for the type. Rarely worth overriding. */
  category?: NotificationCategory;
  /** Defaults to the catalog's severity for the type. */
  severity?: LogSeverity;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  href?: string;
}

/** Unread counts shaped for the sidebar and the bell, in one round trip. */
export interface NotificationSummary {
  totalUnread: number;
  byCategory: Record<string, number>;
  scans: number;
  issues: number;
  reports: number;
}

const MAX_PAGE_SIZE = 100;

@Injectable()
export class NotificationsService implements NotificationsRetentionPort {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private preferences: NotificationPreferencesService,
    private stream: NotificationStreamService,
  ) {}

  // ── Creating ───────────────────────────────────────────────────────────────

  /**
   * Creates a notification if the recipient wants it.
   *
   * Two gates, checked in this order:
   *   1. `notifications.enabled` — the operator's master switch.
   *   2. the recipient's own preference for this notification type.
   *
   * Returns null when either gate rejects it, so a caller can tell "suppressed"
   * from "delivered" without inspecting the preferences itself.
   */
  async create(input: CreateNotificationInput) {
    if (!(await this.settings.getBoolean('notifications.enabled'))) return null;
    if (!(await this.preferences.wants(input.userId, input.type))) return null;

    // Category and severity come from the catalog unless the caller overrides
    // them, so a listener states what happened and not how it should be filed.
    const definition = definitionFor(input.type);

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        category: input.category ?? definition.category,
        severity: input.severity ?? definition.severity,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        href: input.href ?? null,
      },
    });

    // Push to any live subscriber for this user. Failure here is not the
    // caller's problem: the row is written and the next poll or page load shows
    // it regardless.
    this.stream.publish(input.userId, notification);

    return notification;
  }

  /**
   * Fans one event out to every administrator.
   *
   * Used for system-wide notifications (a worker crash, a security warning)
   * that belong to whoever runs the platform rather than to the user who
   * happened to trigger them. Each recipient still passes their own preference
   * check inside `create`.
   */
  async createForAdmins(input: Omit<CreateNotificationInput, 'userId'>) {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });

    const created = await Promise.all(
      admins.map((admin) =>
        this.create({ ...input, userId: admin.id }).catch((err) => {
          this.logger.warn(`Could not notify admin ${admin.id}: ${err.message}`);
          return null;
        }),
      ),
    );

    return created.filter(Boolean).length;
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  ) {
    const take = Math.min(Math.max(options.limit ?? 20, 1), MAX_PAGE_SIZE);
    const skip = Math.max(options.offset ?? 0, 0);
    const where = { userId, ...(options.unreadOnly ? { read: false } : {}) };

    const [total, unread, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, read: false } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    return { total, unread, items, limit: take, offset: skip };
  }

  /**
   * Unread counts grouped by category.
   *
   * A single grouped query rather than one count per category: the shape is
   * meant for a badge that renders on every page, so it must stay one round
   * trip as categories are added.
   */
  async unreadCounts(userId: string) {
    const rows = await this.prisma.notification.groupBy({
      by: ['category'],
      where: { userId, read: false },
      _count: { _all: true },
    });

    const byCategory = Object.fromEntries(rows.map((row) => [row.category, row._count._all]));
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);

    return { total, byCategory };
  }

  /**
   * Everything the navigation needs, in one query.
   *
   * The sidebar badges, the bell's total and the notification centre all read
   * this. Giving each of them its own endpoint is how the three end up
   * disagreeing — bell 5, sidebar 3, list 8 — because they were fetched at
   * different moments and cached separately.
   *
   * `totalUnread` counts every category, including the ones with no sidebar
   * entry: a security warning has no badge of its own but must still raise the
   * bell, otherwise it is invisible until someone opens the list.
   */
  async summary(userId: string): Promise<NotificationSummary> {
    const { total, byCategory } = await this.unreadCounts(userId);

    const sections = Object.fromEntries(
      Object.entries(SECTION_CATEGORIES).map(([section, categories]) => [
        section,
        categories.reduce((sum, category) => sum + (byCategory[category] ?? 0), 0),
      ]),
    ) as Record<NotificationSection, number>;

    return { totalUnread: total, byCategory, ...sections };
  }

  /**
   * Marks every unread notification in one section as read.
   *
   * This is what clears a sidebar badge when the user actually visits the
   * section, and it is deliberately a separate operation from `markAllRead`:
   * opening Reports must not silently clear the unread scans the user has not
   * looked at yet.
   *
   * Nothing is deleted — `read` flips and `readAt` is stamped, so the history
   * stays complete and the notification centre can still show it.
   */
  async markSectionRead(userId: string, section: NotificationSection) {
    const categories = SECTION_CATEGORIES[section];

    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false, category: { in: categories } },
      data: { read: true, readAt: new Date() },
    });

    return { updated: result.count };
  }

  // ── Updating ───────────────────────────────────────────────────────────────

  async markRead(id: string, userId: string) {
    // Scoped by userId in the same statement as the id: a bare `update({ id })`
    // would let any authenticated user mark another user's notification read.
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true, readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  async remove(id: string, userId: string) {
    const result = await this.prisma.notification.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async removeAllRead(userId: string) {
    const result = await this.prisma.notification.deleteMany({ where: { userId, read: true } });
    return { deleted: result.count };
  }

  // ── Retention (NotificationsRetentionPort) ─────────────────────────────────

  /**
   * Removes read notifications older than `before`.
   *
   * Unread rows are kept whatever their age. An unread notification is still
   * pending work for its recipient, and deleting it means they never learn that
   * their scan failed.
   */
  async deleteReadOlderThan(before: Date): Promise<number> {
    const result = await this.prisma.notification.deleteMany({
      where: { read: true, createdAt: { lt: before } },
    });
    return result.count;
  }
}
