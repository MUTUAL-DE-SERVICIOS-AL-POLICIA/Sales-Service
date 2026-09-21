import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SalesListDto } from 'src/sales/dto';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}


  @MessagePattern('sales.report.allSales')
  async reportAllSales(@Payload() filters: SalesListDto) {
    return this.reportsService.reportAllSales(filters);
  }
}
