import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { SalesListDto } from 'src/sales/dto';
import { Sale } from 'src/sales/entities/sale.entity';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Sale)
    private salesRepository: Repository<Sale>,
    private readonly dataSource: DataSource
  ) {}

  async reportAllSales(filters: SalesListDto = {}): Promise<any> {
    try {
      const params: any[] = [];

      const dateFrom = filters.dateFrom;
      const dateTo = filters.dateTo;

      const productIds = filters.productIds
        ?.split(',')
        .map(Number)
        .filter(Number.isInteger);

      params.push(dateFrom);
      params.push(dateTo);
      params.push(productIds);

      const reportData = await this.dataSource.query(
        `
        SELECT
          to_char(s.created_at, 'YYYY-MM-DD HH24:MI') AS "FECHA Y HORA",
          s.code AS "CÓDIGO",
          s.full_name AS "NOMBRE COMPLETO",
          sp.name AS "DESCRIPCIÓN",
          sp.total AS "TOTAL",
          pt.name AS "TIPO DE PAGO",
          s.receptionist AS "RECEPCIONISTA"

        FROM sales."sales" s

        INNER JOIN sales."sale_products" sp
          ON sp.sale_id = s.id

        LEFT JOIN LATERAL (
          SELECT pt.name
          FROM sales."vouchers" v
          LEFT JOIN sales."payment_types" pt
            ON pt.id = v.payment_type_id
          WHERE v.sale_id = s.id
          ORDER BY v.id ASC
          LIMIT 1
        ) pt ON true

        WHERE s.sale_state = 'VIGENTE'

          AND s.created_at >= $1::date
          AND s.created_at < ($2::date + INTERVAL '1 day')

          AND sp.product_id = ANY($3::int[])

        ORDER BY s.created_at DESC
        `,
        params,
      );

      const now = new Date();

      const header = {
        title: 'REPORTE DE VENTAS',
        subtitle: `Desde: ${dateFrom} Hasta: ${dateTo}`,
        date: now.toLocaleDateString('es-BO', {
          timeZone: 'America/La_Paz',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),

        hour: now.toLocaleTimeString('es-BO', {
          timeZone: 'America/La_Paz',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
        user: filters.user,
      };

      return {
        error: false,
        message: 'Datos para el reporte de ventas generado correctamente',
        data: {
          header,
          reportData
        },
      }
    } catch {
      return {
        error: true,
        message: 'Error al obtener datos para el reporte de ventas',
        data: [],
      };
    }
  }
}
