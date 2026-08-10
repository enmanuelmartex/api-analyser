import { PluginRegistryService, createBuiltinPlugins } from '../modules/plugins/plugin-registry.service';
import { computeOwaspCoverage } from '../modules/plugins/owasp-coverage';

/**
 * A registry usable in a unit test without booting Nest.
 *
 * `PluginRegistryService` builds its map in `onModuleInit`, which also syncs to
 * the database — not something a report test should trigger. This exposes the
 * one method the report generator actually needs, backed by the real built-in
 * check manifests, so coverage rendered in a test is the coverage the product
 * really has rather than a fixture that can drift from it.
 */
export function testPluginRegistry(): PluginRegistryService {
  const manifests = createBuiltinPlugins().map((plugin) => plugin.manifest);

  return {
    getOwaspCoverage: () => computeOwaspCoverage(manifests),
    getAllManifests: () => manifests,
    has: (id: string) => manifests.some((manifest) => manifest.id === id),
  } as unknown as PluginRegistryService;
}
