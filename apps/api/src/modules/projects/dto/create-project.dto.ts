import { IsString, IsUrl, IsOptional, IsEnum, MaxLength, IsArray, IsInt, Min, Max, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ProjectEnvironment {
  DEVELOPMENT = 'DEVELOPMENT',
  STAGING = 'STAGING',
  PRODUCTION = 'PRODUCTION',
}

export class CreateProjectDto {
  @ApiProperty({ example: 'My REST API' })
  @IsString()
  @IsNotEmpty({ message: 'Project name is required.' })
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Main backend API for mobile app' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 'http://localhost:8000' })
  @IsString()
  @IsUrl(
    { require_protocol: true, require_tld: false, protocols: ['http', 'https'] },
    { message: 'Enter a valid HTTP or HTTPS API base URL.' },
  )
  baseUrl: string;

  @ApiPropertyOptional({ enum: ProjectEnvironment, default: 'DEVELOPMENT' })
  @IsOptional()
  @IsEnum(ProjectEnvironment)
  environment?: ProjectEnvironment;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class SaveProjectDraftDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(2048) baseUrl?: string;
  @IsOptional() @IsEnum(ProjectEnvironment) environment?: ProjectEnvironment;
  @IsOptional() @IsInt() @Min(1) @Max(3) setupStep?: number;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsEnum(ProjectEnvironment)
  environment?: ProjectEnvironment;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
