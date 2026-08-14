import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  /**
   * Eight is the floor the previous (non-functional) form claimed to enforce,
   * kept so the rule the user was already shown stays true.
   */
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  newPassword!: string;
}
