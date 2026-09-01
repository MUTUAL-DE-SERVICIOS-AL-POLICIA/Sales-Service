import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common';

export class SalesListDto extends PaginationDto {

  @IsDateString()
  dateFrom?: string;

  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  productIds?: string;
}

export class SalesListProductReportDto {
  @IsString()
  name: string;

  @Type(() => Number)
  amount: number;

  @IsString()
  price: string;
}

export class SalesListItemReportDto {
  @IsString()
  code: string | null;

  @IsString()
  receptionDate: string | null;

  @IsString()
  principalCustomer: string;

  @IsString()
  service: string;

  @Type(() => Number)
  amount: number;

  @IsString()
  price: string;

  @Type(() => SalesListProductReportDto)
  products: SalesListProductReportDto[];

  @IsString()
  paymentType: string;

  @IsString()
  total: string;

  @IsString()
  receptionist: string;
}
