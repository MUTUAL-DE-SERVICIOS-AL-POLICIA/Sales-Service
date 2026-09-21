import { DataSource, DataSourceOptions } from 'typeorm';
import { SeederOptions } from 'typeorm-extension';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { dbEnvs } from 'src/config';

const databaseSchema = dbEnvs.dbSchema;

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replace(/"/g, '""')}"`;

async function ensureDatabaseSchema(dataSource: DataSource) {
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  try {
    await queryRunner.query(
      `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(databaseSchema)}`,
    );
  } finally {
    await queryRunner.release();
  }
}

export const options: DataSourceOptions & SeederOptions = {
  type: 'postgres' as const,
  host: dbEnvs.dbHost,
  port: dbEnvs.dbPort,
  database: dbEnvs.dbDatabase,
  username: dbEnvs.dbUsername,
  password: dbEnvs.dbPassword,
  synchronize: dbEnvs.dbSynchronize,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  namingStrategy: new SnakeNamingStrategy(),

  seeds: [__dirname + '/seeds/**/*{.ts,.js}'],
  seedTracking: true,

  schema: databaseSchema,
  migrationsTableName: 'migrations',
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
};

export class SchemaAwareDataSource extends DataSource {
  override async initialize(): Promise<this> {
    await super.initialize();

    try {
      await ensureDatabaseSchema(this);
      return this;
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }
}

export default new SchemaAwareDataSource(options);
