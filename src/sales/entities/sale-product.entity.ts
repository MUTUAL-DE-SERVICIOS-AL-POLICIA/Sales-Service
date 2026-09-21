import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Sale } from './sale.entity';
import { Product } from './product.entity';
import { SaleProductFileNumber } from './sale-product-file-number.entity';

@Entity('sale_products')
@Unique('UQ_sale_products_id_product', ['id', 'productId'])
@Check('CHK_sale_products_price_non_negative', '"price" >= 0')
@Check('CHK_sale_products_amount_positive', '"amount" > 0')
@Check('CHK_sale_products_total_non_negative', '"total" >= 0')
@Index('IDX_sale_products_sale_id', ['sale'])
@Index('IDX_sale_products_product_id', ['productId'])
export class SaleProduct {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Sale, (sale) => sale.saleProducts, {
    nullable: false,
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'sale_id' })
  sale: Sale;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => Product, (product) => product.saleProducts, {
    nullable: false,
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'name', length: 150 })
  name: string;

  @Column({ name: 'price', type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ name: 'amount', type: 'int' })
  amount: number;

  @Column({ name: 'total', type: 'decimal', precision: 10, scale: 2 })
  total: number;

  @Column({ name: 'requires_file_number', type: 'boolean' })
  requiresFileNumber: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToOne(
    () => SaleProductFileNumber,
    (fileNumber) => fileNumber.saleProduct,
  )
  fileNumber: SaleProductFileNumber;
}
