import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import {
  Group,
  Parameter,
  PaymentType,
  Product,
  QrPaymentSale,
  Sale,
  SaleCancellation,
  SaleProductFileNumber,
  SaleProduct,
  Voucher,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Sale,
      SaleCancellation,
      SaleProduct,
      SaleProductFileNumber,
      Product,
      Parameter,
      Group,
      PaymentType,
      Voucher,
      QrPaymentSale,
    ]),
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
