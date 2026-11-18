import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { SaleProduct } from './sale-product.entity';

@Entity('sale_product_file_numbers')
@Unique('UQ_sale_product_file_numbers_product_number', [
  'productId',
  'fileNumber',
])
@Check(
  'CHK_sale_product_file_numbers_format',
  '"file_number" ~ \'^[0-9]{8}-[0-9]{4}$\'',
)
@Index('IDX_sale_product_file_numbers_sale_product_product', [
  'saleProductId',
  'productId',
])
@Index('IDX_sale_product_file_numbers_product_management_sequence', {
  synchronize: false,
})
@Index('IDX_sale_product_file_numbers_active_sale_product', ['saleProductId'], {
  where: '"deleted_at" IS NULL',
})
export class SaleProductFileNumber {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'sale_product_id', type: 'int' })
  saleProductId: number;

  @OneToOne(() => SaleProduct, (saleProduct) => saleProduct.fileNumber, {
  nullable: false,
  onDelete: 'NO ACTION',
})
  @JoinColumn([
    {
      name: 'sale_product_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_sale_product_file_numbers_sale_product',
    },
    {
      name: 'product_id',
      referencedColumnName: 'productId',
      foreignKeyConstraintName: 'FK_sale_product_file_numbers_sale_product',
    },
  ])
  saleProduct: SaleProduct;

  // Mantener el productId para no usar join y q sea O(1) en la validación de número de folder único por producto
  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'file_number', length: 13 })
  fileNumber: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
