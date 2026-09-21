import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NATS_SERVICE, natsEnvs } from 'src/config';
import { NatsService } from './nats/nats.service';
@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: natsEnvs.natsServers,
        },
      },
    ]),
  ],
  providers: [NatsService],
  exports: [
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: natsEnvs.natsServers,
        },
      },
    ]),
    NatsService,
  ],
})
export class CommonModule {}
