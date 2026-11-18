import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { options, SchemaAwareDataSource } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...options, autoLoadEntities: true }),
      dataSourceFactory: async (dataSourceOptions) =>
        new SchemaAwareDataSource(
          dataSourceOptions as DataSourceOptions,
        ).initialize(),
    }),
  ],
})
export class DatabaseModule {}
