import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ScheduleFrequency } from '@prisma/client';
import { IsTimeZone } from './is-time-zone.validator';
import { MAX_INTERVAL_HOURS, MIN_INTERVAL_HOURS } from '../recurrence/recurrence';

/**
 * The shape of a schedule as a client may state it.
 *
 * Field-level validation only. The rules that span fields — a WEEKLY schedule
 * needs weekdays, a ONCE schedule needs a future instant, a CUSTOM schedule
 * needs a safe cron expression — live in ScheduledScansService, because they
 * need the recurrence engine and must apply to every writer, not only to
 * requests that happen to arrive through this DTO.
 */
export class CreateScheduledScanDto {
  @ApiProperty({ example: 'Weekly Production Scan' })
  @IsString()
  @IsNotEmpty({ message: 'A schedule name is required' })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'The project whose API will be scanned' })
  @IsString()
  @IsNotEmpty({ message: 'Select the project to scan' })
  projectId!: string;

  @ApiProperty({ enum: ScheduleFrequency })
  @IsEnum(ScheduleFrequency, {
    message: 'frequency must be one of ONCE, HOURLY, DAILY, WEEKLY, MONTHLY, CUSTOM',
  })
  frequency!: ScheduleFrequency;

  @ApiProperty({ example: 'America/Santo_Domingo' })
  @IsTimeZone()
  timezone!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 23, description: 'Wall-clock hour in `timezone`' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 59 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  minute?: number;

  @ApiPropertyOptional({ minimum: MIN_INTERVAL_HOURS, maximum: MAX_INTERVAL_HOURS })
  @IsOptional()
  @IsInt()
  @Min(MIN_INTERVAL_HOURS)
  @Max(MAX_INTERVAL_HOURS)
  intervalHours?: number;

  @ApiPropertyOptional({ type: [Number], description: '0 = Sunday … 6 = Saturday' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @Type(() => Number)
  weekdays?: number[];

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthDay?: number;

  @ApiPropertyOptional({ example: '0 2 * * 1', description: '5-field cron, evaluated in `timezone`' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cronExpression?: string;

  @ApiPropertyOptional({
    description:
      'ONCE: the instant to run at. Other frequencies: an optional "not before" bound.',
  })
  @IsOptional()
  @IsDateString({}, { message: 'startAt must be an ISO 8601 date-time' })
  startAt?: string;

  // ── Scan configuration — mirrors RunAssessmentDto ──────────────────────────
  // Same names and same bounds as the manual run, so a schedule cannot express
  // a configuration the "Run Assessment" sheet could not.

  @ApiPropertyOptional({ enum: ['all', 'profile', 'manual'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'profile', 'manual'])
  executionMode?: 'all' | 'profile' | 'manual';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scanProfileId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  manualPlugins?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enableAiAnalysis?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxRequestsPerEndpoint?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 60_000, default: 200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60_000)
  requestDelayMs?: number;

  @ApiPropertyOptional({ minimum: 1_000, maximum: 120_000, default: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(120_000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'Skip an occurrence while the previous run from this schedule is still going.',
  })
  @IsOptional()
  @IsBoolean()
  skipIfRunning?: boolean;
}
