import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { isSettingKey } from './settings.registry';
import { BadRequestException } from '@nestjs/common';

/**
 * Runtime configuration, administrator-only.
 *
 * No audit call appears in this controller. `SettingsService.update` emits
 * `settings.changed`, and the audit listener writes the event from there — so a
 * setting changed by any future caller (a CLI, a migration, a seed) is recorded
 * on exactly the same path as one changed from this endpoint.
 */
@ApiTags('settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Effective runtime settings with their provenance' })
  async findAll() {
    const resolved = await this.settings.getAll();
    return resolved.map(({ key, value, source, definition }) => ({
      key,
      value,
      source,
      kind: definition.kind,
      label: definition.label,
      description: definition.description,
      group: definition.group,
      env: definition.env,
      min: definition.min,
      max: definition.max,
      default: definition.fallback,
    }));
  }

  @Patch()
  @ApiOperation({ summary: 'Override one or more settings at runtime' })
  async update(@Body() dto: UpdateSettingsDto, @CurrentUser() actor: any) {
    const changes = await this.settings.update(dto.settings, actor.id);
    return { changes, changed: changes.length };
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Drop an override so the environment default applies again' })
  async reset(@Param('key') key: string, @CurrentUser() actor: any) {
    if (!isSettingKey(key)) throw new BadRequestException(`Unknown setting: ${key}`);
    await this.settings.reset(key, actor.id);
    return { success: true };
  }
}
