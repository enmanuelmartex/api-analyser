import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidTimeZone } from '../../scheduled-scans/recurrence/zoned-time';

/**
 * Accepts only a timezone the runtime can actually resolve.
 *
 * The same check scheduled scans apply to their recurrence zone, reusing the
 * same helper so a zone the scheduler accepts is a zone a profile accepts. A
 * plain `@IsString()` would let `UTC-4`, `EST` or a typo through, and every
 * timestamp the account reads would then be rendered in a zone that resolves to
 * nothing — the browser would silently fall back and the setting would appear
 * to do nothing at all.
 *
 * Paired with `@IsOptional()` on the property, which already lets null and
 * undefined past: on a profile, null is a legal value meaning "follow the
 * browser", so this only ever sees values that are meant to be real zones.
 */
export function IsNullableTimeZone(validationOptions?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: 'isNullableTimeZone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isValidTimeZone(value),
        defaultMessage: () =>
          'timeZone must be a valid IANA timezone name, for example America/Santo_Domingo',
      },
    });
  };
}
