export enum CollectionState {
  CONCILIADO = 'CONCILIADO',
  NO_CONCILIADO = 'NO CONCILIADO',
}

export interface CreateCollectionTransactionDto {
  paymentDate: string;
  titularName: string;
  payerName: string;
  description: string;
  origin: string;
  accountNumber: string;
  paymentType: string;
  receptionistUser: string;
  total: number;
  state: CollectionState;
}
