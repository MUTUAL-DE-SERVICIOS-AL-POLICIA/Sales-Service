import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SaleProductDto {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsNumberString()
  price: string;

  @IsInt()
  @IsPositive()
  amount: number;
}

export class saleVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  customer: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  identityCardCustomer: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentLocation: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  receiptNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsDateString()
  depositDate: string;
}

export class CreateSaleDto {
  @IsInt()
  @IsPositive()
  personId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  identityCard: string;

  @IsInt()
  @IsPositive()
  nup: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  receptionist: string;

  @IsInt()
  @IsPositive()
  parameterId: number;

  @IsInt()
  @IsPositive()
  paymentTypeId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleProductDto)
  saleProducts: SaleProductDto[];

  @ValidateNested()
  @Type(() => saleVoucherDto)
  voucher: saleVoucherDto;
}
