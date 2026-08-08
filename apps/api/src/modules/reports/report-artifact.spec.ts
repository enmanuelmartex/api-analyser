import { describe, expect, it } from 'bun:test';
import {
  assertStoredFileName,
  buildFileName,
  buildStoredFileName,
  contentDisposition,
  contentTypeFor,
  extensionFor,
  isBinaryFormat,
  isReportFormat,
  isReportType,
  slugify,
} from './report-artifact';

const AT = new Date('2026-07-27T10:30:00.000Z');

describe('format specs', () => {
  it('maps every format to the MIME type the browser needs to render it', () => {
    expect(contentTypeFor('PDF')).toBe('application/pdf');
    expect(contentTypeFor('HTML')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('MARKDOWN')).toBe('text/markdown; charset=utf-8');
    expect(contentTypeFor('JSON')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('SARIF')).toBe('application/sarif+json; charset=utf-8');
  });

  it('gives each format its conventional extension', () => {
    expect(extensionFor('PDF')).toBe('pdf');
    expect(extensionFor('MARKDOWN')).toBe('md');
    expect(extensionFor('SARIF')).toBe('sarif');
  });

  it('treats only PDF as binary — the rest are their own source', () => {
    expect(isBinaryFormat('PDF')).toBe(true);
    for (const format of ['HTML', 'MARKDOWN', 'JSON', 'SARIF'] as const) {
      expect(isBinaryFormat(format)).toBe(false);
    }
  });

  it('rejects unknown formats and types', () => {
    expect(isReportFormat('PDF')).toBe(true);
    expect(isReportFormat('DOCX')).toBe(false);
    expect(isReportFormat('__proto__')).toBe(false);
    expect(isReportType('TECHNICAL')).toBe(true);
    expect(isReportType('ADMIN')).toBe(false);
  });
});

describe('slugify', () => {
  it('strips characters that could break out of a header or a path', () => {
    expect(slugify('../../etc/passwd')).toBe('etcpasswd');
    expect(slugify('Acme "Payments" API')).toBe('acme-payments-api');
    expect(slugify('report\r\nX-Injected: 1')).toBe('report-x-injected-1');
  });

  it('falls back rather than producing an empty name', () => {
    expect(slugify('///')).toBe('report');
    expect(slugify('', 'fallback')).toBe('fallback');
  });
});

describe('buildFileName', () => {
  it('names an artifact from project, type, date and extension', () => {
    expect(
      buildFileName({ projectName: 'Payments API', type: 'TECHNICAL', format: 'PDF', generatedAt: AT }),
    ).toBe('api-analyser-payments-api-technical-2026-07-27.pdf');
  });

  it('marks revisions beyond the first so two versions never collide', () => {
    const v1 = buildFileName({ projectName: 'API', type: 'EXECUTIVE', format: 'HTML', generatedAt: AT, version: 1 });
    const v3 = buildFileName({ projectName: 'API', type: 'EXECUTIVE', format: 'HTML', generatedAt: AT, version: 3 });
    expect(v1).toBe('api-analyser-api-executive-2026-07-27.html');
    expect(v3).toBe('api-analyser-api-executive-2026-07-27-v3.html');
  });

  it('never lets a hostile project name reach the filename', () => {
    const name = buildFileName({
      projectName: '../../../../etc/shadow',
      type: 'TECHNICAL',
      format: 'JSON',
      generatedAt: AT,
    });
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
  });
});

describe('stored artifact paths', () => {
  it('keys the stored file on the report id alone', () => {
    expect(buildStoredFileName('ckreport123', 'PDF')).toBe('ckreport123.pdf');
  });

  it('accepts a well-formed stored name', () => {
    expect(assertStoredFileName('ckreport123.pdf')).toBe('ckreport123.pdf');
  });

  it('refuses anything that is not a bare file name', () => {
    for (const hostile of [
      '../secret.pdf',
      '..\\secret.pdf',
      'nested/report.pdf',
      'C:\\Windows\\system.ini',
      '/etc/passwd',
      '.env',
      '..',
      '.',
      '',
      'report\0.pdf',
    ]) {
      expect(() => assertStoredFileName(hostile)).toThrow();
    }
  });
});

describe('contentDisposition', () => {
  it('always marks the response as an attachment', () => {
    expect(contentDisposition('api-analyser-api-technical-2026-07-27.pdf')).toContain('attachment;');
  });

  it('neutralises quotes and backslashes that would terminate the header value', () => {
    const header = contentDisposition('re"port\\.pdf');
    expect(header).toContain('filename="re_port_.pdf"');
  });

  it('carries non-ASCII names in the RFC 5987 form instead of raw bytes', () => {
    const header = contentDisposition('informe-seguridad-ñ.pdf');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent('informe-seguridad-ñ.pdf'));
    expect(header).toContain('filename="informe-seguridad-_.pdf"');
  });
});
