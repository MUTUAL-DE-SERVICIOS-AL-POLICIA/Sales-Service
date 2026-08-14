import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SaleProductDto } from './create-sale.dto';

export enum BcbQrStatus {
  PROCESADO = 'PROCESADO',
  RECHAZADO = 'RECHAZADO',
  NO_PROCESADO = 'NO PROCESADO',
}

export const BCB_QR_STATUSES: BcbQrStatus[] = Object.values(BcbQrStatus);

export class BcbQrDataDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  titularDestinatario: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  ciNitDestinatario: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  eif: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  cuentaDestino: string;

  @IsOptional()
  @IsObject()
  cuentaDestinoDistribucion?: Record<string, number>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  codMoneda: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  glosa?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(19)
  fechaVencimiento: string;

  @IsBoolean()
  unicoUso: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  codigoServicio: string;

  @IsObject()
  metaData: Record<string, unknown>;
}

export class GenerateQrDto {
  @IsInt()
  @IsPositive()
  personId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  receptionist: string;

  @IsInt()
  @IsPositive()
  paymentTypeId: number;

  @IsInt()
  @IsPositive()
  parameterId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleProductDto)
  saleProducts: SaleProductDto[];
}

export class GetQrCodeStatusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  qrId: string;
}

export class BcbPaymentNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  idQR: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  idOrdenDestinatario?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  eif: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ciNitOriginante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombreOriginante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cuentaOrigen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  eifOrigen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  tipoNotificacion?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  codMoneda: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  importe?: number;

  @IsString()
  @IsIn(BCB_QR_STATUSES)
  estado: BcbQrStatus;

  @IsObject()
  metaData: Record<string, unknown>;
}
