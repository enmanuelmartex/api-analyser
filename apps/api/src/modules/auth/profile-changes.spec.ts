import { describe, expect, it } from 'bun:test';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { profileChanges } from './auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * The rule this file exists to protect: on `PATCH /auth/me`, an absent key and
 * a null one mean different things, and confusing them silently destroys a
 * setting the user chose. Everything below is one of the two directions of that
 * mistake.
 */
describe('profileChanges', () => {
  it('writes only the keys the request actually sent', () => {
    expect(profileChanges({ name: 'Ana' })).toEqual({ name: 'Ana' });
  });

  /*
   * The regression that motivated the helper. Renaming yourself from the
   * Profile form must not wipe the timezone chosen in the Regional form below
   * it — which is exactly what spreading the whole DTO into `prisma.update`
   * would eventually do once anything here grew a null-means-clear semantic.
   */
  it('leaves untouched preferences alone when only the name is sent', () => {
    const changes = profileChanges({ name: 'Ana' });
    expect(changes).not.toHaveProperty('timeZone');
    expect(changes).not.toHaveProperty('dateFormat');
    expect(changes).not.toHaveProperty('avatarColor');
  });

  it('keeps an explicit null, because null is how a choice is cleared', () => {
    expect(profileChanges({ timeZone: null })).toEqual({ timeZone: null });
  });

  it('normalises an empty string to null so there is one spelling of "unset"', () => {
    expect(profileChanges({ avatarColor: '' as any })).toEqual({ avatarColor: null });
  });

  it('carries every field when the request sends every field', () => {
    expect(
      profileChanges({
        name: 'Ana',
        avatarColor: 'violet',
        timeZone: 'Europe/Madrid',
        dateFormat: 'iso',
        timeFormat: '24h',
      }),
    ).toEqual({
      name: 'Ana',
      avatarColor: 'violet',
      timeZone: 'Europe/Madrid',
      dateFormat: 'iso',
      timeFormat: '24h',
    });
  });

  it('reports no changes for an empty patch, so the service can skip the write', () => {
    expect(Object.keys(profileChanges({}))).toHaveLength(0);
  });
});

async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
}

describe('UpdateProfileDto', () => {
  it('accepts a preferences-only patch, with no name at all', async () => {
    expect(await errorsFor({ dateFormat: 'iso' })).toEqual([]);
  });

  /*
   * `name` is the one field where null is not a legal value — the column is NOT
   * NULL. `@IsOptional()` would have waved it through, since it treats null and
   * undefined alike; `@ValidateIf` is what makes the two distinguishable.
   */
  it('rejects an explicit null name while allowing an absent one', async () => {
    expect(await errorsFor({ name: null })).toEqual(['name']);
    expect(await errorsFor({ avatarColor: 'blue' })).toEqual([]);
  });

  it('rejects an empty or over-long display name', async () => {
    expect(await errorsFor({ name: '   ' })).toEqual(['name']);
    expect(await errorsFor({ name: 'x'.repeat(81) })).toEqual(['name']);
  });

  it('accepts null on every preference, because that is how each is cleared', async () => {
    expect(
      await errorsFor({ avatarColor: null, timeZone: null, dateFormat: null, timeFormat: null }),
    ).toEqual([]);
  });

  it('rejects a colour or format that nothing can render', async () => {
    expect(await errorsFor({ avatarColor: '#ff0000' })).toEqual(['avatarColor']);
    expect(await errorsFor({ dateFormat: 'YYYY-MM-DD' })).toEqual(['dateFormat']);
    expect(await errorsFor({ timeFormat: 'military' })).toEqual(['timeFormat']);
  });

  /*
   * An offset is not a zone. `UTC-4` cannot express "before and after the
   * clocks change", so storing it would render every timestamp an hour wrong
   * for half the year — the same reasoning the scheduler's validator documents,
   * using the same underlying check.
   */
  it('rejects a timezone the runtime cannot resolve', async () => {
    expect(await errorsFor({ timeZone: 'UTC-4' })).toEqual(['timeZone']);
    expect(await errorsFor({ timeZone: 'Not/AZone' })).toEqual(['timeZone']);
    expect(await errorsFor({ timeZone: 'America/Santo_Domingo' })).toEqual([]);
  });
});
