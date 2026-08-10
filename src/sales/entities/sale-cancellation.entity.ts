import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Sale } from './sale.entity';

@Entity('sale_cancellations')
@Unique('UQ_sale_cancellations_sale_id', ['sale'])
@Check(
  'CHK_sale_cancellations_reason_not_blank',
  'char_length(btrim("reason")) > 0',
)
@Check(
  'CHK_sale_cancellations_cancelled_by_user_not_blank',
  'char_length(btrim("cancelled_by_user")) > 0',
)
export class SaleCancellation {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => Sale, (sale) => sale.cancellation, {
    nullable: false,
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'sale_id' })
  sale: Sale;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ name: 'cancelled_by_user', type: 'varchar', length: 100 })
  cancelledByUser: string;

  @Column({ name: 'cancelled_at', type: 'timestamptz' })
  cancelledAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
