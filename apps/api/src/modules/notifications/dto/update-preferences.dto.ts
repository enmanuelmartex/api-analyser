import { IsBoolean, IsOptional } from 'class-validator';

/**
 * A partial preference update — every field optional so a single switch can be
 * saved without the client resending the whole set and racing another tab.
 *
 * Mirrors `PreferenceFlags` in the notification catalog. The service narrows to
 * known keys as well, so an unlisted field is ignored rather than reaching
 * Prisma; this class is what makes the API reject a non-boolean outright.
 */
export class UpdatePreferencesDto {
  // ── In-app ────────────────────────────────────────────────────────────────
  @IsOptional() @IsBoolean() scanCompleted?: boolean;
  @IsOptional() @IsBoolean() scanFailed?: boolean;
  @IsOptional() @IsBoolean() reportGenerated?: boolean;
  @IsOptional() @IsBoolean() reportFailed?: boolean;
  @IsOptional() @IsBoolean() securityWarning?: boolean;
  @IsOptional() @IsBoolean() criticalFinding?: boolean;
  @IsOptional() @IsBoolean() newFindings?: boolean;
  @IsOptional() @IsBoolean() systemError?: boolean;

  // ── Email ─────────────────────────────────────────────────────────────────
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() emailScanCompleted?: boolean;
  @IsOptional() @IsBoolean() emailScanFailed?: boolean;
  @IsOptional() @IsBoolean() emailReportGenerated?: boolean;
  @IsOptional() @IsBoolean() emailCriticalFinding?: boolean;

  // ── Experience ────────────────────────────────────────────────────────────
  @IsOptional() @IsBoolean() soundEnabled?: boolean;
  @IsOptional() @IsBoolean() desktopEnabled?: boolean;
}
