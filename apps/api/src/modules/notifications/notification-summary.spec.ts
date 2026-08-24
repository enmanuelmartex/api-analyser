import { describe, expect, it } from 'bun:test';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { SECTION_CATEGORIES } from './notification-catalog';

/**
 * The counts behind the sidebar badges and the bell, and the grouping rule that
 * keeps a 120-finding scan from producing 120 notifications.
 */

function makeService(rows: { category: string; _count: { _all: number } }[]) {
  const updateManyCalls: any[] = [];

  const prisma = {
    notification: {
      groupBy: async () => rows,
      updateMany: async (args: any) => {
        updateManyCalls.push(args);
        return { count: 3 };
      },
    },
  };

  const service = new NotificationsService(
    prisma as any,
    { getBoolean: async () => true } as any,
    { wants: async () => true } as any,
    { publish: () => {} } as any,
  );

  return { service, updateManyCalls };
}

describe('summary', () => {
  it('folds categories into the three badged sections and a grand total', async () => {
    const { service } = makeService([
      { category: 'SCANS', _count: { _all: 2 } },
      { category: 'ISSUES', _count: { _all: 5 } },
      { category: 'REPORTS', _count: { _all: 2 } },
    ]);

    const summary = await service.summary('user-1');

    expect(summary).toEqual({
      totalUnread: 9,
      byCategory: { SCANS: 2, ISSUES: 5, REPORTS: 2 },
      scans: 2,
      issues: 5,
      reports: 2,
    });
  });

  /**
   * A security warning has no sidebar entry, but it must still raise the bell.
   *
   * Rebuilding the total from the three visible sections would discard it, and
   * the notification would be invisible until somebody opened the list.
   */
  it('counts categories with no sidebar badge in the total', async () => {
    const { service } = makeService([
      { category: 'SCANS', _count: { _all: 1 } },
      { category: 'SECURITY', _count: { _all: 4 } },
      { category: 'SYSTEM', _count: { _all: 2 } },
    ]);

    const summary = await service.summary('user-1');

    expect(summary.totalUnread).toBe(7);
    expect(summary.scans).toBe(1);
    // Not badged anywhere in the sidebar, but present in the bell's total.
    expect(summary.issues).toBe(0);
    expect(summary.reports).toBe(0);
  });

  it('reports zeroes for a user with nothing unread', async () => {
    const { service } = makeService([]);

    const summary = await service.summary('user-1');

    expect(summary.totalUnread).toBe(0);
    expect(summary.scans).toBe(0);
  });
});

describe('markSectionRead', () => {
  it('marks read rather than deleting, so the history survives', async () => {
    const { service, updateManyCalls } = makeService([]);

    await service.markSectionRead('user-1', 'reports');

    expect(updateManyCalls[0].data.read).toBe(true);
    expect(updateManyCalls[0].data.readAt).toBeInstanceOf(Date);
  });

  it('touches only the section asked for, and only that user', async () => {
    const { service, updateManyCalls } = makeService([]);

    await service.markSectionRead('user-1', 'issues');

    expect(updateManyCalls[0].where).toEqual({
      userId: 'user-1',
      read: false,
      category: { in: SECTION_CATEGORIES.issues },
    });
    // Opening Issues must not clear the unread scans the user has not seen.
    expect(updateManyCalls[0].where.category.in).not.toContain('SCANS');
  });
});

// ── Grouping ────────────────────────────────────────────────────────────────

function makeListener() {
  const created: any[] = [];
  const notifications = {
    create: async (input: any) => {
      created.push(input);
      return { id: `n${created.length}` };
    },
    createForAdmins: async () => 0,
  };

  return { listener: new NotificationsListener(notifications as any), created };
}

const SCAN_EVENT = {
  assessmentId: 'scan_123',
  projectId: 'proj_1',
  projectName: 'Production API',
  userId: 'user_1',
  findingsCount: 12,
  criticalCount: 2,
  highCount: 3,
  mediumCount: 4,
  lowCount: 3,
  infoCount: 0,
  securityScore: 74,
};

