import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Self-service profile changes.
 *
 * Only `name` is accepted. Email is deliberately absent: changing it would
 * change the identity Better Auth authenticates against, and role is absent
 * because self-assigning a role is privilege escalation. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a request carrying
 * either field is rejected outright rather than silently ignored.
 */
export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Display name cannot be empty' })
  @MaxLength(80, { message: 'Display name must be 80 characters or fewer' })
  name: string;
}
