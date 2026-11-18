import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class GroupDataDto {
  @IsInt()
  @IsPositive()
  id: number;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(10)
  shortened: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountName: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  accountNumber: string | null;
}
