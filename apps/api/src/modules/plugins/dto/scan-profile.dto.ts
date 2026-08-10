import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Scan profile payloads.
 *
 * These routes previously typed their body with an inline TypeScript type.
 * Inline types carry no `class-validator` metadata, so the global
 * `ValidationPipe` — `whitelist`, `forbidNonWhitelisted`, `transform` — had
 * nothing to inspect and skipped them entirely. A profile could be saved with
 * an empty name, a 10,000-character description, or an arbitrary extra field.
 *
 * Check ids are validated separately, in `ProfilesService`, against the plugin
 * registry: whether an id exists is a question about runtime state, not about
 * the shape of the request, so it cannot be expressed as a decorator.
 */
export class CreateScanProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Profile name cannot be empty' })
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  /**
   * At least one check: a profile selecting nothing would enqueue a scan that
   * tests nothing and still reports a score.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'A profile must include at least one security check' })
  @ArrayMaxSize(100)
  @IsString({ each: true })
  enabledPlugins: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  pluginConfigs?: Record<string, any>;
}

export class UpdateScanProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Profile name cannot be empty' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'A profile must include at least one security check' })
  @ArrayMaxSize(100)
  @IsString({ each: true })
  enabledPlugins?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  pluginConfigs?: Record<string, any>;
}
