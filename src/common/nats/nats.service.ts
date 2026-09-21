import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { NATS_SERVICE } from '../../config';

export class NatsService {
  private readonly logger = new Logger('MicroserviceUtils');

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  private isValidParams(params: Record<string, unknown>): boolean {
    return (
      params &&
      typeof params === 'object' &&
      Object.values(params).some(
        (value) => value !== null && value !== undefined,
      )
    );
  }

  async firstValue(service: string, data: any): Promise<any> {
    return firstValueFrom(
      this.client.send(service, data).pipe(
        map((response) => {
          return {
            serviceStatus:
              response !== null &&
              typeof response === 'object' &&
              typeof response.serviceStatus === 'boolean'
                ? response.serviceStatus
                : true,
            data:
              response !== null &&
              typeof response === 'object' &&
              !Array.isArray(response) &&
              Object.prototype.hasOwnProperty.call(response, 'data')
                ? response.data
                : response,
          };
        }),
        catchError((error) => {
          this.logger.error(
            `Error calling microservice: ${service}`,
            error.message,
          );
          return of({
            serviceStatus: false,
            data: null,
          });
        }),
      ),
    );
  }

  async firstValueExclude(
    params: Record<string, unknown>,
    service: string,
    keysToOmit: string[],
  ): Promise<Record<string, unknown> | null> {
    if (!this.isValidParams(params)) {
      return null;
    }

    const { serviceStatus, data } = await this.firstValue(service, params);

    if (
      !serviceStatus ||
      data === null ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      return { serviceStatus, data };
    }

    const filteredData = { ...data };
    keysToOmit.forEach((key) => delete filteredData[key]);

    return {
      serviceStatus,
      data: filteredData,
    };
  }

  async firstValueInclude(
    params: Record<string, unknown>,
    service: string,
    keysToInclude: string[],
  ): Promise<Record<string, unknown> | null> {
    if (!this.isValidParams(params)) {
      return null;
    }

    const { serviceStatus, data } = await this.firstValue(service, params);

    if (
      !serviceStatus ||
      data === null ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      return { serviceStatus, data };
    }

    const filteredData = Object.fromEntries(
      keysToInclude.filter((key) => key in data).map((key) => [key, data[key]]),
    );

    return {
      serviceStatus,
      data: filteredData,
    };
  }
}
