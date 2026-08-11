import { computeFingerprint, normalizeRoute } from './src/common/identity/fingerprint.util';

const adminPaths = [
  '/admin', '/admin/', '/api/admin', '/management', '/internal',
  '/superuser', '/root', '/system', '/private', '/restricted',
  '/dashboard/admin', '/users/admin', '/control', '/ops',
  '/v1/admin', '/v2/admin', '/api/v1/admin', '/api/v2/admin',
];

const probed = adminPaths.slice(0, 8);
const seen = new Map<string, string[]>();

for (const p of probed) {
  const fp = computeFingerprint({
    projectId: 'proj',
    pluginId: 'bfla',
    ruleId: 'bfla.admin-endpoint-accessible',
    method: 'GET',
    route: p,
    component: 'endpoint',
  });
  console.log(`${p.padEnd(14)} -> ${normalizeRoute(p).padEnd(14)} ${fp.fingerprint.slice(0, 12)}`);
  const list = seen.get(fp.fingerprint) ?? [];
  list.push(p);
  seen.set(fp.fingerprint, list);
}

console.log(`\nprobed=${probed.length} distinct identities=${seen.size}`);
for (const [, paths] of seen) if (paths.length > 1) console.log('COLLAPSED:', paths.join('  ==  '));
