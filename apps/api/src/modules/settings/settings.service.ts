import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
  type SettingKey,
  type SettingValue,
  getSettingDefinition,
} from './settings.registry';

/**
 * Resolves runtime settings as DB row → environment variable → fallback.
 *
 * Values are cached in memory because they are read on the hot path — every
 * audit write consults `logs.collectionEnabled` — and a database round trip per
 * log line would make logging the most expensive thing the API does. The cache
 * is refreshed on write, and this is a single-process API, so there is no
 * cross-instance invalidation to get wrong. If the API is ever scaled
 * horizontally this needs a Redis pub/sub invalidation; the TTL below bounds
 * the staleness in the meantime.
 */
const CACHE_TTL_MS = 30_000;

export interface ResolvedSetting {
  key: string;
  value: SettingValue;
  /** Where the effective value came from, so the UI can show "default" vs "overridden". */
  source: 'database' | 'environment' | 'default';
  definition: SettingDefinition;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, SettingValue>();
  private cacheLoadedAt = 0;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private events: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.refresh().catch((err) =>
      // Never fatal: an unreachable database at boot must not stop the API from
      // starting, and every getter falls back to env/default until the first
      // successful refresh.
      this.logger.warn(`Could not preload settings, using environment defaults: ${err.message}`),
    );
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** Effective boolean value. Throws only on a programming error (unknown key). */
  async getBoolean(key: SettingKey): Promise<boolean> {
    return (await this.get(key)) as boolean;
  }

  /** Effective numeric value. */
  async getNumber(key: SettingKey): Promise<number> {
    return (await this.get(key)) as number;
  }

  /**
   * Effective list value, always a fresh array.
   *
   * Copied rather than returned by reference: the cache holds the same array
   * for every caller, and one consumer sorting or splicing it in place would
   * change what every other consumer sees until the next refresh.
   */
  async getList(key: SettingKey): Promise<string[]> {
    const value = await this.get(key);
    return Array.isArray(value) ? [...value] : [];
  }

  async get(key: SettingKey): Promise<SettingValue> {
    await this.ensureFresh();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    return this.resolveWithoutDb(key).value;
  }

  /**
   * Synchronous read for call sites that cannot await — currently none, but the
   * audit interceptor is a plausible future one. Returns the cached value or
   * the environment default; never hits the database.
   */
  getCached(key: SettingKey): SettingValue {
    const cached = this.cache.get(key);
    return cached !== undefined ? cached : this.resolveWithoutDb(key).value;
  }

  /** Every setting with its effective value and provenance, for the admin UI. */
  async getAll(): Promise<ResolvedSetting[]> {
    const rows = await this.prisma.systemSetting.findMany();
    const overrides = new Map(rows.map((row) => [row.key, row.value]));

    return SETTING_DEFINITIONS.map((definition) => {
      const override = overrides.get(definition.key);
      if (override !== undefined && override !== null) {
        const parsed = this.coerce(definition, (override as any)?.value);
        if (parsed !== undefined) {
          return { key: definition.key, value: parsed, source: 'database' as const, definition };
        }
      }
      return { ...this.resolveWithoutDb(definition.key), definition };
    });
  }

  /** The subset belonging to one UI group. */
  async getGroup(group: SettingDefinition['group']): Promise<ResolvedSetting[]> {
    return (await this.getAll()).filter((setting) => setting.definition.group === group);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Applies a partial update and returns the settings that actually changed.
   *
   * Returning only the changes is what lets the caller write one audit event per
   * real change with a truthful old→new pair, rather than an event claiming a
   * change every time the form is submitted.
   */
  async update(
    patch: Record<string, unknown>,
    actorId?: string,
  ): Promise<{ key: string; from: SettingValue; to: SettingValue }[]> {
    const current = new Map((await this.getAll()).map((setting) => [setting.key, setting.value]));
    const changes: { key: string; from: SettingValue; to: SettingValue }[] = [];

    for (const [key, raw] of Object.entries(patch)) {
      const definition = getSettingDefinition(key);
      // Unknown keys are rejected rather than ignored: silently dropping half a
      // form submission leaves the operator believing a setting was saved.
      if (!definition) throw new BadRequestException(`Unknown setting: ${key}`);

      const value = this.coerce(definition, raw);
      if (value === undefined) {
        throw new BadRequestException(this.rejectionMessage(definition));
      }

      const from = current.get(key)!;
      if (from === value) continue;

      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: { value } as any, updatedById: actorId },
        update: { value: { value } as any, updatedById: actorId },
      });

      changes.push({ key, from, to: value });
    }

    if (changes.length) {
      await this.refresh();
      // Consumers that need to react — the retention job reschedules itself when
      // its interval changes — listen for this rather than being called directly.
      this.events.emit('settings.changed', { changes, actorId });
    }

    return changes;
  }

  /** Drops the override so the environment default takes effect again. */
  async reset(key: SettingKey, actorId?: string) {
    await this.prisma.systemSetting.deleteMany({ where: { key } });
    await this.refresh();
    this.events.emit('settings.changed', {
      changes: [{ key, from: null, to: this.resolveWithoutDb(key).value }],
      actorId,
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async ensureFresh() {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return;
    await this.refresh().catch(() => {
      // Keep serving the stale cache. A transient database error must not turn
      // every setting read into an exception on the request path.
    });
  }

  async refresh() {
    const rows = await this.prisma.systemSetting.findMany();
    const next = new Map<string, SettingValue>();

    for (const definition of SETTING_DEFINITIONS) {
      const row = rows.find((candidate) => candidate.key === definition.key);
      const override = row ? this.coerce(definition, (row.value as any)?.value) : undefined;
      next.set(definition.key, override ?? this.resolveWithoutDb(definition.key).value);
    }

    this.cache = next;
    this.cacheLoadedAt = Date.now();
  }

  /** env → fallback, with no database involvement. */
  private resolveWithoutDb(key: string): Omit<ResolvedSetting, 'definition'> {
    const definition = getSettingDefinition(key);
    if (!definition) throw new Error(`Unknown setting key: ${key}`);

    const raw = this.config.get<string>(definition.env);
    if (raw !== undefined && raw !== null && raw !== '') {
      const parsed = this.coerce(definition, raw);
      if (parsed !== undefined) return { key, value: parsed, source: 'environment' };
      this.logger.warn(
        `${definition.env}="${raw}" is not a valid ${definition.kind}; using the built-in default`,
      );
    }

    return { key, value: definition.fallback, source: 'default' };
  }

  /** Parses and range-checks. `undefined` means "not acceptable for this key". */
  private coerce(definition: SettingDefinition, raw: unknown): SettingValue | undefined {
    if (raw === undefined || raw === null) return undefined;

    if (definition.kind === 'boolean') {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw).toLowerCase().trim();
      if (text === 'true' || text === '1') return true;
      if (text === 'false' || text === '0') return false;
      return undefined;
    }

    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(parsed)) return undefined;
    const rounded = Math.trunc(parsed);
    if (definition.min !== undefined && rounded < definition.min) return undefined;
    if (definition.max !== undefined && rounded > definition.max) return undefined;
    return rounded;
  }

  /** Why a value was refused, in terms the operator can act on. */
  private rejectionMessage(definition: SettingDefinition): string {
    return (
      `Invalid value for ${definition.key}: expected ${definition.kind}` +
      (definition.kind === 'number' ? ` between ${definition.min} and ${definition.max}` : '')
    );
  }
}
