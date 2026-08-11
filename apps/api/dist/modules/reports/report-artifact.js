"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERATOR_VERSION = exports.REPORT_TYPES = exports.REPORT_FORMATS = void 0;
exports.isReportFormat = isReportFormat;
exports.isReportType = isReportType;
exports.formatSpec = formatSpec;
exports.contentTypeFor = contentTypeFor;
exports.extensionFor = extensionFor;
exports.isBinaryFormat = isBinaryFormat;
exports.slugify = slugify;
exports.buildFileName = buildFileName;
exports.buildStoredFileName = buildStoredFileName;
exports.assertStoredFileName = assertStoredFileName;
exports.contentDisposition = contentDisposition;
const brand_1 = require("../../brand/brand");
exports.REPORT_FORMATS = [
    'PDF',
    'HTML',
    'MARKDOWN',
    'JSON',
    'SARIF',
];
exports.REPORT_TYPES = [
    'TECHNICAL',
    'EXECUTIVE',
    'DEVELOPER',
    'COMPLIANCE',
];
exports.GENERATOR_VERSION = '1.0.0';
const FORMAT_SPEC = {
    PDF: { extension: 'pdf', contentType: 'application/pdf', binary: true },
    HTML: { extension: 'html', contentType: 'text/html; charset=utf-8', binary: false },
    MARKDOWN: { extension: 'md', contentType: 'text/markdown; charset=utf-8', binary: false },
    JSON: { extension: 'json', contentType: 'application/json; charset=utf-8', binary: false },
    SARIF: { extension: 'sarif', contentType: 'application/sarif+json; charset=utf-8', binary: false },
};
function isReportFormat(value) {
    return exports.REPORT_FORMATS.includes(value);
}
function isReportType(value) {
    return exports.REPORT_TYPES.includes(value);
}
function formatSpec(format) {
    return FORMAT_SPEC[format];
}
function contentTypeFor(format) {
    return FORMAT_SPEC[format].contentType;
}
function extensionFor(format) {
    return FORMAT_SPEC[format].extension;
}
function isBinaryFormat(format) {
    return FORMAT_SPEC[format].binary;
}
function slugify(value, fallback = 'report') {
    const slug = String(value ?? '')
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 60);
    return slug || fallback;
}
function buildFileName(input) {
    const date = input.generatedAt.toISOString().split('T')[0];
    const revision = input.version && input.version > 1 ? `-v${input.version}` : '';
    return [
        brand_1.appBrand.fileSlug,
        slugify(input.projectName, 'report'),
        input.type.toLowerCase(),
        date + revision,
    ].join('-') + '.' + extensionFor(input.format);
}
function buildStoredFileName(reportId, format) {
    return `${reportId}.${extensionFor(format)}`;
}
function assertStoredFileName(filePath) {
    const invalid = !filePath ||
        filePath.includes('/') ||
        filePath.includes('\\') ||
        filePath.includes('\0') ||
        filePath === '.' ||
        filePath === '..' ||
        filePath.startsWith('.') ||
        /^[a-zA-Z]:/.test(filePath);
    if (invalid)
        throw new Error('Refusing to read report artifact from an unexpected path');
    return filePath;
}
function contentDisposition(fileName) {
    const safe = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(fileName);
    return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
//# sourceMappingURL=report-artifact.js.map