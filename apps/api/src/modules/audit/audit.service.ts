import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, LogCategory, LogSeverity, LogStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LogStreamService } from './log-stream.service';
import { sanitizeLogEvent } from './log-sanitizer';
import { isAlwaysCollected, type LogEventInput } from './log-event.types';

/** The legacy call shape, kept so existing callers compile unchanged. */
interface LegacyLogParams {
  userId?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
}

export interface LogQuery {
  search?: string;
  severities?: LogSeverity[];
  categories?: LogCategory[];
  statuses?: LogStatus[];
  userId?: string;
  event?: string;
  resource?: string;
  requestId?: string;
  assessmentId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'severity' | 'category' | 'event';
  sortDir?: 'asc' | 'desc';
}

const MAX_PAGE_SIZE = 200;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private stream: LogStreamService,
  ) {}

  // ── Writing ────────────────────────────────────────────────────────────────

  /**
   * Records an event.
   *
   * Fire-and-forget by design: logging must never fail or delay the operation
   * being logged. The returned promise is exposed for tests and for the few
   * callers that genuinely need the row (the purge audit, which must be written
   * before the rows it describes are deleted).
   */
  record(input: LogEventInput): Promise<void> {
    return this.write(input).catch((err) => {
      this.logger.error(`Failed to record event "${input.event}": ${err.message}`);
    });
  }

  /**
   * The pre-existing CRUD-shaped entry point.
   *
   * Every current caller uses this. Rather than rewrite ~30 call sites at the
   * same time as changing the storage shape, it maps onto `record` and derives
   * the new classification from what the old call already carried. Callers that
   * want severity, correlation ids or a message use `record` directly.
   */
  log(params: LegacyLogParams): void {
    void this.record({
      event: `${params.resource}.${params.action.toLowerCase()}`,
      category: categoryForResource(params.resource),
      severity: params.success === false ? 'WARNING' : 'INFO',
      status: params.success === false ? 'FAILED' : 'SUCCESS',
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      metadata: params.metadata,
      userId: params.userId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      source: 'api',
    });
  }

  private async write(input: LogEventInput): Promise<void> {
    const severity = input.severity ?? 'INFO';
    const category = input.category;

    // The collection switch is a volume control for routine events. Security,
    // authentication, configuration and anything at ERROR or above is always
    // written — see ALWAYS_COLLECTED_CATEGORIES for why.
    if (!isAlwaysCollected(category, severity)) {
      const collecting = await this.settings.getBoolean('logs.collectionEnabled');
      if (!collecting) return;
    }

    const safe = sanitizeLogEvent(input);

    const created = await this.prisma.auditLog.create({
      data: {
        event: safe.event,
        severity,
        category,
        status: safe.status ?? 'SUCCESS',
        action: safe.action ?? null,
        resource: safe.resource ?? safe.event.split('.')[0],
        resourceId: safe.resourceId ?? null,
        message: safe.message ?? null,
        userId: safe.userId ?? null,
        ipAddress: safe.ipAddress ?? null,
        userAgent: safe.userAgent ?? null,
        source: safe.source ?? null,
        httpMethod: safe.httpMethod ?? null,
        route: safe.route ?? null,
        statusCode: safe.statusCode ?? null,
        requestId: safe.requestId ?? null,
        durationMs: safe.durationMs ?? null,
        projectId: safe.projectId ?? null,
        assessmentId: safe.assessmentId ?? null,
        reportId: safe.reportId ?? null,
        metadata: (safe.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        errorCode: safe.errorCode ?? null,
        stackTrace: safe.stackTrace ?? null,
        // Kept in step with `status` so the pre-existing column stays truthful
        // for anything still reading it.
        success: (safe.status ?? 'SUCCESS') !== 'FAILED',
      },
      select: {
        id: true,
        createdAt: true,
        event: true,
        severity: true,
        category: true,
        status: true,
        message: true,
        resource: true,
        source: true,
        userId: true,
        requestId: true,
        user: { select: { name: true } },
      },
    });

    // Live tail. Guarded by the same switch the UI exposes, and never allowed to
    // throw back into the write path.
    if (await this.settings.getBoolean('logs.liveStreamEnabled')) {
      this.stream.publish({
        id: created.id,
        createdAt: created.createdAt,
        event: created.event,
        severity: created.severity,
        category: created.category,
        status: created.status,
        message: created.message,
        resource: created.resource,
        source: created.source,
        userId: created.userId,
        userName: created.user?.name ?? null,
        requestId: created.requestId,
      });
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /**
   * Server-side filtered, sorted and paginated log query.
   *
   * Every predicate is pushed into SQL. The table can hold hundreds of
   * thousands of rows, so no path here may load more than one page into memory
   * — the page size is clamped to MAX_PAGE_SIZE for that reason, including when
   * a client asks for more.
   */
  async findAll(query: LogQuery = {}) {
    const where = this.buildWhere(query);
    const take = Math.min(Math.max(query.limit ?? 50, 1), MAX_PAGE_SIZE);
    const skip = Math.max(query.offset ?? 0, 0);

    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';
    // Secondary key on createdAt so pages are stable when the primary key ties,
    // which it does constantly for severity and category.
    const orderBy: Prisma.AuditLogOrderByWithRelationInput[] =
      sortBy === 'createdAt'
        ? [{ createdAt: sortDir }]
        : [{ [sortBy]: sortDir } as any, { createdAt: 'desc' }];

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy,
        take,
        skip,
        // The list view never renders metadata or a stack trace; both can be
        // kilobytes. They are fetched only by findOne, when a row is opened.
        select: {
          id: true,
          createdAt: true,
          event: true,
          severity: true,
          category: true,
          status: true,
          action: true,
          resource: true,
          resourceId: true,
          message: true,
          ipAddress: true,
          source: true,
          httpMethod: true,
          route: true,
          statusCode: true,
          requestId: true,
          durationMs: true,
          projectId: true,
          assessmentId: true,
          reportId: true,
          errorCode: true,
          userId: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return { total, items, limit: take, offset: skip };
  }

  /** One event with its full payload. */
  async findOne(id: string) {
    return this.prisma.auditLog.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  }

  /** Distinct event names present in the table, for the event filter. */
  async distinctEvents(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['event'],
      select: { event: true },
      orderBy: { event: 'asc' },
      take: 300,
    });
    return rows.map((row) => row.event);
  }

  /**
   * Table statistics for the Log Management screen.
   *
   * The size figure comes from `pg_total_relation_size`, which is the real
   * on-disk size including indexes and TOAST — not a row count multiplied by a
   * guessed average width. If the query fails (a permission or a non-Postgres
   * backend) the field is null and the UI says "unavailable" rather than
   * showing an invented number.
   */
  async stats() {
    const [total, oldest, newest, bySeverity, byCategory] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.auditLog.groupBy({ by: ['severity'], _count: { _all: true } }),
      this.prisma.auditLog.groupBy({ by: ['category'], _count: { _all: true } }),
    ]);

    let storageBytes: number | null = null;
    try {
      const rows = await this.prisma.$queryRaw<{ size: bigint }[]>`
        SELECT pg_total_relation_size('audit_logs') AS size
      `;
      storageBytes = rows[0]?.size !== undefined ? Number(rows[0].size) : null;
    } catch (err) {
      this.logger.warn(`Could not read audit_logs size: ${(err as Error).message}`);
    }

    const [retentionDays, maxRecords, cleanupIntervalHours, retentionEnabled, collectionEnabled, liveStreamEnabled] =
      await Promise.all([
        this.settings.getNumber('logs.retentionDays'),
        this.settings.getNumber('logs.maxRecords'),
        this.settings.getNumber('logs.cleanupIntervalHours'),
        this.settings.getBoolean('logs.retentionEnabled'),
        this.settings.getBoolean('logs.collectionEnabled'),
        this.settings.getBoolean('logs.liveStreamEnabled'),
      ]);

    return {
      total,
      oldestAt: oldest?.createdAt ?? null,
      newestAt: newest?.createdAt ?? null,
      storageBytes,
      liveSubscribers: this.stream.subscriberCount,
      bySeverity: Object.fromEntries(bySeverity.map((row) => [row.severity, row._count._all])),
      byCategory: Object.fromEntries(byCategory.map((row) => [row.category, row._count._all])),
      policy: {
        retentionEnabled,
        retentionDays,
        maxRecords,
        cleanupIntervalHours,
        collectionEnabled,
        liveStreamEnabled,
      },
    };
  }

  // ── Deleting ───────────────────────────────────────────────────────────────

  /**
   * Deletes rows older than `before`, in batches.
   *
   * A single `DELETE ... WHERE createdAt < $1` over a large table takes a long
   * row-level lock and bloats the WAL, which on a busy instance is felt as the
   * API stalling. Batching keeps each statement short and lets other work
   * interleave. `maxBatches` bounds the total work of one invocation so a
   * scheduled run can never turn into an unbounded job.
   */
  async deleteOlderThan(
    before: Date,
    options: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<number> {
    const batchSize = options.batchSize ?? 5_000;
    const maxBatches = options.maxBatches ?? 200;
    let deleted = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await this.prisma.auditLog.findMany({
        where: { createdAt: { lt: before } },
        select: { id: true },
        take: batchSize,
        orderBy: { createdAt: 'asc' },
      });
      if (!rows.length) break;

      const result = await this.prisma.auditLog.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      deleted += result.count;
      if (rows.length < batchSize) break;
    }

    return deleted;
  }

  /**
   * Trims the table down to `maxRecords`, oldest first.
   *
   * Uses a cutoff timestamp rather than a list of ids: finding the createdAt of
   * the Nth-newest row is one indexed query, after which the delete reuses the
   * batched age path above.
   */
  async enforceMaxRecords(maxRecords: number, batchSize = 5_000): Promise<number> {
    const total = await this.prisma.auditLog.count();
    const excess = total - maxRecords;
    if (excess <= 0) return 0;

    // The newest row that must go: skip past everything we intend to keep.
    const boundary = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: maxRecords,
      take: 1,
      select: { createdAt: true },
    });
    if (!boundary.length) return 0;

    // `lte` on the boundary can remove a few extra rows sharing that exact
    // timestamp. Overshooting the ceiling slightly is correct; undershooting
    // would leave the table permanently over its limit.
    const cutoff = new Date(boundary[0].createdAt.getTime() + 1);
    return this.deleteOlderThan(cutoff, {
      batchSize,
      maxBatches: Math.ceil(excess / batchSize) + 2,
    });
  }

  /** Unconditional delete of every row. Only reachable from the purge endpoint. */
  async deleteAll(batchSize = 5_000): Promise<number> {
    return this.deleteOlderThan(new Date(Date.now() + 60_000), {
      batchSize,
      maxBatches: 10_000,
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private buildWhere(query: LogQuery): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (query.severities?.length) where.severity = { in: query.severities };
    if (query.categories?.length) where.category = { in: query.categories };
    if (query.statuses?.length) where.status = { in: query.statuses };
    if (query.userId) where.userId = query.userId;
    if (query.event) where.event = query.event;
    if (query.resource) where.resource = query.resource;
    if (query.requestId) where.requestId = query.requestId;
    if (query.assessmentId) where.assessmentId = query.assessmentId;

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    /*
     * Global search across the fields an investigator actually types into it.
     *
     * `contains` is a sequential scan on a large table, which is why it is only
     * applied when a term is present and always alongside the date range the UI
     * defaults to — the range uses the createdAt index and bounds how much the
     * scan has to look at. A trigram index would make this cheap unconditionally
     * and is the natural next step if search becomes a hot path.
     */
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { message: { contains: term, mode: 'insensitive' } },
        { event: { contains: term, mode: 'insensitive' } },
        { resource: { contains: term, mode: 'insensitive' } },
        { resourceId: { contains: term, mode: 'insensitive' } },
        { ipAddress: { contains: term, mode: 'insensitive' } },
        { route: { contains: term, mode: 'insensitive' } },
        { requestId: { contains: term, mode: 'insensitive' } },
        { assessmentId: { contains: term, mode: 'insensitive' } },
        { errorCode: { contains: term, mode: 'insensitive' } },
        { source: { contains: term, mode: 'insensitive' } },
        { user: { name: { contains: term, mode: 'insensitive' } } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }

    return where;
  }
}

/** Best-effort classification for the legacy `log()` path. */
function categoryForResource(resource: string): LogCategory {
  switch (resource) {
    case 'auth':
    case 'session':
      return 'AUTHENTICATION';
    case 'user':
      return 'USERS';
    case 'project':
      return 'PROJECTS';
    case 'assessment':
      return 'SCANS';
    case 'issue':
    case 'finding':
      return 'FINDINGS';
    case 'report':
      return 'REPORTS';
    case 'plugin':
    case 'settings':
      return 'CONFIGURATION';
    default:
      return 'SYSTEM';
  }
}
