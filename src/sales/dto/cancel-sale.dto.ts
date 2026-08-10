import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CancelSaleDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  saleId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cancelledByUser: string;
}
