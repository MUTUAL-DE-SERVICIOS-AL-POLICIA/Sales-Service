import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { natsEnvs } from './config';
import {
  RpcCustomExceptionFilter,
  BadRequestCustomExceptionFilter,
} from './common';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.NATS,
      options: {
        servers: natsEnvs.natsServers,
      },
    },
  );

  app.useGlobalFilters(
    new RpcCustomExceptionFilter(),
    new BadRequestCustomExceptionFilter(),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}
bootstrap();
