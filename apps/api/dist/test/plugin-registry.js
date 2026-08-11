"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testPluginRegistry = testPluginRegistry;
const plugin_registry_service_1 = require("../modules/plugins/plugin-registry.service");
const owasp_coverage_1 = require("../modules/plugins/owasp-coverage");
function testPluginRegistry() {
    const manifests = (0, plugin_registry_service_1.createBuiltinPlugins)().map((plugin) => plugin.manifest);
    return {
        getOwaspCoverage: () => (0, owasp_coverage_1.computeOwaspCoverage)(manifests),
        getAllManifests: () => manifests,
        has: (id) => manifests.some((manifest) => manifest.id === id),
    };
}
//# sourceMappingURL=plugin-registry.js.map