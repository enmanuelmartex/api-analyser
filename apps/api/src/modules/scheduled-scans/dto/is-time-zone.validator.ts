import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidTimeZone } from '../recurrence/zoned-time';

/**
 * Accepts only a timezone the runtime can actually resolve.
 *
 * A plain `@IsString()` would let `UTC-4`, `EST` or a typo through, and the
 * schedule would then be stored with a name that never resolves — producing a
 * `nextRunAt` that is silently wrong, or an occurrence that never comes. The
 * zone is load-bearing for every date this feature computes, so it is checked
 * at the boundary against the same tz database the scheduler will use.
 */
export function IsTimeZone(validationOptions?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isValidTimeZone(value),
        defaultMessage: () =>
          'timezone must be a valid IANA timezone name, for example America/Santo_Domingo',
      },
    });
  };
}
