/**
 * Liveness probe for the web container.
 *
 * The Dockerfile's HEALTHCHECK has always polled `/api/health`; the route did
 * not exist, so every container built from that image reported `unhealthy`
 * forever and anything gated on `service_healthy` would have waited out its
 * retries and given up.
 *
 * Deliberately shallow: it answers for *this* process only. It does not reach
 * the API or the database, because a front end that renders its shell and shows
 * a connection error is still doing its job — reporting it as down would take
 * the whole compose stack with it whenever the backend restarts.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'web', timestamp: new Date().toISOString() });
}
