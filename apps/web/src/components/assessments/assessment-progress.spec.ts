import { describe, expect, it } from 'bun:test';
import { resolveStageIndex } from './assessment-progress';

/**
 * The mapping from what the scanner reports to the stage shown.
 *
 * The step names asserted here are the literal strings the worker emits —
 * `ScannerProcessor` emits Initializing / Parsing / Saving Results / Completed,
 * `ScannerService` emits `AI Analysis` and one step per plugin named after the
 * plugin. If a producer renames one of those, this is the test that fails
 * rather than the stepper silently sitting on "Running security checks".
 */

describe('resolveStageIndex', () => {
  it('maps the worker step names to their stage', () => {
    expect(resolveStageIndex('Initializing', 2)).toBe(0);
    expect(resolveStageIndex('Parsing', 8)).toBe(1);
    expect(resolveStageIndex('AI Analysis', 92)).toBe(3);
    expect(resolveStageIndex('Saving Results', 92)).toBe(4);
    expect(resolveStageIndex('Completed', 100)).toBe(5);
  });

  it('treats an unrecognised step as a check in flight', () => {
    // The scanner names each step after the plugin running at that moment.
    expect(resolveStageIndex('Mass Assignment', 40)).toBe(2);
    expect(resolveStageIndex('Security Headers', 55)).toBe(2);
  });

  it('falls back to the percentage when there is no step', () => {
    expect(resolveStageIndex(undefined, 0)).toBe(0);
    expect(resolveStageIndex(undefined, 8)).toBe(1);
    expect(resolveStageIndex(undefined, 45)).toBe(2);
    expect(resolveStageIndex(undefined, 90)).toBe(3);
    expect(resolveStageIndex(undefined, 92)).toBe(4);
    expect(resolveStageIndex(undefined, 100)).toBe(5);
  });

  it('recovers the failing stage from the percentage', () => {
    // A failed run has its step overwritten with the reason, so the percentage
    // is the only remaining signal for where it got to.
    expect(resolveStageIndex('Failed: Assessment has no resolved plugins', 2)).toBe(0);
    expect(resolveStageIndex('Failed: connect ETIMEDOUT', 45)).toBe(2);
  });

  it('does not read the word "analysis" in a failure message as a stage', () => {
    expect(resolveStageIndex('Failed: AI analysis provider unreachable', 45)).toBe(2);
  });
});
