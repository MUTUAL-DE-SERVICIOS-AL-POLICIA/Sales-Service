import { dbEnvs } from "src/config";
import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
  TableUnique,
} from "typeorm";

const GROUPS = [
  {
    id: 1,
    name: "Gastos Administrativos",
    shortened: "GA",
    accountId: 1,
    requiresFileNumber: false,
  },
  {
    id: 2,
    name: "Folders",
    shortened: "FO",
    accountId: 1,
    requiresFileNumber: true,
  },
] as const;

const PRODUCTS = [
  {
    id: 1,
    name: "Folder de Complemento Económico",
    code: "F-CE",
    price: 25,
    groupId: 2,
  },
  {
    id: 2,
    name: "Folder de Fondo de Retiro",
    code: "F-FR",
    price: 25,
    groupId: 2,
  },
  {
    id: 3,
    name: "Folder de Cuota Mortuoria",
    code: "F-CM",
    price: 25,
    groupId: 2,
  },
  {
    id: 4,
    name: "Folder de Auxilio Mortuorio",
    code: "F-AM",
    price: 25,
    groupId: 2,
  },
  {
    id: 5,
    name: "Gastos Administrativos Sector Activo",
    code: "F-PA",
    price: 25,
    groupId: 1,
  },
  {
    id: 6,
    name: "Gastos Administrativos Sector Pasivo",
    code: "F-PP",
    price: 15,
    groupId: 1,
  },
] as const;

const PAYMENT_TYPES = [
  { id: 1, name: "Efectivo", description: "Pago personal", shortened: "EF" },
  { id: 2, name: "Código QR", description: "Código por QR", shortened: "QR" },
  {
    id: 3,
    name: "Depósito",
    description: "Depósito Bancario",
    shortened: "DEP",
  },
] as const;

const PARAMETER = {
  id: 1,
  maxAmountProduct: 1,
  maxProducts: 1,
  currencySymbol: "bs",
  isActive: true,
} as const;

