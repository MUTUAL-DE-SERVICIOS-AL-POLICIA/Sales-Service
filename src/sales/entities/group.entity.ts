import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string; // 'FOLDERS', 'GASTOS ADMINISTRATIVOS'

  @Column({ length: 10, unique: true })
  shortened: string;

  @Column({ name: 'account_id', type: 'int' })
  accountId: number; // Referencia a contabilidad (Global Service)

  // Columna de cambio si el producto requiere número de folder
  @Column({ name: 'requires_file_number', type: 'boolean', default: false })
  requiresFileNumber: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => Product, (product) => product.group)
  products: Product[];
}
