import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ScheduleFrequency, ScheduleStatus } from '@prisma/client';

/** Splits `?status=ACTIVE,PAUSED` and `?status=ACTIVE&status=PAUSED` alike. */
const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(','));
  return String(value).split(',').filter(Boolean);
};

/**
 * Filters for the Scheduled Scans list. Applied server-side, all of them.
 *
 * Filtering in the browser would mean fetching every schedule of every project
 * on each keystroke, and the counts under the table would describe the loaded
 * page rather than the result set.
 */
export class QueryScheduledScansDto {
  @ApiPropertyOptional({ description: 'Matches the schedule name or the project name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ScheduleStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ScheduleStatus, { each: true })
  status?: ScheduleStatus[];

  @ApiPropertyOptional({ enum: ScheduleFrequency, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ScheduleFrequency, { each: true })
  frequency?: ScheduleFrequency[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
