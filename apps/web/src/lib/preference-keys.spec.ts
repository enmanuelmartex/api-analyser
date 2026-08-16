import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AVATAR_COLORS } from '@/components/shared/user-avatar';
import { DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS } from './user-preferences';

/**
 * The web offers the choices; the API decides which ones are legal.
 *
 * Two lists, in two packages, that must agree — the classic pair that drifts.
 * The failure mode is quiet and one-sided: add a colour to the palette and
 * forget the API, and the swatch renders perfectly, the user picks it, and the
 * save comes back 400 with a validation message about a field they never knew
 * they were setting. Nothing in a type system catches it, because the column is
 * a string on both sides by design.
 *
 * So this reads the API's catalogue as text and compares. Parsing source is
 * ugly, and it is still the cheapest thing that actually fails when someone
 * edits one file and not the other — which is the only property being bought
 * here.
 */

const API_CATALOGUE = join(
  import.meta.dir,
  '../../../api/src/modules/auth/display-preferences.ts',
);

/** Pulls the string literals out of `export const NAME = [...] as const;`. */
function keysFromApi(constName: string): string[] {
  const source = readFileSync(API_CATALOGUE, 'utf8');
  const block = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`).exec(source);
  if (!block) throw new Error(`${constName} not found in ${API_CATALOGUE}`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('preference keys match the API catalogue', () => {
  it('offers exactly the avatar colours the API accepts', () => {
    expect(AVATAR_COLORS.map((colour) => colour.key).sort()).toEqual(
      keysFromApi('AVATAR_COLOR_KEYS').sort(),
    );
  });

  it('offers exactly the date formats the API accepts', () => {
    expect(DATE_FORMAT_OPTIONS.map((option) => option.key).sort()).toEqual(
      keysFromApi('DATE_FORMAT_KEYS').sort(),
    );
  });

  it('offers exactly the time formats the API accepts', () => {
    expect(TIME_FORMAT_OPTIONS.map((option) => option.key).sort()).toEqual(
      keysFromApi('TIME_FORMAT_KEYS').sort(),
    );
  });

  /*
   * `default` is load-bearing rather than decorative: it is what a null column
   * resolves to, and removing it would silently repaint every account that has
   * never opened this setting.
   */
  it('keeps a "default" colour for accounts that never chose one', () => {
    expect(AVATAR_COLORS[0].key).toBe('default');
  });
});
