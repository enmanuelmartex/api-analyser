import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateScheduledScanDto } from './create-scheduled-scan.dto';

/**
 * Every field of a create, all optional, except the project.
 *
 * `projectId` is deliberately not editable. Moving a schedule to another API
 * would silently change what its whole execution history refers to — the runs
 * listed under it would be scans of a different system — and the honest
 * operation for "scan a different API" is a new schedule.
 */
export class UpdateScheduledScanDto extends PartialType(
  OmitType(CreateScheduledScanDto, ['projectId'] as const),
) {}
