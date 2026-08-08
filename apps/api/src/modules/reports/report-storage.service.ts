import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { assertStoredFileName } from './report-artifact';

/**
 * On-disk store for binary report artifacts (PDF).
 *
 * Text formats live in the `sourceSnapshot` column — they are the document.
 * PDFs are bytes, so they are written to a single flat directory keyed by
 * report id.
 *
 * Every path this service touches is `storageRoot + '/' + <bare file name>`.
 * The name comes from the report id, is re-validated on read, and the resolved
 * path is checked for containment before any I/O. Nothing derived from a
 * request body or query string reaches the filesystem.
 */
@Injectable()
export class ReportStorageService {
  private readonly logger = new Logger(ReportStorageService.name);
  private readonly storageRoot: string;

  constructor() {
    // `REPORTS_DIR` was already declared in configuration.ts and .env.example
    // but never wired to anything; this is the consumer it was meant for.
    const configured = process.env.REPORTS_DIR?.trim();
    this.storageRoot = configured
      ? isAbsolute(configured)
        ? resolve(configured)
        : resolve(process.cwd(), configured)
      : resolve(process.cwd(), 'storage', 'reports');
  }

  /** Absolute path of a stored artifact, proven to live inside the root. */
  private resolveWithinRoot(fileName: string): string {
    const absolute = resolve(join(this.storageRoot, assertStoredFileName(fileName)));
    const rootWithSep = this.storageRoot.endsWith(sep) ? this.storageRoot : this.storageRoot + sep;
    if (!absolute.startsWith(rootWithSep)) {
      throw new Error('Refusing to access a report artifact outside the storage root');
    }
    return absolute;
  }

  static checksum(bytes: Buffer | string): string {
    return createHash('sha256')
      .update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'))
      .digest('hex');
  }

  /**
   * Persists an artifact. Returns null instead of throwing when the volume is
   * unwritable: the report row is still valid, and download falls back to
   * re-rendering from the stored snapshot.
   */
  async write(fileName: string, bytes: Buffer): Promise<string | null> {
    try {
      const absolute = this.resolveWithinRoot(fileName);
      await mkdir(this.storageRoot, { recursive: true });
      await writeFile(absolute, bytes);
      return fileName;
    } catch (error) {
      this.logger.warn(
        `Could not persist report artifact ${fileName}; it will be re-rendered from its snapshot on download. ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Reads a stored artifact, or null when it is missing or unreadable. */
  async read(fileName: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveWithinRoot(fileName));
    } catch {
      return null;
    }
  }

  /**
   * Deletes a stored artifact.
   *
   * Only ever called with a name that came from `buildStoredFileName`, and the
   * containment check runs again here, so deleting a report can never remove a
   * file outside the storage root.
   */
  async delete(fileName: string | null | undefined): Promise<void> {
    if (!fileName) return;
    try {
      await rm(this.resolveWithinRoot(fileName), { force: true });
    } catch (error) {
      this.logger.warn(`Could not delete report artifact ${fileName}: ${(error as Error).message}`);
    }
  }
}
