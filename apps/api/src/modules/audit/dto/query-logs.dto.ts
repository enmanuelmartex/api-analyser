import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { LogCategory, LogSeverity, LogStatus } from '@prisma/client';

/** Splits `?severity=ERROR,CRITICAL` and `?severity=ERROR&severity=CRITICAL` alike. */
const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(','));
  return String(value).split(',').filter(Boolean);
};

export class QueryLogsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(LogSeverity, { each: true })
  severity?: LogSeverity[];

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(LogCategory, { each: true })
  category?: LogCategory[];

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(LogStatus, { each: true })
  status?: LogStatus[];

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  event?: string;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  assessmentId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Clamped here as well as in the service. The service is the guarantee; this
   * bound turns an over-large request into a clear 400 rather than a silently
   * smaller page than the client asked for.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(['createdAt', 'severity', 'category', 'event'])
  sortBy?: 'createdAt' | 'severity' | 'category' | 'event';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
