import { describe, expect, test } from 'bun:test';
import { RelayError } from '@/lib/http/errors';
import { MAX_PDF_BYTES, MIN_PDF_BYTES } from '@/lib/limits';
import { FALLBACK_FILENAME, sanitiseFilename } from '@/lib/validation/filename';
import { decodePdfBase64 } from '@/lib/validation/pdf';
import { parseSendReportRequest } from '@/lib/validation/send-report.schema';
import { samplePdfBase64 } from './helpers';

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (error) {
    if (error instanceof RelayError) return error.status;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('sanitiseFilename', () => {
  test.each([
    ['security-report.pdf', 'security-report.pdf'],
    ['Q3 Audit.pdf', 'Q3-Audit.pdf'],
    ['REPORT.PDF', 'REPORT.pdf'],
    ['  spaced.pdf  ', 'spaced.pdf'],
  ])('keeps %s usable', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  test.each([
    ['../../../etc/passwd.pdf', 'passwd.pdf'],
    ['C:\\Windows\\System32\\evil.pdf', 'evil.pdf'],
    ['/absolute/path/report.pdf', 'report.pdf'],
    ['..%2f..%2freport.pdf', '2f.-2freport.pdf'],
  ])('strips path traversal from %s', (input, expected) => {
    const result = sanitiseFilename(input);
    expect(result).toBe(expected);
    expect(result).not.toMatch(/[\\/]/);
    expect(result).not.toContain('..');
  });

  test('never produces a hidden file or a leading hyphen', () => {
    expect(sanitiseFilename('...hidden.pdf')).toBe('hidden.pdf');
    expect(sanitiseFilename('--rf.pdf')).toBe('rf.pdf');
  });

  test('falls back when nothing usable survives', () => {
    expect(sanitiseFilename('....pdf')).toBe(FALLBACK_FILENAME);
    expect(sanitiseFilename('///.pdf')).toBe(FALLBACK_FILENAME);
  });

  test('neutralises characters used to disguise an extension', () => {
    // A right-to-left override makes `report<RLO>fdp.exe` render as
    // `report.pdf` in some clients. The allow-list removes it either way.
    const result = sanitiseFilename('report\u202Efdp.exe.pdf');
    expect(result).not.toContain('\u202E');
    expect(result.endsWith('.pdf')).toBe(true);
  });

  test('caps the length', () => {
    expect(sanitiseFilename(`${'a'.repeat(400)}.pdf`).length).toBeLessThanOrEqual(255);
  });

  test.each(['report.html', 'report.pdf.exe', 'report', 'report.pd'])(
    'rejects %s with 400',
    (input) => {
      expect(statusOf(() => sanitiseFilename(input))).toBe(400);
    },
  );
});

describe('decodePdfBase64', () => {
  test('decodes a valid PDF to its exact bytes', () => {
    const base64 = samplePdfBase64(512);
    const buffer = decodePdfBase64(base64);

    expect(buffer.toString('base64')).toBe(base64);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('tolerates a data-URL prefix', () => {
    const base64 = samplePdfBase64(512);
    expect(decodePdfBase64(`data:application/pdf;base64,${base64}`).length).toBe(512);
  });

  test('rejects characters outside the base64 alphabet with 400', () => {
    // Buffer.from silently drops these, so without an explicit check the caller
    // would get a corrupt attachment instead of an error.
    expect(statusOf(() => decodePdfBase64('!!!! not base64 !!!!'))).toBe(400);
  });

  test('rejects broken padding with 400', () => {
    expect(statusOf(() => decodePdfBase64(`${samplePdfBase64(512)}A`))).toBe(400);
  });

  test('rejects an empty payload with 400', () => {
    expect(statusOf(() => decodePdfBase64('   '))).toBe(400);
  });

  test('rejects valid base64 that is not a PDF with 400', () => {
    const notAPdf = Buffer.alloc(MIN_PDF_BYTES + 16, 0x41).toString('base64');
    expect(statusOf(() => decodePdfBase64(notAPdf))).toBe(400);
  });

  test('rejects a truncated payload with 400', () => {
    expect(statusOf(() => decodePdfBase64(Buffer.from('%PDF-').toString('base64')))).toBe(400);
  });

  test('rejects an oversized payload with 413', () => {
    expect(statusOf(() => decodePdfBase64(samplePdfBase64(MAX_PDF_BYTES + 1024)))).toBe(413);
  });

  test('rejects an oversized payload before decoding it', () => {
    // 40 MB of base64: the length check must fire without allocating a buffer.
    const huge = `${'A'.repeat(40 * 1024 * 1024)}`;
    expect(statusOf(() => decodePdfBase64(huge))).toBe(413);
  });
});

describe('parseSendReportRequest', () => {
  const valid = {
    email: 'security@example.com',
    scanName: 'Production API',
    filename: 'report.pdf',
    pdfBase64: samplePdfBase64(),
  };

  test('accepts a valid payload and trims it', () => {
    const parsed = parseSendReportRequest({ ...valid, email: '  security@example.com  ' });
    expect(parsed.email).toBe('security@example.com');
  });

  test('treats scanName as optional', () => {
    const { scanName: _omitted, ...withoutScanName } = valid;
    expect(parseSendReportRequest(withoutScanName).scanName).toBeUndefined();
  });

  test.each([
    ['a non-object body', 'just a string'],
    ['null', null],
    ['an array', []],
    ['an email that is not one', { ...valid, email: 'nope' }],
    ['a numeric email', { ...valid, email: 12345 }],
    ['a blank scan name', { ...valid, scanName: '   ' }],
    ['a newline in the email', { ...valid, email: 'a@b.com\r\nBcc: c@d.com' }],
    ['an unknown field', { ...valid, from: 'attacker@example.com' }],
    ['a caller-supplied subject', { ...valid, subject: 'Anything I like' }],
  ])('rejects %s with 400', (_label, body) => {
    expect(statusOf(() => parseSendReportRequest(body))).toBe(400);
  });

  test('never reflects the submitted value back in the error message', () => {
    try {
      parseSendReportRequest({ ...valid, email: 'secret-internal-address@corp.local' });
    } catch (error) {
      expect((error as RelayError).publicMessage).not.toContain('corp.local');
    }
  });
});
