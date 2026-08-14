import { IsIn, IsOptional, IsString } from 'class-validator';

/** The phrase an operator must type to delete the entire audit trail. */
export const PURGE_ALL_CONFIRMATION = 'DELETE LOGS';

export class PurgeLogsDto {
  /**
   * How much to remove. Deliberately a closed set rather than a free-form date:
   * an off-by-one in a hand-typed cutoff destroys evidence irreversibly, and
   * these three cover the reasons an operator actually purges.
   */
  @IsIn(['older-than-7-days', 'older-than-30-days', 'all'])
  scope!: 'older-than-7-days' | 'older-than-30-days' | 'all';

  /**
   * Must equal PURGE_ALL_CONFIRMATION when `scope` is `all`.
   *
   * Checked on the server, not only in the dialog: a confirmation enforced
   * solely in the browser is decoration, and this endpoint can erase the entire
   * audit trail.
   */
  @IsOptional()
  @IsString()
  confirmation?: string;
}
