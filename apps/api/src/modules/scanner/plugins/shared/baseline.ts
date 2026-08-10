/**
 * Comparing a probe against what the target says about a route that does not
 * exist.
 *
 * This is the guard against the single worst failure mode a scanner has: being
 * pointed at something that answers everything the same way — a single-page
 * app, a CDN, a catch-all gateway, or simply a base URL that names the wrong
 * host — and reporting the resulting uniform responses as vulnerabilities.
 * Those findings arrive at HIGH severity on routes that were never there.
 *
 * Any check that concludes something from "the target responded like this"
 * should first establish how it responds to nonsense, and require the real
 * probe to differ.
 */

export interface ProbeObservation {
  status: number;
  bodyLength: number;
}

/**
 * True when a probe response is meaningfully different from the baseline.
 *
 * Body length is compared with a floor as well as a ratio: error documents that
 * echo the requested path differ by a few bytes between two unknown routes, and
 * that difference must not read as a discovery.
 */
export function isDistinctFromBaseline(
  probe: ProbeObservation,
  baseline: ProbeObservation,
): boolean {
  if (probe.status !== baseline.status) return true;

  const delta = Math.abs(probe.bodyLength - baseline.bodyLength);
  const threshold = Math.max(64, baseline.bodyLength * 0.25);

  return delta > threshold;
}