describe('grouped findings notification', () => {
  /**
   * The anti-spam rule.
   *
   * Twelve findings must produce one notification carrying the breakdown, not
   * twelve notifications. A notification centre that a single scan can fill is
   * one nobody reads.
   */
  it('raises one notification for all of a scan‘s findings', async () => {
    const { listener, created } = makeListener();

    await listener.onScanCompleted(SCAN_EVENT as any);

    const findings = created.filter((n) => n.type === 'NEW_FINDINGS');
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('12 new issues detected');
    expect(findings[0].message).toBe('Production API — 2 Critical, 3 High, 4 Medium, 3 Low');
    // Links to Issues filtered by the scan that produced them.
    expect(findings[0].href).toBe('/issues?assessmentId=scan_123');
  });

  it('omits severities with no findings rather than printing zeroes', async () => {
    const { listener, created } = makeListener();

    await listener.onScanCompleted({
      ...SCAN_EVENT,
      findingsCount: 1,
      criticalCount: 0,
      highCount: 1,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
    } as any);

    const findings = created.find((n) => n.type === 'NEW_FINDINGS');
    expect(findings.title).toBe('1 new issue detected');
    expect(findings.message).toBe('Production API — 1 High');
  });

  it('raises no findings notification for a clean scan', async () => {
    const { listener, created } = makeListener();

    await listener.onScanCompleted({
      ...SCAN_EVENT,
      findingsCount: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
    } as any);

    expect(created.filter((n) => n.type === 'NEW_FINDINGS')).toHaveLength(0);
    expect(created.filter((n) => n.type === 'CRITICAL_FINDING')).toHaveLength(0);
    // The completion itself is still announced.
    expect(created.filter((n) => n.type === 'SCAN_COMPLETED')).toHaveLength(1);
  });

  it('adds a separate critical notification when the scan found criticals', async () => {
    const { listener, created } = makeListener();

    await listener.onScanCompleted(SCAN_EVENT as any);

    const critical = created.filter((n) => n.type === 'CRITICAL_FINDING');
    expect(critical).toHaveLength(1);
    expect(critical[0].href).toBe('/issues?assessmentId=scan_123&severity=CRITICAL');
  });

  it('uses the scheduled type when a schedule started the scan', async () => {
    const { listener, created } = makeListener();

    await listener.onScanCompleted({
      ...SCAN_EVENT,
      trigger: 'SCHEDULED',
      scheduleName: 'Nightly Production Scan',
    } as any);

    const completion = created.find((n) => n.type === 'SCHEDULED_SCAN_COMPLETED');
    expect(completion).toBeDefined();
    expect(completion.title).toBe('Nightly Production Scan completed successfully');
    // The same pipeline still produces the grouped findings notification, so a
    // scheduled run is not a second implementation.
    expect(created.filter((n) => n.type === 'NEW_FINDINGS')).toHaveLength(1);
  });

  it('says nothing when the event carries no recipient', async () => {
    const { listener, created } = makeListener();

    await listener.onScanCompleted({ ...SCAN_EVENT, userId: undefined } as any);

    expect(created).toHaveLength(0);
  });
});

describe('report notifications', () => {
  it('announces a ready report with a link to it', async () => {
    const { listener, created } = makeListener();

    await listener.onReportGenerated({
      reportId: 'report_456',
      assessmentId: 'scan_123',
      projectName: 'Production API',
      userId: 'user_1',
      reportType: 'TECHNICAL',
      format: 'PDF',
      kind: 'AUTOMATIC_SCAN_REPORT',
    } as any);

    expect(created[0].type).toBe('REPORT_GENERATED');
    expect(created[0].message).toBe('Security report for "Production API" is ready.');
    expect(created[0].href).toBe('/reports/report_456');
  });

  it('tells the user when a report could not be generated', async () => {
    const { listener, created } = makeListener();

    await listener.onReportFailed({
      reportId: 'report_456',
      assessmentId: 'scan_123',
      projectName: 'Production API',
      userId: 'user_1',
      reportType: 'TECHNICAL',
      format: 'PDF',
      reason: 'Chromium timed out',
      attempts: 3,
    } as any);

    expect(created[0].type).toBe('REPORT_FAILED');
    expect(created[0].message).toContain('after 3 attempts');
  });
});
