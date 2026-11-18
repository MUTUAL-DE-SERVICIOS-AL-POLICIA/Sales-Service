export enum SaleState {
  VIGENTE = 'VIGENTE',
  PENDIENTE = 'PENDIENTE',
  ANULADO = 'ANULADO',
}

import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Parameter } from './parameter.entity';
import { SaleProduct } from './sale-product.entity';
import { Voucher } from './voucher.entity';

@Entity('sales')
@Check('CHK_sales_code_format', '"code" ~ \'^VEN[0-9]{8}/[0-9]{4}$\'')
@Index('IDX_sales_parameter_id', ['parameter'])
@Index('UQ_sales_transaction_id', ['transactionId'], {
  unique: true,
  where: '"transaction_id" IS NOT NULL',
})
export class Sale {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 20, unique: true })
  code: string;

  @Column({
    name: 'sale_state',
    type: 'enum',
    enum: SaleState,
    enumName: 'sale_state_enum',
    default: SaleState.PENDIENTE,
  })
  saleState: SaleState = SaleState.PENDIENTE;

  @Column({ name: 'person_id', type: 'int' })
  personId: number;

  @Column({ name: 'full_name', length: 100 })
  fullName: string;

  @Column({ name: 'identity_card', length: 20 })
  identityCard: string;

  @Column({ name: 'nup', length: 20 })
  nup: string;

  @Column({ length: 100 })
  receptionist: string;

  @Column({ name: 'transaction_id', length: 50, nullable: true })
  transactionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => Parameter, (parameter) => parameter.sales, {
    nullable: false,
  })
  @JoinColumn({ name: 'parameter_id' })
  parameter: Parameter;

  @OneToOne(() => Voucher, (voucher) => voucher.sale)
  voucher: Voucher | null;

  @OneToMany(() => SaleProduct, (saleProduct) => saleProduct.sale, {
    cascade: true,
  })
  saleProducts: SaleProduct[];
}
