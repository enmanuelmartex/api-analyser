import { jsonOk } from '@/lib/http/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness only.
 *
 * Unauthenticated, because its job is to answer a load balancer and a
 * deployment check, and an authenticated health check tells you nothing when
 * the thing that broke is authentication.
 *
 * Which means it must reveal nothing: no environment variables, no
 * configuration status, no version, no provider reachability, no build id. Two
 * constant strings. "Is anything configured?" is a question for the logs, where
 * a missing variable is already reported by name at first use.
 */
export function GET(): Response {
  return jsonOk({ status: 'ok', service: 'api-analyzer-mail-relay' });
}
