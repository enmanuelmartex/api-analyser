import { describe, expect, it } from 'bun:test';
import type { LogCategory, LogSeverity } from '@prisma/client';
import { isAlwaysCollected } from './log-event.types';

/**
 * The guarantee behind the "Log collection" switch.
 *
 * Turning collection off is a volume control for routine noise. If an
 * administrator could also silence their own failed sign-ins, privilege changes
 * and configuration edits, the audit trail would be worthless in exactly the
 * situation it exists for. These tests pin that down.
 */
describe('isAlwaysCollected', () => {
  it.each<LogCategory>(['AUTHENTICATION', 'SECURITY', 'CONFIGURATION'])(
    'always records %s events, whatever their severity',
    (category) => {
      expect(isAlwaysCollected(category, 'DEBUG')).toBe(true);
      expect(isAlwaysCollected(category, 'INFO')).toBe(true);
    },
  );

  it.each<LogSeverity>(['ERROR', 'CRITICAL'])(
    'always records %s events, whatever their category',
    (severity) => {
      expect(isAlwaysCollected('API', severity)).toBe(true);
      expect(isAlwaysCollected('WORKER', severity)).toBe(true);
      expect(isAlwaysCollected('SCANS', severity)).toBe(true);
    },
  );

  it.each<[LogCategory, LogSeverity]>([
    ['API', 'DEBUG'],
    ['API', 'INFO'],
    ['SCANS', 'INFO'],
    ['WORKER', 'WARNING'],
    ['REPORTS', 'INFO'],
    ['PROJECTS', 'INFO'],
  ])('lets the switch suppress routine %s/%s events', (category, severity) => {
    expect(isAlwaysCollected(category, severity)).toBe(false);
  });
});