export class CreateSalesSchemaAndCoreTables1763052000000
  implements MigrationInterface
{
  name = "CreateSalesSchemaAndCoreTables1763052000000";

  private readonly schema = dbEnvs.dbSchema;
  private readonly saleStateEnumName = "sale_state_enum";
  private readonly saleStateEnumPath = `"${this.schema}"."${this.saleStateEnumName}"`;
  private readonly paymentTypeStateEnumName = "payment_type_state_enum";
  private readonly paymentTypeStateEnumPath = `"${this.schema}"."${this.paymentTypeStateEnumName}"`;
  private readonly qrStatusEnumName = "qr_status_enum";
  private readonly qrStatusEnumPath = `"${this.schema}"."${this.qrStatusEnumName}"`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createSchema(this.schema, true);
    await this.createSaleStateEnum(queryRunner);
    await this.createPaymentTypeStateEnum(queryRunner);
    await this.createQrStatusEnum(queryRunner);
    await this.createGroupsTable(queryRunner);
    await this.createParametersTable(queryRunner);
    await this.createProductsTable(queryRunner);
    await this.createPaymentTypesTable(queryRunner);
    await this.createSalesTable(queryRunner);
    await this.createSaleCancellationsTable(queryRunner);
    await this.createVouchersTable(queryRunner);
    await this.createQrPaymentSalesTable(queryRunner);
    await this.createSaleProductsTable(queryRunner);
    await this.createSaleProductFileNumbersTable(queryRunner);
    await this.seedCatalogs(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      await queryRunner.hasTable(`${this.schema}.sale_product_file_numbers`)
    ) {
      await queryRunner.dropTable(
        `${this.schema}.sale_product_file_numbers`,
        true,
        true,
        true
      );
    }

    if (await queryRunner.hasTable(`${this.schema}.sale_products`)) {
      await queryRunner.dropTable(
        `${this.schema}.sale_products`,
        true,
        true,
        true
      );
    }

    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "${this.schema}"."validate_sale_product_file_number_count"()`
    );

    if (await queryRunner.hasTable(`${this.schema}.qr_payment_sales`)) {
      await queryRunner.dropTable(
        `${this.schema}.qr_payment_sales`,
        true,
        true,
        true
      );
    }

    if (await queryRunner.hasTable(`${this.schema}.vouchers`)) {
      await queryRunner.dropTable(`${this.schema}.vouchers`, true, true, true);
    }

    if (await queryRunner.hasTable(`${this.schema}.sale_cancellations`)) {
      await queryRunner.dropTable(
        `${this.schema}.sale_cancellations`,
        true,
        true,
        true
      );
    }

    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "${this.schema}"."prevent_sale_cancellation_mutation"()`
    );

    if (await queryRunner.hasTable(`${this.schema}.sales`)) {
      await queryRunner.dropTable(`${this.schema}.sales`, true, true, true);
    }

    if (await queryRunner.hasTable(`${this.schema}.payment_types`)) {
      await queryRunner.dropTable(
        `${this.schema}.payment_types`,
        true,
        true,
        true
      );
    }

    if (await queryRunner.hasTable(`${this.schema}.products`)) {
      await queryRunner.dropTable(`${this.schema}.products`, true, true, true);
    }

    if (await queryRunner.hasTable(`${this.schema}.parameters`)) {
      await queryRunner.dropTable(
        `${this.schema}.parameters`,
        true,
        true,
        true
      );
    }

    if (await queryRunner.hasTable(`${this.schema}.groups`)) {
      await queryRunner.dropTable(`${this.schema}.groups`, true, true, true);
    }

    await queryRunner.query(`DROP TYPE IF EXISTS ${this.qrStatusEnumPath}`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS ${this.paymentTypeStateEnumPath}`
    );
    await queryRunner.query(`DROP TYPE IF EXISTS ${this.saleStateEnumPath}`);
  }

  private async createSaleStateEnum(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = '${this.saleStateEnumName}'
            AND n.nspname = '${this.schema}'
        ) THEN
          CREATE TYPE ${this.saleStateEnumPath} AS ENUM (
            'VIGENTE',
            'PENDIENTE',
            'ANULADO'
          );
        END IF;
      END $$;`
    );
  }

  private async createPaymentTypeStateEnum(
    queryRunner: QueryRunner
  ): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = '${this.paymentTypeStateEnumName}'
            AND n.nspname = '${this.schema}'
        ) THEN
          CREATE TYPE ${this.paymentTypeStateEnumPath} AS ENUM (
            'PAGADO',
            'GENERADO',
            'RECHAZADO'
          );
        END IF;
      END $$;`
    );
  }

  private async createQrStatusEnum(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = '${this.qrStatusEnumName}'
            AND n.nspname = '${this.schema}'
        ) THEN
          CREATE TYPE ${this.qrStatusEnumPath} AS ENUM (
            'PENDIENTE',
            'PAGADO',
            'RECHAZADO',
            'EXPIRADO'
          );
        END IF;
      END $$;`
    );
  }

  private async createGroupsTable(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.groups`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "groups",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "name",
            type: "varchar",
            length: "100",
            isNullable: false,
          },
          {
            name: "account_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "shortened",
            type: "varchar",
            length: "10",
            isNullable: false,
            isUnique: true,
          },
          {
            name: "requires_file_number",
            type: "boolean",
            default: false,
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
      })
    );
  }

  private async createParametersTable(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.parameters`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "parameters",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "max_amount_product",
            type: "int",
            default: "1",
            isNullable: false,
          },
          {
            name: "max_products",
            type: "int",
            default: "1",
            isNullable: false,
          },
          {
            name: "currency_symbol",
            type: "varchar",
            length: "4",
            isNullable: false,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        checks: [
          new TableCheck({
            name: "CHK_parameters_max_amount_product_positive",
            expression: '"max_amount_product" > 0',
          }),
          new TableCheck({
            name: "CHK_parameters_max_products_positive",
            expression: '"max_products" > 0',
          }),
        ],
      })
    );
  }

  private async createProductsTable(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.products`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "products",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "name",
            type: "varchar",
            length: "150",
            isNullable: false,
          },
          {
            name: "code",
            type: "varchar",
            length: "20",
            isNullable: false,
            isUnique: true,
          },
          {
            name: "price",
            type: "decimal",
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
            isNullable: false,
          },
          {
            name: "group_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        checks: [
          new TableCheck({
            name: "CHK_products_price_non_negative",
            expression: '"price" >= 0',
          }),
        ],
      })
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_group_id"
       ON "${this.schema}"."products" ("group_id")`
    );

    await queryRunner.createForeignKey(
      `${this.schema}.products`,
      new TableForeignKey({
        columnNames: ["group_id"],
        referencedSchema: this.schema,
        referencedTableName: "groups",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      })
    );
  }

  private async createPaymentTypesTable(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.payment_types`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "payment_types",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "name",
            type: "varchar",
            length: "100",
            isNullable: false,
          },
          {
            name: "description",
            type: "varchar",
            length: "255",
            isNullable: false,
          },
          {
            name: "shortened",
            type: "varchar",
            length: "10",
            isNullable: false,
            isUnique: true,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
      })
    );
  }

  private async createSalesTable(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.sales`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "sales",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "code",
            type: "varchar",
            length: "20",
            isNullable: false,
            isUnique: true,
          },
          {
            name: "sale_state",
            type: this.saleStateEnumPath,
            default: `'PENDIENTE'::${this.saleStateEnumPath}`,
            isNullable: false,
          },
          {
            name: "person_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "receptionist",
            type: "varchar",
            length: "100",
            isNullable: false,
          },
          {
            name: "transaccion_id",
            type: "varchar",
            length: "50",
            isNullable: true,
          },
          {
            name: "parameter_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        checks: [
          new TableCheck({
            name: "CHK_sales_code_format",
            expression: `"code" ~ '^VEN[0-9]{8}/[0-9]{4}$'`,
          }),
        ],
      })
    );

    await queryRunner.createForeignKeys(`${this.schema}.sales`, [
      new TableForeignKey({
        columnNames: ["parameter_id"],
        referencedSchema: this.schema,
        referencedTableName: "parameters",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      }),
    ]);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sales_parameter_id"
       ON "${this.schema}"."sales" ("parameter_id")`
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_transaction_id"
       ON "${this.schema}"."sales" ("transaccion_id")
       WHERE "transaccion_id" IS NOT NULL`
    );
  }

  private async createSaleCancellationsTable(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.sale_cancellations`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "sale_cancellations",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "sale_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "reason",
            type: "varchar",
            length: "500",
            isNullable: false,
          },
          {
            name: "cancelled_by_user",
            type: "varchar",
            length: "100",
            isNullable: false,
          },
          {
            name: "cancelled_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        uniques: [
          new TableUnique({
            name: "UQ_sale_cancellations_sale_id",
            columnNames: ["sale_id"],
          }),
        ],
        checks: [
          new TableCheck({
            name: "CHK_sale_cancellations_reason_not_blank",
            expression: 'char_length(btrim("reason")) > 0',
          }),
          new TableCheck({
            name: "CHK_sale_cancellations_cancelled_by_user_not_blank",
            expression: 'char_length(btrim("cancelled_by_user")) > 0',
          }),
        ],
      })
    );

    await queryRunner.createForeignKey(
      `${this.schema}.sale_cancellations`,
      new TableForeignKey({
        name: "FK_sale_cancellations_sale",
        columnNames: ["sale_id"],
        referencedSchema: this.schema,
        referencedTableName: "sales",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      })
    );

    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "${this.schema}"."prevent_sale_cancellation_mutation"()
       RETURNS TRIGGER
       LANGUAGE plpgsql
       AS $$
       BEGIN
         RAISE EXCEPTION
           'Los registros de anulación de ventas son inmutables';
       END;
       $$`
    );

    await queryRunner.query(
      `CREATE TRIGGER "TRG_prevent_sale_cancellation_mutation"
       BEFORE UPDATE OR DELETE OR TRUNCATE
       ON "${this.schema}"."sale_cancellations"
       FOR EACH STATEMENT
       EXECUTE FUNCTION "${this.schema}"."prevent_sale_cancellation_mutation"()`
    );
  }

  private async createVouchersTable(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.vouchers`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "vouchers",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "sale_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "customer",
            type: "varchar",
            length: "150",
            isNullable: true,
          },
          {
            name: "identity_card_customer",
            type: "varchar",
            length: "20",
            isNullable: true,
          },
          {
            name: "payment_location",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "receipt_number",
            type: "varchar",
            length: "50",
            isNullable: true,
          },
          {
            name: "description",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "payment_type_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "payment_type_state",
            type: this.paymentTypeStateEnumPath,
            default: `'GENERADO'::${this.paymentTypeStateEnumPath}`,
            isNullable: false,
          },
          {
            name: "deposit_date",
            type: "timestamptz",
            isNullable: true,
          },
          {
            name: "total",
            type: "decimal",
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        checks: [
          new TableCheck({
            name: "CHK_vouchers_total_non_negative",
            expression: '"total" >= 0',
          }),
        ],
        uniques: [
          new TableUnique({
            name: "UQ_vouchers_sale_id",
            columnNames: ["sale_id"],
          }),
        ],
      })
    );

    await queryRunner.createForeignKeys(`${this.schema}.vouchers`, [
      new TableForeignKey({
        columnNames: ["sale_id"],
        referencedSchema: this.schema,
        referencedTableName: "sales",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      }),
      new TableForeignKey({
        columnNames: ["payment_type_id"],
        referencedSchema: this.schema,
        referencedTableName: "payment_types",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      }),
    ]);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vouchers_payment_type_id"
       ON "${this.schema}"."vouchers" ("payment_type_id")`
    );
  }

  private async createQrPaymentSalesTable(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.qr_payment_sales`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "qr_payment_sales",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "person_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "qr_id",
            type: "varchar",
            length: "50",
            isNullable: false,
            isUnique: true,
          },
          {
            name: "data_response",
            type: "jsonb",
            isNullable: false,
          },
          {
            name: "qr_status",
            type: this.qrStatusEnumPath,
            default: `'PENDIENTE'::${this.qrStatusEnumPath}`,
            isNullable: false,
          },
          {
            name: "expiration_date_qr",
            type: "timestamptz",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
      })
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_qr_payment_sales_person_id_expiration_date_qr"
       ON "${this.schema}"."qr_payment_sales" ("person_id", "expiration_date_qr")`
    );
  }

  private async createSaleProductsTable(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (await queryRunner.hasTable(`${this.schema}.sale_products`)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "sale_products",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "product_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "name",
            type: "varchar",
            length: "150",
            isNullable: false,
          },
          {
            name: "price",
            type: "decimal",
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: "amount",
            type: "int",
            isNullable: false,
          },
          {
            name: "total",
            type: "decimal",
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: "sale_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "requires_file_number",
            type: "boolean",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        uniques: [
          new TableUnique({
            name: "UQ_sale_products_id_product",
            columnNames: ["id", "product_id"],
          }),
        ],
        checks: [
          new TableCheck({
            name: "CHK_sale_products_price_non_negative",
            expression: '"price" >= 0',
          }),
          new TableCheck({
            name: "CHK_sale_products_amount_positive",
            expression: '"amount" > 0',
          }),
          new TableCheck({
            name: "CHK_sale_products_total_non_negative",
            expression: '"total" >= 0',
          }),
        ],
      })
    );

    await queryRunner.createForeignKeys(`${this.schema}.sale_products`, [
      new TableForeignKey({
        columnNames: ["product_id"],
        referencedSchema: this.schema,
        referencedTableName: "products",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      }),
      new TableForeignKey({
        columnNames: ["sale_id"],
        referencedSchema: this.schema,
        referencedTableName: "sales",
        referencedColumnNames: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      }),
    ]);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sale_products_sale_id"
       ON "${this.schema}"."sale_products" ("sale_id")`
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sale_products_product_id"
       ON "${this.schema}"."sale_products" ("product_id")`
    );
  }

  private async createSaleProductFileNumbersTable(
    queryRunner: QueryRunner
  ): Promise<void> {
    if (
      await queryRunner.hasTable(`${this.schema}.sale_product_file_numbers`)
    ) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        schema: this.schema,
        name: "sale_product_file_numbers",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "sale_product_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "product_id",
            type: "int",
            isNullable: false,
          },
          {
            name: "file_number",
            type: "varchar",
            length: "13",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updated_at",
            type: "timestamptz",
            default: "now()",
            isNullable: false,
          },
          {
            name: "deleted_at",
            type: "timestamptz",
            isNullable: true,
          },
        ],
        checks: [
          new TableCheck({
            name: "CHK_sale_product_file_numbers_format",
            expression: "\"file_number\" ~ '^[0-9]{8}-[0-9]{4}$'",
          }),
        ],
        uniques: [
          new TableUnique({
            name: "UQ_sale_product_file_numbers_product_number",
            columnNames: ["product_id", "file_number"],
          }),
        ],
      })
    );

    await queryRunner.createForeignKey(
      `${this.schema}.sale_product_file_numbers`,
      new TableForeignKey({
        name: "FK_sale_product_file_numbers_sale_product",
        columnNames: ["sale_product_id", "product_id"],
        referencedSchema: this.schema,
        referencedTableName: "sale_products",
        referencedColumnNames: ["id", "product_id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      })
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sale_product_file_numbers_sale_product_product"
       ON "${this.schema}"."sale_product_file_numbers" (
         "sale_product_id",
         "product_id"
       )`
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sale_product_file_numbers_active_sale_product"
       ON "${this.schema}"."sale_product_file_numbers" ("sale_product_id")
       WHERE "deleted_at" IS NULL`
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sale_product_file_numbers_product_management_sequence"
       ON "${this.schema}"."sale_product_file_numbers" (
         "product_id",
         (RIGHT("file_number", 4)),
         (LEFT("file_number", 8)) DESC
       )`
    );

    await this.createSaleProductFileNumberCountConstraint(queryRunner);
  }

  private async createSaleProductFileNumberCountConstraint(
    queryRunner: QueryRunner
  ): Promise<void> {
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "${this.schema}"."validate_sale_product_file_number_count"()
       RETURNS TRIGGER
       LANGUAGE plpgsql
       AS $$
       DECLARE
         target_sale_product_id int;
         expected_amount int;
         requires_file_number boolean;
         parent_deleted_at timestamptz;
         actual_amount int;
       BEGIN
         IF TG_TABLE_NAME = 'sale_product_file_numbers' THEN
           IF TG_OP = 'UPDATE' THEN
             IF OLD.sale_product_id IS DISTINCT FROM NEW.sale_product_id
               OR OLD.product_id IS DISTINCT FROM NEW.product_id THEN
               RAISE EXCEPTION
                 'No se puede reasignar un número de folder a otro sale_product o producto';
             END IF;
           END IF;
         END IF;

         IF TG_TABLE_NAME = 'sale_products' THEN
           IF TG_OP = 'DELETE' THEN
             target_sale_product_id := OLD.id;
           ELSE
             target_sale_product_id := NEW.id;
           END IF;
         ELSE
           IF TG_OP = 'DELETE' THEN
             target_sale_product_id := OLD.sale_product_id;
           ELSE
             target_sale_product_id := NEW.sale_product_id;
           END IF;
         END IF;

         SELECT
           sp."amount",
           sp."requires_file_number",
           sp."deleted_at"
         INTO
           expected_amount,
           requires_file_number,
           parent_deleted_at
         FROM "${this.schema}"."sale_products" sp
         WHERE sp."id" = target_sale_product_id
         FOR UPDATE;

         IF NOT FOUND THEN
           RETURN NULL;
         END IF;

         SELECT COUNT(*)::int
         INTO actual_amount
         FROM "${this.schema}"."sale_product_file_numbers" spfn
         WHERE spfn."sale_product_id" = target_sale_product_id
           AND spfn."deleted_at" IS NULL;

         IF parent_deleted_at IS NOT NULL THEN
           IF actual_amount <> 0 THEN
             RAISE EXCEPTION
               'El sale_product eliminado % no debe conservar números de folder activos',
               target_sale_product_id;
           END IF;

           RETURN NULL;
         END IF;

         IF requires_file_number AND actual_amount <> expected_amount THEN
           RAISE EXCEPTION
             'El sale_product % requiere % número(s) de folder y tiene %',
             target_sale_product_id,
             expected_amount,
             actual_amount;
         END IF;

         IF NOT requires_file_number AND actual_amount <> 0 THEN
           RAISE EXCEPTION
             'El sale_product % no debe tener números de folder',
             target_sale_product_id;
         END IF;

         RETURN NULL;
       END;
       $$`
    );

    await queryRunner.query(
      `CREATE CONSTRAINT TRIGGER "CTR_sale_products_file_number_count"
       AFTER INSERT OR UPDATE OR DELETE
       ON "${this.schema}"."sale_products"
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW
       EXECUTE FUNCTION "${this.schema}"."validate_sale_product_file_number_count"()`
    );

    await queryRunner.query(
      `CREATE CONSTRAINT TRIGGER "CTR_sale_product_file_numbers_count"
       AFTER INSERT OR UPDATE OR DELETE
       ON "${this.schema}"."sale_product_file_numbers"
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW
       EXECUTE FUNCTION "${this.schema}"."validate_sale_product_file_number_count"()`
    );
  }

  private async seedCatalogs(queryRunner: QueryRunner): Promise<void> {
    for (const group of GROUPS) {
      await queryRunner.query(
        `INSERT INTO "${this.schema}"."groups" (
          "id",
          "name",
          "shortened",
          "account_id",
          "requires_file_number"
        )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("id")
         DO UPDATE SET
           "name" = EXCLUDED."name",
           "shortened" = EXCLUDED."shortened",
           "account_id" = EXCLUDED."account_id",
           "requires_file_number" = EXCLUDED."requires_file_number"`,
        [
          group.id,
          group.name,
          group.shortened,
          group.accountId,
          group.requiresFileNumber,
        ]
      );
    }

    for (const product of PRODUCTS) {
      await queryRunner.query(
        `INSERT INTO "${this.schema}"."products" (
          "id",
          "name",
          "code",
          "price",
          "is_active",
          "group_id"
        )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("id")
         DO UPDATE SET
           "name" = EXCLUDED."name",
           "code" = EXCLUDED."code",
           "price" = EXCLUDED."price",
           "is_active" = EXCLUDED."is_active",
           "group_id" = EXCLUDED."group_id"`,
        [
          product.id,
          product.name,
          product.code,
          product.price,
          true,
          product.groupId,
        ]
      );
    }

    for (const paymentType of PAYMENT_TYPES) {
      await queryRunner.query(
        `INSERT INTO "${this.schema}"."payment_types" (
          "id",
          "name",
          "description",
          "shortened"
        )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("id")
         DO UPDATE SET
           "name" = EXCLUDED."name",
           "description" = EXCLUDED."description",
           "shortened" = EXCLUDED."shortened"`,
        [
          paymentType.id,
          paymentType.name,
          paymentType.description,
          paymentType.shortened,
        ]
      );
    }

    await queryRunner.query(
      `INSERT INTO "${this.schema}"."parameters" ("id", "max_amount_product", "max_products", "currency_symbol", "is_active")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("id")
       DO UPDATE SET
         "max_amount_product" = EXCLUDED."max_amount_product",
         "max_products" = EXCLUDED."max_products",
         "currency_symbol" = EXCLUDED."currency_symbol",
         "is_active" = EXCLUDED."is_active"`,
      [
        PARAMETER.id,
        PARAMETER.maxAmountProduct,
        PARAMETER.maxProducts,
        PARAMETER.currencySymbol,
        PARAMETER.isActive,
      ]
    );

    await this.syncSequence(queryRunner, "groups");
    await this.syncSequence(queryRunner, "products");
    await this.syncSequence(queryRunner, "parameters");
    await this.syncSequence(queryRunner, "payment_types");
  }

  private async syncSequence(
    queryRunner: QueryRunner,
    tableName: string
  ): Promise<void> {
    await queryRunner.query(
      `SELECT setval(
        pg_get_serial_sequence('"${this.schema}"."${tableName}"', 'id'),
        COALESCE((SELECT MAX("id") FROM "${this.schema}"."${tableName}"), 1),
        true
      )`
    );
  }
}
