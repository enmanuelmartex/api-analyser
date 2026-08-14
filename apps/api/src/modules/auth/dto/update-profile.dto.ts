import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  AVATAR_COLOR_KEYS,
  DATE_FORMAT_KEYS,
  THEME_KEYS,
  TIME_FORMAT_KEYS,
  type AvatarColorKey,
  type DateFormatKey,
  type ThemeKey,
  type TimeFormatKey,
} from '../display-preferences';
import { IsNullableTimeZone } from './is-nullable-time-zone.validator';

/**
 * Self-service profile changes.
 *
 * Email is deliberately absent: changing it would change the identity Better
 * Auth authenticates against. Role is absent because self-assigning a role is
 * privilege escalation. `avatar` is absent too — the product renders initials on
 * a colour and stores no images, so the only thing an account chooses about its
 * avatar is `avatarColor`. The global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so a request carrying any of them is rejected outright
 * rather than silently ignored.
 *
 * Every field is a partial update. `undefined` means "leave it alone"; for the
 * preference fields `null` means "clear it", which is how an account goes back
 * to the product default (and, for `timeZone`, back to following the browser).
 * The two are distinguished all the way to the Prisma call — `PATCH {"name":"…"}`
 * must not wipe a timezone the user chose last week.
 */
export class UpdateProfileDto {
  /*
   * `@ValidateIf`, not `@IsOptional()`.
   *
   * `@IsOptional()` skips validation for null as well as undefined, which would
   * let `{"name": null}` through to a NOT NULL column. Here the rules run
   * whenever the key is present at all, so an explicit null is rejected with a
   * message instead of reaching the database.
   */
  @ValidateIf((dto: UpdateProfileDto) => dto.name !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Display name cannot be empty' })
  @MaxLength(80, { message: 'Display name must be 80 characters or fewer' })
  name?: string;

  /*
   * The rest use `@IsOptional()` precisely because it treats null as "nothing
   * to validate" — null is a legal value for these columns and means "reset".
   */

  /** A key from the palette, never a CSS colour. See `display-preferences.ts`. */
  @IsOptional()
  @IsIn(AVATAR_COLOR_KEYS as unknown as string[], {
    message: `avatarColor must be one of: ${AVATAR_COLOR_KEYS.join(', ')}`,
  })
  avatarColor?: AvatarColorKey | null;

  /**
   * An IANA zone name, checked against the runtime's own tz database rather
   * than by shape. `UTC-4`, `EST` and typos all resolve to nothing, and a
   * timestamp rendered in a zone that does not exist is silently wrong.
   */
  @IsOptional()
  @IsNullableTimeZone()
  timeZone?: string | null;

  @IsOptional()
  @IsIn(DATE_FORMAT_KEYS as unknown as string[], {
    message: `dateFormat must be one of: ${DATE_FORMAT_KEYS.join(', ')}`,
  })
  dateFormat?: DateFormatKey | null;

  @IsOptional()
  @IsIn(TIME_FORMAT_KEYS as unknown as string[], {
    message: `timeFormat must be one of: ${TIME_FORMAT_KEYS.join(', ')}`,
  })
  timeFormat?: TimeFormatKey | null;

  /**
   * Light/dark preference.
   *
   * Written by the web app whenever the theme switcher is used, so the server
   * knows which variant of an email to render. The browser remains the source
   * of truth for what it displays — this is a mirror kept for the mail
   * pipeline, which cannot read `localStorage`.
   */
  @IsOptional()
  @IsIn(THEME_KEYS as unknown as string[], {
    message: `theme must be one of: ${THEME_KEYS.join(', ')}`,
  })
  theme?: ThemeKey | null;
}
