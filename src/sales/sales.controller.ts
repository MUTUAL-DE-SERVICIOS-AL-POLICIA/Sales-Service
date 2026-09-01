import { Controller, ParseIntPipe } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateSaleDto,
  BcbPaymentNotificationDto,
  GenerateQrDto,
  GetQrCodeStatusDto,
  SalesListDto,
} from './dto';
import { SalesService } from './sales.service';

@Controller()
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @MessagePattern('sales.searchPerson')
  async searchPerson(
    @Payload('value') value: string,
    @Payload('type') type: string,
  ) {
    return this.salesService.searchPerson(value, type);
  }

  @MessagePattern('sales.groupProducts')
  async productsGroup(@Payload('groupId') groupId: number) {
    return this.salesService.productsGroup(groupId);
  }

  @MessagePattern('sales.groupsCheck')
  async groupsCheck(@Payload('groupIds') groupIds: string) {
    return this.salesService.groupsCheck(groupIds);
  }

  @MessagePattern('sales.accounts')
  async accounts() {
    return this.salesService.accounts();
  }

  @MessagePattern('sales.forCreatingSale')
  async forCreatingSale(@Payload('personUuid') personUuid: string) {
    return this.salesService.forCreatingSale(personUuid);
  }

  @MessagePattern('sales.generateQr')
  async generateQr(@Payload() data: GenerateQrDto) {
    return this.salesService.generateQr(data);
  }

  @MessagePattern('sales.createSale')
  async createSale(@Payload() data: CreateSaleDto) {
    return this.salesService.createSale(data);
  }

  @MessagePattern('sales.qrCodeStatus')
  async getQRCodeStatus(@Payload() data: GetQrCodeStatusDto) {
    return this.salesService.getQRCodeStatus(data);
  }

  @MessagePattern('sales.bcbPaymentNotification')
  async processBcbPaymentNotification(
    @Payload() data: BcbPaymentNotificationDto,
  ) {
    return this.salesService.processBcbPaymentNotification(data);
  }

  @MessagePattern('sales.personSales')
  async personSales(@Payload('personId', ParseIntPipe) personId: number) {
    return this.salesService.personSales(personId);
  }

  @MessagePattern('sales.personPendingQr')
  async personPendingQr(@Payload('personId', ParseIntPipe) personId: number) {
    return this.salesService.personPendingQr(personId);
  }

  @MessagePattern('sales.qrImage')
  async getQrImage(@Payload('qrId') qrId: string) {
    return this.salesService.getTemporaryQrImage(qrId);
  }

  @MessagePattern('sales.voucherPdf')
  async personSaleDetails(@Payload('saleId', ParseIntPipe) saleId: number) {
    return this.salesService.voucherPdf(saleId);
  }

  @MessagePattern('sales.reportAllSales')
  async reportAllSales(@Payload() filters: SalesListDto) {
    return this.salesService.reportAllSales(filters);
  }

  @MessagePattern('sales.personSalesRecords')
  async getPersonSalesRecords(
    @Payload('personId', ParseIntPipe) personId: number,
  ) {
    return this.salesService.getPersonSalesRecords(personId);
  }

  @MessagePattern('sales.forGenerateReport')
  async forGenerateReport() {
    return this.salesService.forGenerateReport();
  }

  @MessagePattern('sales.cancelSale')
  async cancelSale(@Payload('saleId') saleId: string) {
    return this.salesService.cancelSale(saleId);
  }
}
