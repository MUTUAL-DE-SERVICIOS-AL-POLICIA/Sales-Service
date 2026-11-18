import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class AccountLookupDataDto {
  @IsInt()
  @IsPositive()
  id: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  accountNumber: string | null;
}
