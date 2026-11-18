import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum QrPaymentStatus {
  PENDIENTE = 'PENDIENTE',
  PAGADO = 'PAGADO',
  RECHAZADO = 'RECHAZADO',
  EXPIRADO = 'EXPIRADO',
}

@Entity('qr_payment_sales')
@Index('IDX_qr_payment_sales_person_id_expiration_date_qr', [
  'personId',
  'expirationDateQr',
])
export class QrPaymentSale {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'person_id', type: 'int' })
  personId: number;

  @Column({ name: 'qr_id', length: 50, unique: true })
  qrId: string;

  @Column({ name: 'data_response', type: 'jsonb' })
  dataResponse: Record<string, unknown>;

  @Column({
    name: 'qr_status',
    type: 'enum',
    enum: QrPaymentStatus,
    enumName: 'qr_status_enum',
    default: QrPaymentStatus.PENDIENTE,
  })
  qrStatus: QrPaymentStatus;

  @Column({ name: 'expiration_date_qr', type: 'timestamptz' })
  expirationDateQr: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
