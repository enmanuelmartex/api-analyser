import { IsObject } from 'class-validator';

/**
 * A partial settings update.
 *
 * Intentionally untyped beyond "an object": the keys and their value ranges are
 * validated against SETTING_DEFINITIONS in SettingsService, which is the single
 * place that knows what a valid setting is. Duplicating the catalogue as
 * decorators here would let the two drift, and the registry is what the UI
 * renders from.
 */
export class UpdateSettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}
