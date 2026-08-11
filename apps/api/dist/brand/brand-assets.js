"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markDataUri = markDataUri;
exports.logoAssetAvailable = logoAssetAvailable;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const FILENAMES = {
    dark: 'mark-compact-white.svg',
    light: 'mark-compact-black.svg',
};
function resolveAssetPath(filename) {
    return (0, node_path_1.join)(__dirname, 'assets', filename);
}
const cache = new Map();
function markDataUri(surface) {
    const cached = cache.get(surface);
    if (cached !== undefined)
        return cached;
    let uri;
    try {
        const svg = (0, node_fs_1.readFileSync)(resolveAssetPath(FILENAMES[surface]), 'utf8');
        uri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    }
    catch {
        uri = '';
    }
    cache.set(surface, uri);
    return uri;
}
function logoAssetAvailable() {
    return markDataUri('dark').length > 0 && markDataUri('light').length > 0;
}
//# sourceMappingURL=brand-assets.js.map