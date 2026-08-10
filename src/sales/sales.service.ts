import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { NatsService } from 'src/common';
import {
  Between,
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  Group,
  Parameter,
  PaymentType,
  PaymentTypeState,
  Product,
  QrPaymentSale,
  QrPaymentStatus,
  Sale,
  SaleCancellation,
  SaleProduct,
  SaleProductFileNumber,
  SaleState,
  Voucher,
} from './entities';
import {
  AccountLookupDataDto,
  BcbPaymentNotificationDto,
  BcbQrDataDto,
  CollectionState,
  CancelSaleDto,
  CreateCollectionTransactionDto,
  CreateSaleDto,
  GenerateQrDto,
  GetQrCodeStatusDto,
  GroupDataDto,
  NormalizedSaleProductDto,
  SalesListDto,
  SalesListItemReportDto,
} from './dto';

@Injectable()
export class SalesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SalesService');
  private readonly qrTempPath = 'temporalqr';
  private readonly qrExpirationMinutes = 15;
  private readonly qrExpirationSweepIntervalMs = 30_000;
  private readonly businessTimeZone = 'America/La_Paz';
  private qrExpirationTimer: NodeJS.Timeout | null = null;
  private qrExpirationSweepRunning = false;

  constructor(
    private readonly nats: NatsService,
    @InjectRepository(Group)
    private readonly groupsRepository: Repository<Group>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(PaymentType)
    private readonly paymentTypesRepository: Repository<PaymentType>,
    @InjectRepository(Parameter)
    private readonly parameterRepository: Repository<Parameter>,
    @InjectRepository(Sale)
    private readonly salesRepository: Repository<Sale>,
    @InjectRepository(SaleProduct)
    private readonly saleProductsRepository: Repository<SaleProduct>,
    @InjectRepository(QrPaymentSale)
    private readonly qrPaymentSaleRepository: Repository<QrPaymentSale>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    void this.runQrExpirationSweep();
    this.qrExpirationTimer = setInterval(
      () => void this.runQrExpirationSweep(),
      this.qrExpirationSweepIntervalMs,
    );
    this.qrExpirationTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.qrExpirationTimer) {
      clearInterval(this.qrExpirationTimer);
      this.qrExpirationTimer = null;
    }
  }

  async searchPerson(value: string, type: string): Promise<any> {
    try {
      const response: any = await this.nats.firstValue('person.search', {
        value,
        type,
      });

      if (!response?.serviceStatus) {
        return {
          error: true,
          message: 'Servicio de Beneficiarios no disponible',
          data: null,
        };
      }

      return {
        error: response.error ?? false,
        message: response.message ?? 'Búsqueda de beneficiarios completada',
        data: response.data ?? null,
      };
    } catch (error) {
      this.logError('Error al buscar beneficiarios', error);

      return {
        error: true,
        message: 'Servicio de Beneficiarios no disponible',
        data: null,
      };
    }
  }

  async groups(): Promise<any> {
    try {
      const groups = await this.groupsRepository.find({
        select: {
          id: true,
          name: true,
          shortened: true,
          accountId: true,
        },
      });

      if (groups.length === 0) {
        return {
          error: false,
          message: 'Grupos obtenidos correctamente',
          data: [],
        };
      }

      const accountIds = [
        ...new Set(
          groups
            .map((g) => g.accountId)
            .filter((id) => id !== null && id !== undefined),
        ),
      ];

      const accountMap = await this.getAccountLookupMap(accountIds);

      const enrichedGroups: GroupDataDto[] = groups.map((group) => {
        const account = accountMap.get(group.accountId);

        return {
          id: group.id,
          name: group.name,
          shortened: group.shortened,
          accountName: account ? account.name : null,
          accountNumber: account ? account.accountNumber : null,
        };
      });

      return {
        error: false,
        message: 'Grupos obtenidos correctamente',
        data: enrichedGroups,
      };
    } catch (error) {
      this.logError('Error al obtener grupos', error);

      return {
        error: true,
        message: 'Error al obtener grupos',
        data: null,
      };
    }
  }

  private async getAccountLookupMap(
    accountIds: number[],
  ): Promise<
    Map<number, { name: string | null; accountNumber: string | null }>
  > {
    const accountMap = new Map<
      number,
      { name: string | null; accountNumber: string | null }
    >();

    if (accountIds.length === 0) {
      return accountMap;
    }

    try {
      const response: any = await this.nats.firstValue(
        'accounts.findAllByIds',
        {
          ids: accountIds,
          columns: ['id', 'name', 'accountNumber'],
        },
      );
      const accounts: AccountLookupDataDto[] = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : [];

      if (!response?.serviceStatus || accounts.length === 0) {
        this.logger.warn(
          'No se pudo obtener información de las cuentas o el formato de respuesta no fue correcto.',
        );
        return accountMap;
      }

      accounts.forEach((account) => {
        if (account?.id !== undefined) {
          accountMap.set(account.id, {
            name: account.name ?? null,
            accountNumber: account.accountNumber ?? null,
          });
        }
      });
    } catch (error) {
      this.logError('Error al obtener cuentas', error);
    }

    return accountMap;
  }

  async productsGroup(groupId: number): Promise<any> {
    try {
      const parsedGroupId = Number(groupId);

      if (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0) {
        return {
          error: true,
          message: 'El id del grupo debe ser un número entero mayor a cero',
          data: null,
        };
      }

      const group = await this.groupsRepository.findOne({
        where: { id: parsedGroupId },
        select: { id: true },
      });

      if (!group) {
        return {
          error: true,
          message: `El grupo con id ${parsedGroupId} no existe`,
          data: null,
        };
      }

      const products = await this.productsRepository.find({
        where: { group: { id: parsedGroupId } },
        select: {
          id: true,
          name: true,
          code: true,
          price: true,
        },
      });

      if (!products.length) {
        return {
          error: false,
          message: `El grupo con id ${parsedGroupId} no contiene productos`,
          data: [],
        };
      }

      return {
        error: false,
        message: 'Productos obtenidos correctamente',
        data: products.map((product) => ({
          id: product.id,
          name: product.name,
          code: product.code,
          price: String(product.price),
        })),
      };
    } catch (error) {
      this.logError('Error al obtener los productos de un grupo', error);

      return {
        error: true,
        message: 'Error al obtener los productos de un grupo',
        data: null,
      };
    }
  }

  async parameters(): Promise<any> {
    try {
      const activeParameters = await this.parameterRepository.find({
        where: { isActive: true },
        select: {
          id: true,
          maxAmountProduct: true,
          maxProducts: true,
          currencySymbol: true,
          isActive: true,
        },
        order: { id: 'ASC' },
        take: 2,
      });

      if (activeParameters.length === 0) {
        return {
          error: true,
          message: 'No existe un parámetro activo para crear la venta',
          data: null,
        };
      }

      if (activeParameters.length > 1) {
        return {
          error: true,
          message: 'Hay más de un parámetro activo. Solo debe existir uno.',
          data: null,
        };
      }

      return {
        error: false,
        message: 'Parámetro obtenido correctamente',
        data: {
          id: activeParameters[0].id,
          maxAmountProduct: activeParameters[0].maxAmountProduct,
          maxProducts: activeParameters[0].maxProducts,
          currencySymbol: activeParameters[0].currencySymbol,
          isActive: activeParameters[0].isActive,
        },
      };
    } catch (error) {
      this.logError('Error al obtener parámetro', error);

      return {
        error: true,
        message: 'Error al obtener parámetro',
        data: null,
      };
    }
  }

  async paymentTypes(): Promise<any> {
    try {
      const paymentTypes = await this.paymentTypesRepository.find({
        select: {
          id: true,
          name: true,
          description: true,
          shortened: true,
        },
      });
      return {
        error: false,
        message: 'Tipos de pago obtenidos correctamente',
        data: paymentTypes,
      };
    } catch (error) {
      this.logError('Error al obtener tipos de pago', error);

      return {
        error: true,
        message: 'Error al obtener tipos de pago',
        data: null,
      };
    }
  }

  async accounts(): Promise<any> {
    try {
      const response: any = await this.nats.firstValue('accounts.findAll', {});

      if (!response?.serviceStatus) {
        return {
          error: true,
          message: 'Servicio de cuentas no disponible',
          data: null,
        };
      }

      return {
        error: response.error ?? false,
        message: response.message ?? 'Cuentas obtenidas correctamente',
        data: response.data ?? null,
      };
    } catch (error) {
      this.logError('Error al obtener cuentas', error);

      return {
        error: true,
        message: 'Servicio de cuentas no disponible',
        data: null,
      };
    }
  }

  async dataForSale(): Promise<any> {
    try {
      const [paymentTypesResult] = await Promise.all([this.paymentTypes()]);

      const error = paymentTypesResult.error;

      if (error) {
        const messages = [
          paymentTypesResult.error ? paymentTypesResult.message : null,
        ]
          .filter(Boolean)
          .join('; ');

        return {
          error: true,
          message: `Error al obtener datos para la venta: ${messages}`,
          data: null,
        };
      }

      return {
        error: false,
        message: 'Datos para la venta obtenidos correctamente',
        data: {
          paymentTypes: paymentTypesResult.data,
        },
      };
    } catch (error) {
      this.logError('Error al obtener datos para la venta', error);

      return {
        error: true,
        message: 'Error al obtener datos para la venta',
        data: null,
      };
    }
  }

  async personDetails(personUuid: string): Promise<any> {
    try {
      if (!personUuid) {
        return {
          error: true,
          message: 'Seleccione una persona para crear la venta.',
          data: null,
        };
      }

      return this.fetchPersonForCreatingSale(
        'person.findOneWithFeatures',
        { uuid: personUuid },
        personUuid,
      );
    } catch (error) {
      this.logError('Error en personDetails', error);

      return {
        error: true,
        message: 'No se pudo validar la persona seleccionada.',
        data: null,
      };
    }
  }

  private async personDetailsById(personId: number): Promise<any> {
    try {
      if (!Number.isInteger(personId) || personId <= 0) {
        return {
          error: true,
          message: 'Seleccione una persona para crear la venta.',
          data: null,
        };
      }

      return this.fetchPersonForCreatingSale('person.findForCreatingSaleById', {
        id: personId,
      });
    } catch (error) {
      this.logError('Error en personDetailsById', error);

      return {
        error: true,
        message: 'No se pudo validar la persona seleccionada.',
        data: null,
      };
    }
  }

  private async fetchPersonForCreatingSale(
    pattern: string,
    payload: any,
    uuidColumn?: string,
  ): Promise<any> {
    const personResponse: any = await this.nats.firstValue(pattern, payload);

    if (!personResponse?.serviceStatus) {
      return {
        error: true,
        message:
          'No se pudo validar la persona seleccionada. Intente nuevamente.',
        data: null,
      };
    }

    if (personResponse.error) {
      return {
        error: true,
        message:
          personResponse.message ??
          'No se pudo validar la persona seleccionada.',
        data: null,
      };
    }

    const person: any = personResponse.data ?? personResponse;

    return {
      error: false,
      message: 'Datos de la persona obtenidos correctamente',
      data: this.mapPersonForCreatingSale(person, uuidColumn),
    };
  }

  private mapPersonForCreatingSale(person: any, uuidColumn?: string): any {
    const affiliate = person.personAffiliates?.find(
      (item: { type?: string; typeId?: number }) => item.type === 'affiliates',
    );

    return {
      id: person.id,
      uuidColumn: uuidColumn ?? person.uuidColumn,
      fullName:
        person.fullName ??
        [
          person.firstName,
          person.secondName,
          person.lastName,
          person.mothersLastName,
        ]
          .filter(Boolean)
          .join(' '),
      identityCard: person.identityCard ?? '',
      nup: person.nup ?? affiliate?.typeId ?? null,
      isPolice: person.features?.isPolice ?? Boolean(affiliate),
    };
  }

  async forCreatingSale(personUuid: string): Promise<any> {
    try {
      if (!personUuid) {
        return {
          error: true,
          message: 'El uuid de la persona es requerido',
          data: null,
        };
      }

      const [personResult, groupsResult, parametersResult, paymentTypesResult] =
        await Promise.all([
          this.personDetails(personUuid),
          this.groups(),
          this.parameters(),
          this.paymentTypes(),
        ]);

      if (
        personResult.error ||
        groupsResult.error ||
        parametersResult.error ||
        paymentTypesResult.error
      ) {
        const messages = [
          personResult.error ? personResult.message : null,
          groupsResult.error ? groupsResult.message : null,
          parametersResult.error ? parametersResult.message : null,
          paymentTypesResult.error ? paymentTypesResult.message : null,
        ]
          .filter(Boolean)
          .join('; ');

        return {
          error: true,
          message: `Error al obtener datos para crear la venta: ${messages}`,
          data: null,
        };
      }

      return {
        error: false,
        message: 'Datos para crear la venta obtenidos correctamente',
        data: {
          person: personResult.data,
          groups: groupsResult.data ?? [],
          parameters: parametersResult.data,
          paymentTypes: paymentTypesResult.data ?? [],
        },
      };
    } catch (error) {
      this.logError('Error al obtener datos para crear la venta', error);

      return {
        error: true,
        message: 'Error al obtener datos para crear la venta',
        data: null,
      };
    }
  }

  async generateQr(payload: GenerateQrDto): Promise<any> {
    try {
      await this.expirePendingQrPayments();

      const saleContext = await this.validateSaleInput(payload);

      if (saleContext.error) {
        return saleContext;
      }

      if (!this.isQrPaymentType(saleContext.paymentType)) {
        return {
          error: true,
          message: 'El tipo de pago seleccionado no corresponde a QR.',
          data: null,
        };
      }

      const qrData = await this.buildQrDataFromGlobalAccount(
        saleContext.products,
        saleContext.saleTotal,
        saleContext.normalizedProducts,
      );
      const qrDataErrors = this.validateBcbQrData(qrData);

      if (qrDataErrors.length > 0) {
        return {
          error: true,
          message: `Datos QR incompletos: ${qrDataErrors.join(', ')}`,
          data: null,
        };
      }

      const generatedQr = await this.generateBcbQr(
        this.buildBcbQrPayload(
          qrData,
          { id: null, personId: saleContext.personId },
          saleContext.saleTotal,
        ),
      );
      const qrId = String(generatedQr.datos.idQr);
      const qrImage = String(generatedQr.datos.imagenQr);
      const expirationDateQr =
        this.parseOptionalDate(qrData.fechaVencimientoQR) ??
        this.buildDefaultQrExpiration();
      await this.saveTemporaryQrImage(qrId, qrImage, expirationDateQr);

      await this.qrPaymentSaleRepository.save(
        this.qrPaymentSaleRepository.create({
          personId: saleContext.personId,
          qrId,
          dataResponse: {
            personId: saleContext.personId,
            receptionist: saleContext.receptionist,
            paymentTypeId: saleContext.paymentTypeId,
            parameterId: saleContext.parameterId,
            saleProducts: this.mapInputSaleProducts(payload.saleProducts),
            total: saleContext.saleTotal,
            currency: qrData.codMoneda,
            accountNumber: qrData.accountNumber,
            glosa: qrData.glosa,
          },
          qrStatus: QrPaymentStatus.PENDIENTE,
          expirationDateQr,
        }),
      );

      const data = {
        personId: saleContext.personId,
        paymentTypeId: saleContext.paymentTypeId,
        destinationAccount: qrData.destinationAccount,
        accountNumber: qrData.accountNumber,
        ctaDestino: qrData.ctaDestino,
        fechaVencimientoQR: qrData.fechaVencimientoQR,
        bcbQrId: qrId,
        total: saleContext.saleTotal,
        qrImage,
        qrStatus: QrPaymentStatus.PENDIENTE,
        expirationDateQr: this.formatDate(expirationDateQr),
      };

      return {
        error: false,
        message: 'QR generado correctamente',
        data,
      };
    } catch (error) {
      this.logError('Error en la generación de QR', error);

      return {
        error: true,
        message: 'Error al generar el QR.',
        data: null,
      };
    }
  }

  async createSale(payload: CreateSaleDto): Promise<any> {
    try {
      const saleContext = await this.validateSaleInput(payload);

      if (saleContext.error) {
        return saleContext;
      }

      if (this.isQrPaymentType(saleContext.paymentType)) {
        return {
          error: true,
          message:
            'Las ventas con QR se crean automáticamente cuando BCB notifica el pago.',
          data: null,
        };
      }

      if (!this.isManualPaymentType(saleContext.paymentType)) {
        return {
          error: true,
          message:
            'El tipo de pago seleccionado no está habilitado para crear ventas manuales.',
          data: null,
        };
      }

      const voucher = {
        customer: payload.voucher.customer.trim() || null,
        identityCardCustomer:
          payload.voucher.identityCardCustomer.trim() || null,
        paymentLocation: payload.voucher.paymentLocation,
        receiptNumber: payload.voucher.receiptNumber?.trim() || null,
        description: payload.voucher.description?.trim() || null,
        depositDate:
          this.parseOptionalDate(payload.voucher.depositDate) ?? new Date(),
      };

      const createdSale = await this.createSaleRecords({
        saleContext,
        voucher,
      });

      return this.buildCreateSaleResponse(payload, saleContext, createdSale);
    } catch (error) {
      this.logError('Error en la creación de venta', error);

      return {
        error: true,
        message: 'Error al crear la venta.',
        data: null,
      };
    }
  }

  async cancelSale(payload: CancelSaleDto): Promise<any> {
    const saleId = Number(payload.saleId);
    const reason = String(payload.reason ?? '').trim();
    const cancelledByUser = String(payload.cancelledByUser ?? '').trim();

    try {
      return await this.dataSource.transaction(async (manager) => {
        const sale = await manager
          .getRepository(Sale)
          .createQueryBuilder('sale')
          .setLock('pessimistic_write')
          .where('sale.id = :saleId', { saleId })
          .getOne();

        if (!sale) {
          throw new RpcException({
            code: HttpStatus.NOT_FOUND,
            message: `La venta con el ID ${saleId} no existe.`,
          });
        }

        if (sale.saleState !== SaleState.VIGENTE) {
          throw new RpcException({
            code: HttpStatus.CONFLICT,
            message:
              sale.saleState === SaleState.ANULADO
                ? 'La venta ya se encuentra anulada.'
                : `Solo se puede anular una venta VIGENTE. Estado actual: ${sale.saleState}.`,
          });
        }

        const saleProducts = await manager.getRepository(SaleProduct).find({
          select: {
            id: true,
            fileNumbers: {
              id: true,
            },
          },
          where: {
            sale: {
              id: saleId,
            },
          },
          relations: {
            fileNumbers: true,
          },
        });

        sale.saleState = SaleState.ANULADO;
        await manager.save(Sale, sale);

        const cancellation = await manager.save(
          SaleCancellation,
          manager.create(SaleCancellation, {
            sale,
            reason,
            cancelledByUser,
            cancelledAt: new Date(),
          }),
        );

        const retainedFileNumbers = saleProducts.reduce(
          (total, saleProduct) =>
            total + Number(saleProduct.fileNumbers?.length ?? 0),
          0,
        );

        return {
          error: false,
          message: 'Venta anulada correctamente.',
          data: {
            saleId: sale.id,
            code: this.formatSaleCode(sale.code, sale.createdAt),
            saleState: sale.saleState,
            affectedProducts: saleProducts.length,
            retainedFileNumbers,
            cancellation: {
              id: cancellation.id,
              reason: cancellation.reason,
              cancelledByUser: cancellation.cancelledByUser,
              cancelledAt: this.formatDate(cancellation.cancelledAt),
            },
          },
        };
      });
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }

      this.logError(`Error al anular la venta ${saleId}`, error);

      throw new RpcException({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error al anular la venta.',
      });
    }
  }

  private async registerCollectionTransaction(
    transactionData: Omit<CreateCollectionTransactionDto, 'accountNumber'>,
    products: Product[],
    accountNumber?: string,
  ): Promise<any> {
    try {
      const resolvedAccountNumber =
        accountNumber?.trim() ||
        (await this.resolveCollectionAccountNumber(products));
      const transaction: CreateCollectionTransactionDto = {
        ...transactionData,
        accountNumber: resolvedAccountNumber,
      };
      const response: any = await this.nats.firstValue(
        'collections.add',
        transaction,
      );

      if (!response?.serviceStatus) {
        return {
          error: true,
          message:
            'No se pudo registrar la cobranza porque Collections no está disponible.',
          transactionId: null,
        };
      }

      if (response.error) {
        return {
          error: true,
          message:
            response.message ?? 'Collections no pudo registrar la cobranza.',
          transactionId: null,
        };
      }

      const transactionId = String(response.data?.id ?? '').trim();

      if (!transactionId) {
        return {
          error: true,
          message:
            'Collections registró una respuesta sin identificador de transacción.',
          transactionId: null,
        };
      }

      return {
        error: false,
        message:
          response.message ??
          'Transacción de cobranza registrada correctamente',
        transactionId,
        accountNumber: resolvedAccountNumber,
      };
    } catch (error) {
      this.logError('Error al registrar la transacción en Collections', error);

      return {
        error: true,
        message: 'Error al registrar la transacción de cobranza.',
        transactionId: null,
      };
    }
  }

  private async resolveCollectionAccountNumber(
    products: Product[],
  ): Promise<string> {
    const accountIds = [
      ...new Set(
        products
          .map((product: Product) => Number(product.group?.accountId))
          .filter((accountId: number) => Number.isInteger(accountId)),
      ),
    ];

    if (accountIds.length !== 1) {
      throw new Error(
        'No se puede determinar una única cuenta para registrar la cobranza.',
      );
    }

    const response: any = await this.nats.firstValue('accounts.findAllByIds', {
      ids: accountIds,
      columns: ['id', 'accountNumber'],
    });
    const accounts = Array.isArray(response?.data) ? response.data : [];
    const accountNumber = String(accounts[0]?.accountNumber ?? '').trim();

    if (!response?.serviceStatus || !accountNumber) {
      throw new Error(
        'No se pudo obtener el número de cuenta para registrar la cobranza.',
      );
    }

    return accountNumber;
  }

  private async getSaleProductsDescription(
    manager: EntityManager,
    saleId: number,
  ): Promise<string> {
    const saleProducts = await manager.getRepository(SaleProduct).find({
      select: {
        name: true,
      },
      where: {
        sale: {
          id: saleId,
        },
      },
      order: {
        id: 'ASC',
      },
    });
    const productNames = saleProducts
      .map((saleProduct) => saleProduct.name?.trim())
      .filter(Boolean);

    return productNames.length > 0
      ? productNames.join(', ').slice(0, 255)
      : `Venta ${saleId}`;
  }

  private async createSaleRecords(params: any): Promise<any> {
    const {
      saleContext,
      voucher,
      qrPayment = null,
      paymentNotification = null,
    } = params;

    return this.dataSource.transaction(async (manager) => {
      const saleState = SaleState.VIGENTE;
      const management = this.getCurrentManagement();
      const code = await this.generateNextSaleCode(manager, management);

      const sale = await manager.save(
        manager.create(Sale, {
          code,
          saleState,
          personId: saleContext.personId,
          receptionist: saleContext.receptionist,
          parameter: saleContext.parameter,
        }),
      );

      const productsForSale: Product[] = saleContext.normalizedProducts.map(
        (item: NormalizedSaleProductDto) =>
          saleContext.productsById.get(item.productId),
      );
      const saleProducts = saleContext.normalizedProducts.map(
        (item: NormalizedSaleProductDto, index: number) => {
          const product = productsForSale[index];

          return manager.create(SaleProduct, {
            sale,
            product,
            productId: product.id,
            name: product.name,
            price: item.price,
            amount: item.amount,
            total: item.total,
            requiresFileNumber: product.group.requiresFileNumber,
          });
        },
      );
      const savedSaleProducts = await manager.save(SaleProduct, saleProducts);
      const fileNumbersBySaleProduct = await this.generateNextFileNumbers(
        manager,
        savedSaleProducts.map((saleProduct) => ({
          productId: saleProduct.productId,
          amount: saleProduct.amount,
          requiresFileNumber: saleProduct.requiresFileNumber,
        })),
        management,
      );
      const saleProductFileNumbers = savedSaleProducts.flatMap(
        (saleProduct, index) =>
          fileNumbersBySaleProduct[index].map((fileNumber) =>
            manager.create(SaleProductFileNumber, {
              saleProduct,
              saleProductId: saleProduct.id,
              productId: saleProduct.productId,
              fileNumber,
            }),
          ),
      );
      const savedSaleProductFileNumbers = saleProductFileNumbers.length
        ? await manager.save(SaleProductFileNumber, saleProductFileNumbers)
        : [];
      const fileNumbersBySaleProductId = new Map<
        number,
        SaleProductFileNumber[]
      >();

      savedSaleProductFileNumbers.forEach((fileNumber) => {
        const currentFileNumbers =
          fileNumbersBySaleProductId.get(fileNumber.saleProductId) ?? [];

        currentFileNumbers.push(fileNumber);
        fileNumbersBySaleProductId.set(
          fileNumber.saleProductId,
          currentFileNumbers,
        );
      });
      savedSaleProducts.forEach((saleProduct) => {
        saleProduct.fileNumbers =
          fileNumbersBySaleProductId.get(saleProduct.id) ?? [];
      });

      const savedVoucher = await manager.save(
        manager.create(Voucher, {
          sale,
          customer: voucher.customer,
          identityCardCustomer: voucher.identityCardCustomer,
          paymentLocation: voucher.paymentLocation,
          receiptNumber: voucher.receiptNumber ?? null,
          description: voucher.description ?? null,
          paymentType: saleContext.paymentType,
          paymentTypeState: PaymentTypeState.PAGADO,
          depositDate: voucher.depositDate,
          total: saleContext.saleTotal,
        }),
      );

      let savedQrPayment: QrPaymentSale | null = null;

      if (qrPayment) {
        qrPayment.qrStatus = QrPaymentStatus.PAGADO;
        qrPayment.dataResponse = {
          ...this.buildPaidQrDataResponse(qrPayment, paymentNotification),
          saleProducts: savedSaleProducts.map((saleProduct) => ({
            productId: saleProduct.product.id,
            code: saleProduct.product.code,
            name: saleProduct.name,
            price: String(saleProduct.price),
            amount: saleProduct.amount,
            fileNumbers: saleProduct.fileNumbers.map(
              (fileNumber) => fileNumber.fileNumber,
            ),
          })),
          saleId: sale.id,
        };
        savedQrPayment = await manager.save(QrPaymentSale, qrPayment);
      }

      const storedQrData = qrPayment
        ? this.getStoredQrData(qrPayment)
        : undefined;
      const destinationAccountNumber = String(
        storedQrData?.accountNumber ?? '',
      ).trim();
      const collectionDescription = qrPayment
        ? voucher.description
        : await this.getSaleProductsDescription(manager, sale.id);
      const titularName = this.formatPersonName(saleContext.person.fullName);
      const payerName = this.formatPersonName(voucher.customer);
      const collectionResult = await this.registerCollectionTransaction(
        {
          paymentDate: this.formatDate(voucher.depositDate),
          titularName,
          payerName,
          description: collectionDescription?.trim(),
          origin: 'SALES',
          paymentType: saleContext.paymentType.name,
          receptionistUser: saleContext.receptionist,
          total: saleContext.saleTotal,
          state: CollectionState.NO_COINCILIADO,
        },
        saleContext.products,
        destinationAccountNumber,
      );

      if (collectionResult.error || !collectionResult.transactionId) {
        throw new Error(collectionResult.message);
      }

      sale.transactionId = collectionResult.transactionId;
      await manager.save(Sale, sale);

      if (qrPayment) {
        qrPayment.dataResponse = {
          ...this.getStoredQrData(qrPayment),
          accountNumber: collectionResult.accountNumber,
          saleId: sale.id,
        };
        savedQrPayment = await manager.save(QrPaymentSale, qrPayment);
      }

      return {
        sale,
        saleProducts: savedSaleProducts,
        saleProductFileNumbers: savedSaleProductFileNumbers,
        voucher: savedVoucher,
        qrPayment: savedQrPayment,
      };
    });
  }

  private async generateNextSaleCode(
    manager: EntityManager,
    management: string,
  ): Promise<string> {
    const saleTablePath = manager.getRepository(Sale).metadata.tablePath;

    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${saleTablePath}:code:${management}`,
    ]);

    const result = await manager
      .createQueryBuilder(Sale, 'sale')
      .withDeleted()
      .select(
        `COALESCE(MAX(
          CASE
            WHEN sale.code ~ :annualCodePattern
              THEN CAST(SUBSTRING(sale.code FROM 4 FOR 8) AS BIGINT)
            ELSE CAST(SUBSTRING(sale.code FROM 1 FOR 8) AS BIGINT)
          END
        ), 0)`,
        'maxCode',
      )
      .where(
        `(
           sale.code ~ :numericCodePattern
           AND EXTRACT(YEAR FROM sale.createdAt AT TIME ZONE :timeZone) = :management
         )
         OR (
           sale.code ~ :legacyAnnualCodePattern
         )
         OR (
           sale.code ~ :annualCodePattern
         )`,
        {
          numericCodePattern: '^[0-9]{8}$',
          legacyAnnualCodePattern: `^[0-9]{8}\\s*/\\s*${management}$`,
          annualCodePattern: `^VEN[0-9]{8}/${management}$`,
          timeZone: this.businessTimeZone,
          management,
        },
      )
      .getRawOne<{ maxCode: string }>();

    const nextCode = Number(result?.maxCode ?? 0) + 1;

    if (!Number.isSafeInteger(nextCode) || nextCode > 99_999_999) {
      throw new Error('Se alcanzó el límite de códigos de venta de 8 dígitos.');
    }

    return `VEN${String(nextCode).padStart(8, '0')}/${management}`;
  }

  private getCurrentManagement(): string {
    return this.getManagementFromDate(new Date());
  }

  private getManagementFromDate(date: Date | string): string {
    const parsedDate = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error('No se pudo determinar la gestión de la venta.');
    }

    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      timeZone: this.businessTimeZone,
    }).format(parsedDate);
  }

  private formatSaleCode(
    code: string | null | undefined,
    createdAt: Date | string,
  ): string | null {
    if (!code?.trim()) {
      return null;
    }

    const storedCode = code.trim();
    const currentCode = storedCode.match(/^VEN([0-9]{8})\/([0-9]{4})$/);

    if (currentCode) {
      return storedCode;
    }

    const legacyCode = storedCode.match(/^([0-9]{8})(?:\s*\/\s*([0-9]{4}))?$/);

    if (!legacyCode) {
      return storedCode;
    }

    const management = legacyCode[2] ?? this.getManagementFromDate(createdAt);

    return `VEN${legacyCode[1]}/${management}`;
  }

  private async generateNextFileNumbers(
    manager: EntityManager,
    requests: Array<{
      productId: number;
      amount: number;
      requiresFileNumber: boolean;
    }>,
    management: string,
  ): Promise<string[][]> {
    const folderRequests = requests.filter(
      ({ requiresFileNumber }) => requiresFileNumber,
    );

    if (folderRequests.length === 0) {
      return requests.map(() => []);
    }

    // trasaccion activa es requerida para asegurar que los locks se mantengan durante la generación de números de folder
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error(
        'La generación de números de folder requiere una transacción activa.',
      );
    }

    const productIds = [
      ...new Set(folderRequests.map(({ productId }) => productId)),
    ].sort((firstId, secondId) => firstId - secondId);

    const repository = manager.getRepository(SaleProductFileNumber);
    const lockNamespace = repository.metadata.tablePath;

    // El orden ascendente evita adquirir los mismos locks en orden inverso.
    for (const productId of productIds) {
      const lockKey = [
        lockNamespace,
        'file-number',
        productId,
        management,
      ].join(':');

      // Bloqueo de la generación de números de folder para el producto y gestión actual
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [lockKey],
      );
    }

    const results = await repository
      .createQueryBuilder('fileNumber')
      .withDeleted()
      .select('fileNumber.productId', 'productId')
      .addSelect('MAX(LEFT(fileNumber.fileNumber, 8))', 'maxFileNumber')
      .where('fileNumber.productId IN (:...productIds)', { productIds })
      .andWhere('RIGHT(fileNumber.fileNumber, 4) = :management', { management })
      .groupBy('fileNumber.productId')
      .getRawMany<{
        productId: string;
        maxFileNumber: string;
      }>();

    const lastNumberByProduct = new Map<number, number>(
      productIds.map((productId) => [productId, 0]),
    );

    for (const result of results) {
      lastNumberByProduct.set(
        Number(result.productId),
        Number(result.maxFileNumber),
      );
    }

    return requests.map(({ productId, amount, requiresFileNumber }) => {
      if (!requiresFileNumber) {
        return [];
      }

      return Array.from({ length: amount }, () => {
        const nextFileNumber = (lastNumberByProduct.get(productId) ?? 0) + 1;

        if (nextFileNumber > 99_999_999) {
          throw new Error(
            `Se alcanzó el límite de números de folder de 8 dígitos para el producto ${productId}.`,
          );
        }

        lastNumberByProduct.set(productId, nextFileNumber);

        return `${String(nextFileNumber).padStart(8, '0')}-${management}`;
      });
    });
  }

  private buildCreateSaleResponse(
    payload: CreateSaleDto | GenerateQrDto,
    saleContext: any,
    createdSale: any,
  ): any {
    const data = {
      datosIngreso: {
        personId: saleContext.personId,
        receptionist: saleContext.receptionist,
        paymentTypeId: saleContext.paymentTypeId,
        parameterId: saleContext.parameterId,
        saleProducts: this.mapInputSaleProducts(payload.saleProducts),
      },
      sales: {
        id: createdSale.sale.id,
        code: this.formatSaleCode(
          createdSale.sale.code,
          createdSale.sale.createdAt,
        ),
        saleState: createdSale.sale.saleState,
        personId: createdSale.sale.personId,
        receptionist: createdSale.sale.receptionist,
        transactionId: createdSale.sale.transactionId,
        parameterId: saleContext.parameterId,
      },
      voucher: {
        id: createdSale.voucher.id,
        saleId: createdSale.sale.id,
        customer: createdSale.voucher.customer,
        identityCardCustomer: createdSale.voucher.identityCardCustomer,
        paymentLocation: createdSale.voucher.paymentLocation,
        receiptNumber: createdSale.voucher.receiptNumber,
        description: createdSale.voucher.description,
        paymentTypeId: saleContext.paymentTypeId,
        paymentTypeState: createdSale.voucher.paymentTypeState,
        depositDate: createdSale.voucher.depositDate
          ? this.formatDate(createdSale.voucher.depositDate)
          : null,
        total: Number(createdSale.voucher.total),
      },
      qrPayment: createdSale.qrPayment
        ? {
            id: createdSale.qrPayment.id,
            voucherId: createdSale.voucher.id,
            bcbQrId: createdSale.qrPayment.qrId,
            qrResponse: createdSale.qrPayment.dataResponse,
          }
        : null,
      saleProducts: createdSale.saleProducts.map((saleProduct: any) => ({
        id: saleProduct.id,
        productId: saleProduct.product.id,
        name: saleProduct.name,
        price: Number(saleProduct.price),
        amount: saleProduct.amount,
        total: Number(saleProduct.total),
        fileNumbers: saleProduct.fileNumbers.map(
          (fileNumber: SaleProductFileNumber) => fileNumber.fileNumber,
        ),
        fileNumber: saleProduct.fileNumbers[0]?.fileNumber ?? null,
      })),
    };

    return {
      error: false,
      message: 'Venta creada correctamente',
      data,
    };
  }

  async getQRCodeStatus(payload: GetQrCodeStatusDto): Promise<any> {
    try {
      const qrId = payload.qrId?.trim();

      if (!qrId) {
        return {
          error: true,
          message: 'Debe enviar qrId para consultar el estado del QR',
          data: null,
        };
      }

      const qrPayment = await this.qrPaymentSaleRepository.findOne({
        where: { qrId },
      });
      const response = await this.getBcbQrStatus(qrId);

      const depositDate =
        this.extractDepositDateFromQrStatus(response) ??
        (response?.statusValidation?.isPaid ? new Date() : null);
      let qrStatus = this.resolveQrPaymentStatus(response, qrPayment);
      let saleProcessing: Record<string, unknown> | null = null;

      if (qrStatus === QrPaymentStatus.PAGADO) {
        const paymentResult = await this.processPaidQrStatus(qrId, response);

        if (paymentResult.error) {
          qrStatus = paymentResult.data?.qrStatus ?? qrStatus;

          const data = {
            qrId,
            paymentTypeState: PaymentTypeState.PAGADO,
            depositDate: depositDate ? this.formatDate(depositDate) : null,
            qrStatus,
            statusValidation: response?.statusValidation ?? null,
            bcbResponse: response,
            saleProcessing: paymentResult.data,
          };

          return {
            error: true,
            message: paymentResult.message,
            data,
          };
        }

        saleProcessing = paymentResult.data;
      } else if (qrPayment) {
        qrStatus = await this.updateQrStatusIfUnchanged(qrPayment, qrStatus);
      }

      const data = {
        qrId,
        paymentTypeState: response?.statusValidation?.isPaid
          ? PaymentTypeState.PAGADO
          : response?.statusValidation?.isRejected
            ? PaymentTypeState.RECHAZADO
            : null,
        depositDate: depositDate ? this.formatDate(depositDate) : null,
        qrStatus,
        statusValidation: response?.statusValidation ?? null,
        bcbResponse: response,
        saleProcessing,
      };

      return {
        error: false,
        message: 'Estado del QR consultado correctamente',
        data,
      };
    } catch (error) {
      this.logError('Error al consultar el estado del QR', error);

      return {
        error: true,
        message: 'Error al consultar el estado del QR.',
        data: null,
      };
    }
  }

  private async processPaidQrStatus(qrId: string, response: any): Promise<any> {
    const processedOrder = this.extractProcessedQrOrder(response);

    if (!processedOrder) {
      return {
        error: true,
        message:
          'BCB reportó el QR como pagado, pero no devolvió la orden procesada.',
        data: null,
      };
    }

    return this.processBcbPaymentNotification({
      ...processedOrder,
      idQR: qrId,
      eif: String(processedOrder.eif ?? 'BCB_STATUS_QUERY'),
      codMoneda: String(processedOrder.codMoneda ?? ''),
      estado: 'PROCESADO',
      metaData: processedOrder.metaData ?? response.datos?.metaData ?? {},
    });
  }

  private async updateQrStatusIfUnchanged(
    qrPayment: QrPaymentSale,
    nextStatus: QrPaymentStatus,
  ): Promise<QrPaymentStatus> {
    const statusUpdate = await this.qrPaymentSaleRepository.update(
      {
        id: qrPayment.id,
        qrStatus: qrPayment.qrStatus,
      },
      { qrStatus: nextStatus },
    );

    if (!statusUpdate.affected) {
      const currentQrPayment = await this.qrPaymentSaleRepository.findOne({
        where: { id: qrPayment.id },
        select: { qrStatus: true },
      });

      return currentQrPayment?.qrStatus ?? nextStatus;
    }

    if (nextStatus !== QrPaymentStatus.PENDIENTE) {
      await this.removeTemporaryQrImage(qrPayment.qrId);
    }

    return nextStatus;
  }

  async processBcbPaymentNotification(
    notification: BcbPaymentNotificationDto,
  ): Promise<any> {
    try {
      const qrId = notification.idQR;

      if (!qrId) {
        return {
          error: true,
          message: 'La notificación BCB no contiene idQR.',
          data: null,
        };
      }

      const qrPayment = await this.qrPaymentSaleRepository.findOne({
        where: { qrId },
      });

      if (!qrPayment) {
        const data = { qrId, notification };

        return {
          error: true,
          message: 'No se encontró un QR generado con el id notificado.',
          data,
        };
      }

      const metadataValidationErrors = this.validateQrNotificationMetadata(
        qrPayment,
        notification.metaData,
      );

      if (metadataValidationErrors.length > 0) {
        const data = {
          qrId,
          validationErrors: metadataValidationErrors,
          metaData: notification.metaData,
        };

        return {
          error: true,
          message: 'La metadata BCB no corresponde al QR generado.',
          data,
        };
      }

      const notifiedStatus = String(notification?.estado ?? '').trim();
      const qrStatus =
        this.resolveQrPaymentStatusFromBcbNotification(notifiedStatus);

      if (qrStatus !== QrPaymentStatus.PAGADO) {
        return this.processNonPaidQrNotification(
          qrPayment,
          qrStatus,
          notification,
        );
      }

      if (qrPayment.qrStatus === QrPaymentStatus.PAGADO) {
        return this.processPreviouslyPaidQrNotification(
          qrPayment,
          notification,
        );
      }

      if (qrPayment.qrStatus === QrPaymentStatus.EXPIRADO) {
        return this.buildExpiredQrNotificationResponse(qrPayment, notification);
      }

      if (qrPayment.qrStatus !== QrPaymentStatus.PENDIENTE) {
        return this.buildInactiveQrNotificationResponse(
          qrPayment,
          notification,
        );
      }

      if (qrPayment.expirationDateQr.getTime() <= Date.now()) {
        const currentStatus = await this.updateQrStatusIfUnchanged(
          qrPayment,
          QrPaymentStatus.EXPIRADO,
        );

        if (currentStatus === QrPaymentStatus.PAGADO) {
          qrPayment.qrStatus = currentStatus;

          return this.processPreviouslyPaidQrNotification(
            qrPayment,
            notification,
          );
        }

        if (currentStatus !== QrPaymentStatus.EXPIRADO) {
          qrPayment.qrStatus = currentStatus;

          return this.buildInactiveQrNotificationResponse(
            qrPayment,
            notification,
          );
        }

        qrPayment.qrStatus = currentStatus;

        return this.buildExpiredQrNotificationResponse(qrPayment, notification);
      }

      const paymentValidationErrors = this.validatePaidQrNotification(
        qrPayment,
        notification,
      );

      if (paymentValidationErrors.length > 0) {
        const data = {
          qrId,
          qrStatus,
          validationErrors: paymentValidationErrors,
          notification,
        };

        return {
          error: true,
          message: 'La notificación BCB no coincide con el QR generado.',
          data,
        };
      }

      return this.createSaleFromPaidQr(qrPayment, notification);
    } catch (error) {
      this.logError('Error al procesar notificación BCB', error);

      return {
        error: true,
        message:
          error instanceof Error
            ? error.message
            : 'Error al procesar la notificación BCB.',
        data: null,
      };
    }
  }

  private buildExpiredQrNotificationResponse(
    qrPayment: QrPaymentSale,
    notification: BcbPaymentNotificationDto,
  ): any {
    const data = {
      qrId: qrPayment.qrId,
      qrStatus: QrPaymentStatus.EXPIRADO,
      expirationDateQr: this.formatDate(qrPayment.expirationDateQr),
      notification,
    };

    return {
      error: true,
      message: 'El QR ya expiró. No se puede procesar el pago.',
      data,
    };
  }

  private buildInactiveQrNotificationResponse(
    qrPayment: QrPaymentSale,
    notification: BcbPaymentNotificationDto,
  ): any {
    const data = {
      qrId: qrPayment.qrId,
      qrStatus: qrPayment.qrStatus,
      notification,
    };

    return {
      error: true,
      message: `El QR no está pendiente. Su estado actual es ${qrPayment.qrStatus}. No se puede procesar el pago.`,
      data,
    };
  }

  private async processNonPaidQrNotification(
    qrPayment: QrPaymentSale,
    qrStatus: QrPaymentStatus,
    notification: BcbPaymentNotificationDto,
  ): Promise<any> {
    qrPayment.qrStatus = qrStatus;
    await this.qrPaymentSaleRepository.save(qrPayment);

    if (qrStatus !== QrPaymentStatus.PENDIENTE) {
      await this.removeTemporaryQrImage(qrPayment.qrId);
    }

    const data = {
      qrId: qrPayment.qrId,
      qrStatus,
      notification,
    };

    return {
      error: false,
      message:
        qrStatus === QrPaymentStatus.RECHAZADO
          ? 'QR rechazado por BCB. No se creó la venta.'
          : 'QR pendiente según BCB. No se creó la venta.',
      data,
    };
  }

  private async processPreviouslyPaidQrNotification(
    qrPayment: QrPaymentSale,
    notification: BcbPaymentNotificationDto,
  ): Promise<any> {
    qrPayment.dataResponse = this.buildPaidQrDataResponse(
      qrPayment,
      notification,
    );
    await this.qrPaymentSaleRepository.save(qrPayment);
    await this.removeTemporaryQrImage(qrPayment.qrId);

    const data = {
      qrId: qrPayment.qrId,
      qrStatus: qrPayment.qrStatus,
      notification,
    };

    return {
      error: false,
      message: 'La notificación BCB ya fue procesada anteriormente.',
      data,
    };
  }

  private async createSaleFromPaidQr(
    qrPayment: QrPaymentSale,
    notification: BcbPaymentNotificationDto,
  ): Promise<any> {
    const salePayload = this.buildSalePayloadFromQrPayment(qrPayment);

    if (!salePayload) {
      const data = { qrId: qrPayment.qrId, notification };

      return {
        error: true,
        message:
          'El QR no tiene los datos originales necesarios para crear la venta.',
        data,
      };
    }

    const saleContext = await this.validateSaleInput(salePayload);

    if (saleContext.error) {
      const data = {
        qrId: qrPayment.qrId,
        notification,
        saleContext,
      };

      return {
        error: true,
        message: saleContext.message,
        data,
      };
    }

    if (!this.isQrPaymentType(saleContext.paymentType)) {
      const data = { qrId: qrPayment.qrId, notification };

      return {
        error: true,
        message: 'El QR generado no corresponde a un tipo de pago QR.',
        data,
      };
    }

    const depositDate = new Date();
    const storedQrData = this.getStoredQrData(qrPayment);
    const storedQrGlosa =
      typeof storedQrData.glosa === 'string' ? storedQrData.glosa.trim() : '';
    const qrGlosa =
      storedQrGlosa ||
      this.normalizeBcbText(
        `${saleContext.normalizedProducts
          .map((product: NormalizedSaleProductDto) => product.name)
          .join(',')}`,
      );

    const originEif = String(notification.eifOrigen ?? '').trim();
    const financialEntityResponse: any = originEif
      ? await this.nats.firstValue('financialEntities.searchByColumn', {
          columns: ['name'],
          filterColumn: 'eif',
          value: originEif,
        })
      : null;
    const financialEntityName =
      financialEntityResponse?.serviceStatus &&
      financialEntityResponse?.error !== true &&
      typeof financialEntityResponse?.data?.name === 'string'
        ? financialEntityResponse.data.name.trim()
        : '';

    const createdSale = await this.createSaleRecords({
      saleContext,
      voucher: {
        customer: notification.nombreOriginante?.trim(),
        identityCardCustomer: notification.ciNitOriginante?.trim(),
        paymentLocation: financialEntityName || originEif,
        receiptNumber: notification.idOrdenDestinatario,
        description: qrGlosa,
        depositDate,
      },
      qrPayment,
      paymentNotification: notification,
    });
    await this.removeTemporaryQrImage(qrPayment.qrId);

    const data = {
      qrId: qrPayment.qrId,
      saleId: createdSale.sale.id,
      voucherId: createdSale.voucher.id,
      transactionId: createdSale.sale.transactionId,
      notification,
    };

    return {
      error: false,
      message: 'Notificación BCB procesada. Venta creada correctamente.',
      data,
    };
  }

  async personSales(personId: number): Promise<any> {
    try {
      return await this.findPersonSales(personId);
    } catch (error) {
      this.logError(`Error al obtener ventas de la persona ${personId}`, error);

      return {
        error: true,
        message: 'Error al obtener el registro de ventas.',
        data: null,
      };
    }
  }

  private async findPersonSales(personId: number): Promise<any> {
    const sales = await this.salesRepository.find({
      select: {
        id: true,
        code: true,
        saleState: true,
        personId: true,
        receptionist: true,
        createdAt: true,
        cancellation: {
          id: true,
          reason: true,
          cancelledByUser: true,
          cancelledAt: true,
        },
        saleProducts: {
          id: true,
          name: true,
          amount: true,
          fileNumbers: {
            id: true,
            fileNumber: true,
          },
        },
        voucher: {
          id: true,
          total: true,
          customer: true,
          identityCardCustomer: true,
          depositDate: true,
          paymentType: {
            id: true,
            name: true,
          },
        },
      },
      where: {
        personId,
      },
      relations: {
        cancellation: true,
        saleProducts: {
          fileNumbers: true,
        },
        voucher: {
          paymentType: true,
        },
      },
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
    });

    return {
      error: false,
      message: 'Registro de ventas obtenido correctamente.',
      data: sales.map((sale) => {
        const voucher = sale.voucher;

        return {
          ...sale,
          code: this.formatSaleCode(sale.code, sale.createdAt),
          createdAt: this.formatDate(sale.createdAt),
          cancellation: sale.cancellation
            ? {
                ...sale.cancellation,
                cancelledAt: this.formatDate(sale.cancellation.cancelledAt),
              }
            : null,
          voucher: voucher
            ? {
                ...voucher,
                depositDate: voucher.depositDate
                  ? this.formatDate(voucher.depositDate)
                  : null,
              }
            : null,
        };
      }),
    };
  }

  async personPendingQr(personId: number): Promise<any> {
    try {
      if (!Number.isInteger(personId) || personId <= 0) {
        return {
          error: true,
          message: 'Debe enviar un personId válido.',
          data: null,
        };
      }

      await this.expirePendingQrPayments(personId);

      const qrPayments = await this.qrPaymentSaleRepository.find({
        where: {
          personId,
          qrStatus: QrPaymentStatus.PENDIENTE,
          expirationDateQr: MoreThan(new Date()),
        },
        order: {
          expirationDateQr: 'ASC',
          createdAt: 'DESC',
        },
      });

      if (qrPayments.length === 0) {
        return {
          error: false,
          message: 'La persona no tiene QR pendientes vigentes.',
          data: [],
        };
      }

      const data = qrPayments.map((qrPayment) => ({
        id: qrPayment.id,
        personId: qrPayment.personId,
        qrId: qrPayment.qrId,
        dataResponse: qrPayment.dataResponse,
        qrStatus: qrPayment.qrStatus,
        expirationDateQr: this.formatDate(qrPayment.expirationDateQr),
        createdAt: this.formatDate(qrPayment.createdAt),
      }));

      return {
        error: false,
        message: 'Reporte de ventas pendientes obtenido correctamente.',
        data,
      };
    } catch (error) {
      this.logError('Error en personPendingReport', error);

      return {
        error: true,
        message: 'Error al obtener el reporte de ventas pendientes.',
        data: null,
      };
    }
  }

  private async saveTemporaryQrImage(
    qrId: string,
    qrImage: string,
    expirationDateQr: Date,
  ): Promise<void> {
    const ttlMs = Math.max(expirationDateQr.getTime() - Date.now(), 1);
    const response: any = await this.nats.firstValue('ftp.saveDataTmp', {
      ...this.buildQrTemporaryFilePayload(qrId),
      data: { qrImage },
      ttlMs,
    });

    if (!response?.serviceStatus || response?.statusSaved !== true) {
      throw new Error('No se pudo guardar la imagen QR temporal.');
    }
  }

  public async getTemporaryQrImage(qrId: string): Promise<string | null> {
    try {
      const response: any = await this.nats.firstValue(
        'ftp.getDataTmp',
        this.buildQrTemporaryFilePayload(qrId),
      );

      if (!response?.serviceStatus) {
        return null;
      }

      const qrImage = response.qrImage;

      return typeof qrImage === 'string' && qrImage.length > 0 ? qrImage : null;
    } catch (error) {
      this.logError(
        `Error al recuperar la imagen temporal del QR ${qrId}`,
        error,
      );
      return null;
    }
  }

  private async removeTemporaryQrImage(qrId: string): Promise<void> {
    try {
      const response: any = await this.nats.firstValue(
        'ftp.removeDataTmp',
        this.buildQrTemporaryFilePayload(qrId),
      );

      if (!response?.serviceStatus || response?.statusRemoved !== true) {
        this.logger.warn(`No se pudo eliminar la imagen QR temporal ${qrId}`);
      }
    } catch (error) {
      this.logError(`No se pudo eliminar la imagen QR temporal ${qrId}`, error);
    }
  }

  private buildQrTemporaryFilePayload(qrId: string): any {
    return {
      path: this.qrTempPath,
      name: this.buildQrImageTmpName(qrId),
    };
  }

  private buildQrImageTmpName(qrId: string): string {
    return `${encodeURIComponent(qrId)}.json`;
  }

  private async expirePendingQrPayments(personId?: number): Promise<void> {
    const expirationLimit = new Date();
    const where = {
      ...(personId ? { personId } : {}),
      qrStatus: QrPaymentStatus.PENDIENTE,
      expirationDateQr: LessThanOrEqual(expirationLimit),
    };
    const expiredQrPayments = await this.qrPaymentSaleRepository.find({
      where,
      select: {
        qrId: true,
      },
    });

    if (expiredQrPayments.length === 0) {
      return;
    }

    for (const qrPayment of expiredQrPayments) {
      const statusResult = await this.getQRCodeStatus({
        qrId: qrPayment.qrId,
      });

      if (statusResult.error) {
        this.logger.warn(
          `No se cambió a EXPIRADO el QR ${qrPayment.qrId} porque no se pudo confirmar su estado en BCB: ${statusResult.message}`,
        );
      }
    }
  }

  private async runQrExpirationSweep(): Promise<void> {
    if (this.qrExpirationSweepRunning) {
      return;
    }

    this.qrExpirationSweepRunning = true;

    try {
      await this.expirePendingQrPayments();
    } catch (error) {
      this.logError('Error al actualizar los QR expirados', error);
    } finally {
      this.qrExpirationSweepRunning = false;
    }
  }

  private resolveQrPaymentStatusFromBcbNotification(
    status: string,
  ): QrPaymentStatus {
    switch (status) {
      case 'PROCESADO':
        return QrPaymentStatus.PAGADO;
      case 'RECHAZADO':
        return QrPaymentStatus.RECHAZADO;
      default:
        return QrPaymentStatus.PENDIENTE;
    }
  }

  private validatePaidQrNotification(
    qrPayment: QrPaymentSale,
    notification: BcbPaymentNotificationDto,
  ): string[] {
    const errors: string[] = [];
    const storedData = this.getStoredQrData(qrPayment);
    const expectedAmount = this.resolveStoredQrAmount(storedData);
    const receivedAmount = Number(notification?.importe);
    const expectedCurrency = String(storedData.currency ?? 'BOB').toUpperCase();
    const receivedCurrency = String(
      notification?.codMoneda ?? '',
    ).toUpperCase();

    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      errors.push('importe: BCB no envió un monto válido');
    } else if (
      expectedAmount === null ||
      Math.round(receivedAmount * 100) !== Math.round(expectedAmount * 100)
    ) {
      errors.push(
        `importe: se esperaba ${expectedAmount?.toFixed(2) ?? 'un monto registrado'} y se recibió ${receivedAmount.toFixed(2)}`,
      );
    }

    if (!receivedCurrency || receivedCurrency !== expectedCurrency) {
      errors.push(
        `codMoneda: se esperaba ${expectedCurrency} y se recibió ${receivedCurrency || 'vacío'}`,
      );
    }

    if (!notification.idOrdenDestinatario) {
      errors.push('idOrdenDestinatario: es obligatorio para confirmar el pago');
    }

    return errors;
  }

  private validateQrNotificationMetadata(
    qrPayment: QrPaymentSale,
    metadata: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];
    const expectedMetadata: Record<string, string> = {
      origen: 'sales-service',
      schema: 'sales',
      message: 'bcbPaymentNotification',
      tipo: 'venta-qr',
      personId: String(qrPayment.personId),
    };

    Object.entries(expectedMetadata).forEach(([key, expectedValue]) => {
      const receivedValue = String(metadata?.[key] ?? '').trim();

      if (receivedValue !== expectedValue) {
        errors.push(
          `${key}: se esperaba ${expectedValue} y se recibió ${receivedValue || 'vacío'}`,
        );
      }
    });

    return errors;
  }

  private resolveStoredQrAmount(storedData: any): number | null {
    const storedTotal = Number(storedData.total);

    if (Number.isFinite(storedTotal) && storedTotal > 0) {
      return Number(storedTotal.toFixed(2));
    }

    if (!Array.isArray(storedData.saleProducts)) {
      return null;
    }

    const total = storedData.saleProducts.reduce(
      (sum: number, product: any) =>
        sum + Number(product?.price) * Number(product?.amount),
      0,
    );

    return Number.isFinite(total) && total > 0
      ? Number(total.toFixed(2))
      : null;
  }

  private buildPaidQrDataResponse(
    qrPayment: QrPaymentSale,
    notification: BcbPaymentNotificationDto | null,
  ): Record<string, unknown> {
    const storedData = this.getStoredQrData(qrPayment);

    const data = {
      total: storedData.total,
      currency: storedData.currency,
      accountNumber: storedData.accountNumber,
      glosa: storedData.glosa,
      personId: storedData.personId ?? qrPayment.personId,
      parameterId: storedData.parameterId,
      receptionist: storedData.receptionist,
      saleProducts: Array.isArray(storedData.saleProducts)
        ? storedData.saleProducts.map((saleProduct) => ({
            code: saleProduct?.code,
            name: saleProduct?.name,
            price: saleProduct?.price,
            amount: saleProduct?.amount,
            productId: saleProduct?.productId,
            fileNumbers: Array.isArray(saleProduct?.fileNumbers)
              ? saleProduct.fileNumbers
              : [],
          }))
        : [],
      paymentTypeId: storedData.paymentTypeId,
      notificationData: {
        idOrdenDestinatario:
          notification?.idOrdenDestinatario ?? storedData.idOrdenDestinatario,
        tipoNotificacion:
          notification?.tipoNotificacion ?? storedData.tipoNotificacion,
        nombreOriginante:
          notification?.nombreOriginante ?? storedData.nombreOriginante,
        ciNitOriginante:
          notification?.ciNitOriginante ?? storedData.ciNitOriginante,
        eifOrigen: notification?.eifOrigen ?? storedData.eifOrigen,
      },
    };
    return data;
  }

  private buildSalePayloadFromQrPayment(
    qrPayment: QrPaymentSale,
  ): GenerateQrDto | null {
    const storedData = this.getStoredQrData(qrPayment);

    const personId = Number(storedData?.personId);
    const receptionist =
      typeof storedData?.receptionist === 'string'
        ? storedData.receptionist.trim()
        : '';
    const paymentTypeId = Number(storedData?.paymentTypeId);
    const parameterId = Number(storedData?.parameterId);
    const saleProducts = this.parseStoredQrSaleProducts(
      storedData.saleProducts,
    );

    if (
      !Number.isInteger(personId) ||
      personId <= 0 ||
      !receptionist ||
      !Number.isInteger(paymentTypeId) ||
      paymentTypeId <= 0 ||
      !Number.isInteger(parameterId) ||
      parameterId <= 0 ||
      !saleProducts
    ) {
      return null;
    }

    return {
      personId,
      receptionist,
      paymentTypeId,
      parameterId,
      saleProducts,
    };
  }

  private parseStoredQrSaleProducts(
    value: unknown,
  ): GenerateQrDto['saleProducts'] | null {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    const hasInvalidProduct = value.some((item) => {
      if (!this.isRecord(item)) {
        return true;
      }

      return (
        !Number.isInteger(item.productId) ||
        Number(item.productId) <= 0 ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        typeof item.code !== 'string' ||
        !item.code.trim() ||
        typeof item.price !== 'string' ||
        !Number.isFinite(Number(item.price)) ||
        !Number.isInteger(item.amount) ||
        Number(item.amount) <= 0
      );
    });

    if (hasInvalidProduct) {
      return null;
    }

    return value.map((item) => {
      const product: any = item;

      return {
        productId: Number(product.productId),
        name: String(product.name),
        code: String(product.code),
        price: String(product.price),
        amount: Number(product.amount),
      };
    });
  }

  private getStoredQrData(qrPayment: QrPaymentSale): any {
    return this.isRecord(qrPayment.dataResponse) ? qrPayment.dataResponse : {};
  }

  private isQrPaymentType(
    paymentType: PaymentType | null | undefined,
  ): boolean {
    return paymentType?.shortened?.toUpperCase() === 'QR';
  }

  private isManualPaymentType(
    paymentType: PaymentType | null | undefined,
  ): boolean {
    return ['EF', 'DEP', 'TRANSF'].includes(
      paymentType?.shortened?.toUpperCase() ?? '',
    );
  }

  private mapInputSaleProducts(
    saleProducts: CreateSaleDto['saleProducts'] | GenerateQrDto['saleProducts'],
  ): {
    productId: number;
    name: string;
    code: string;
    price: string;
    amount: number;
  }[] {
    return saleProducts.map((saleProduct) => ({
      productId: Number(saleProduct.productId),
      name: saleProduct.name,
      code: saleProduct.code,
      price: saleProduct.price,
      amount: saleProduct.amount,
    }));
  }

  private buildSaleInputValidationError(message: string): any {
    return {
      error: true,
      message,
      data: null,
    };
  }

  private normalizeSaleProducts(
    saleProducts: CreateSaleDto['saleProducts'] | GenerateQrDto['saleProducts'],
  ): NormalizedSaleProductDto[] {
    return saleProducts.map((item) => {
      const productId = item.productId;
      const amount = item.amount;
      const price = Number(item?.price);

      return {
        productId,
        name: item.name.trim(),
        code: item.code.trim(),
        price,
        amount,
        total: Number((price * amount).toFixed(2)),
      };
    });
  }

  private findCatalogProductMismatch(
    normalizedProducts: NormalizedSaleProductDto[],
    productsById: Map<number, Product>,
  ): string | null {
    for (const item of normalizedProducts) {
      const product = productsById.get(item.productId);
      const currentPrice = Number(product.price);

      if (product.code !== item.code) {
        return `El producto "${item.name}" fue actualizado. Vuelva a seleccionarlo.`;
      }

      if (!Number.isFinite(currentPrice) || currentPrice !== item.price) {
        return `El precio de "${item.name}" cambió. Vuelva a seleccionarlo.`;
      }
    }

    return null;
  }

  private async validateSaleInput(
    data: CreateSaleDto | GenerateQrDto,
  ): Promise<any> {
    const personId = data.personId;
    const receptionist = data.receptionist.trim();
    const paymentTypeId = data.paymentTypeId;
    const parameterId = data.parameterId;

    if (!receptionist) {
      return this.buildSaleInputValidationError(
        'Debe enviar el nombre del recepcionista.',
      );
    }

    const normalizedProducts = this.normalizeSaleProducts(data.saleProducts);

    const productIds = normalizedProducts.map((item) => item.productId);
    const uniqueProductIds = [...new Set(productIds)];

    const [parameter, paymentType, products, personResult] = await Promise.all([
      this.parameterRepository.findOne({
        where: { id: parameterId, isActive: true },
      }),
      this.paymentTypesRepository.findOne({
        where: { id: paymentTypeId },
      }),
      this.productsRepository.find({
        where: { id: In(uniqueProductIds), isActive: true },
        relations: {
          group: true,
        },
      }),
      this.personDetailsById(personId),
    ]);

    if (!parameter) {
      return this.buildSaleInputValidationError(
        'No se encontró la configuración activa para crear la venta.',
      );
    }

    if (normalizedProducts.length > parameter.maxProducts) {
      return this.buildSaleInputValidationError(
        `Solo puede seleccionar hasta ${parameter.maxProducts} producto(s) por venta.`,
      );
    }

    const productOverAmountLimit = normalizedProducts.find(
      (item) =>
        parameter.maxAmountProduct > 0 &&
        item.amount > parameter.maxAmountProduct,
    );

    if (productOverAmountLimit) {
      return this.buildSaleInputValidationError(
        `El producto "${productOverAmountLimit.name}" solo permite una cantidad máxima de ${parameter.maxAmountProduct}.`,
      );
    }

    if (!paymentType) {
      return this.buildSaleInputValidationError(
        'Seleccione un tipo de pago válido.',
      );
    }

    if (products.length !== uniqueProductIds.length) {
      const existingProductIds = new Set(products.map((product) => product.id));
      const missingProductIds = uniqueProductIds.filter(
        (productId) => !existingProductIds.has(productId),
      );

      return this.buildSaleInputValidationError(
        missingProductIds.length === 1
          ? 'Uno de los productos seleccionados ya no está disponible.'
          : 'Algunos productos seleccionados ya no están disponibles.',
      );
    }

    const productsById = new Map(
      products.map((product) => [product.id, product]),
    );

    const productMismatch = this.findCatalogProductMismatch(
      normalizedProducts,
      productsById,
    );

    if (productMismatch) {
      return this.buildSaleInputValidationError(productMismatch);
    }

    if (personResult.error || !personResult.data) {
      return this.buildSaleInputValidationError(
        personResult.error
          ? personResult.message
          : 'No se encontró la persona seleccionada.',
      );
    }

    const saleTotal = normalizedProducts.reduce(
      (total, item) => total + item.total,
      0,
    );

    if (!Number.isFinite(saleTotal) || saleTotal > 99_999_999.99) {
      return this.buildSaleInputValidationError(
        'El monto total de la venta supera el límite permitido.',
      );
    }

    return {
      error: false,
      personId,
      receptionist,
      paymentTypeId,
      parameterId,
      normalizedProducts,
      parameter,
      paymentType,
      products,
      productsById,
      person: personResult.data,
      saleTotal: Number(saleTotal.toFixed(2)),
    };
  }

  private async buildQrDataFromGlobalAccount(
    products: Product[],
    saleTotal: number,
    saleProducts: NormalizedSaleProductDto[],
  ): Promise<
    BcbQrDataDto & {
      destinationAccount: string;
      accountNumber: string;
      ctaDestino: string;
      fechaVencimientoQR: string;
    }
  > {
    const accountIds = [
      ...new Set(
        products
          .map((product) => product.group?.accountId)
          .filter((accountId) => Number.isInteger(Number(accountId))),
      ),
    ];

    if (accountIds.length !== 1) {
      throw new Error(
        'No se puede determinar una única cuenta destino para generar el QR.',
      );
    }

    const response: any = await this.nats.firstValue(
      'accounts.findAllData',
      {},
    );

    if (!response?.serviceStatus || response?.error) {
      throw new Error(
        response?.message ?? 'No se pudieron obtener las cuentas destino.',
      );
    }

    const accounts = Array.isArray(response?.data) ? response.data : [];
    const account = accounts.find((item: any) => item?.id === accountIds[0]);

    if (!account) {
      throw new Error('No se encontró la cuenta destino para generar el QR.');
    }

    const eif = String(account.financialEntity?.eif ?? '').trim();
    const accountNumber = this.normalizeBcbAccountNumber(account.accountNumber);

    if (!eif) {
      throw new Error(
        'La entidad financiera de la cuenta destino no tiene EIF configurado.',
      );
    }

    const bcbAccount = await this.resolveBcbDestinationAccount(
      account,
      eif,
      accountNumber,
    );
    const cuentaDestino = bcbAccount.cuentaDestino;
    const titularDestinatario =
      bcbAccount.titularDestinatario || String(account.name ?? '').trim();
    const ciNitDestinatario =
      bcbAccount.ciNitDestinatario || String(account.ciNitTitular ?? '').trim();
    const fechaVencimiento = this.formatDate(this.buildDefaultQrExpiration());

    return {
      destinationAccount: String(account.name ?? '').trim(),
      accountNumber: String(account.accountNumber ?? '').trim(),
      ctaDestino: cuentaDestino,
      fechaVencimientoQR: fechaVencimiento,
      titularDestinatario,
      ciNitDestinatario,
      eif,
      cuentaDestino,
      cuentaDestinoDistribucion: {
        [cuentaDestino]: Number(Number(saleTotal).toFixed(2)),
      },
      codMoneda: 'BOB',
      glosa: this.normalizeBcbText(
        `${saleProducts.map((product) => product.name).join(',')}`,
      ),
      fechaVencimiento,
      unicoUso: true,
      codigoServicio: '0',
      metaData: {
        origen: 'sales-service',
        schema: 'sales',
        message: 'bcbPaymentNotification',
        tipo: 'venta-qr',
      },
    };
  }

  private async resolveBcbDestinationAccount(
    account: any,
    eif: string,
    accountNumber: string,
  ): Promise<{
    cuentaDestino: string;
    titularDestinatario: string;
    ciNitDestinatario: string;
  }> {
    const localCta = this.normalizeBcbAccountNumber(account.cta);

    if (localCta && localCta !== '0') {
      return {
        cuentaDestino: localCta,
        titularDestinatario: String(account.name ?? '').trim(),
        ciNitDestinatario: String(account.ciNitTitular ?? '').trim(),
      };
    }

    const response: any = await this.nats.firstValue('bcb.entities', {});

    if (
      !response?.serviceStatus ||
      response?.error === true ||
      response?.finalizado === false
    ) {
      throw new Error(
        this.getRemoteMessage(
          response,
          'No se pudieron consultar las cuentas BCB de la entidad.',
        ),
      );
    }

    const bcbAccounts = Array.isArray(response.datos?.cuentas)
      ? response.datos.cuentas
      : [];
    const bcbAccount = bcbAccounts.find(
      (item: any) =>
        String(item?.eif ?? '').trim() === eif &&
        this.normalizeBcbAccountNumber(item?.eifCuenta) === accountNumber,
    );
    const cuentaDestino = this.normalizeBcbAccountNumber(bcbAccount?.cta);

    if (!cuentaDestino || cuentaDestino === '0') {
      throw new Error(
        `La cuenta ${account.accountNumber} no tiene cta BCB activa. Registre o sincronice la cuenta antes de generar QR.`,
      );
    }

    return {
      cuentaDestino,
      titularDestinatario: String(
        bcbAccount?.nombreTitular ?? account.name ?? '',
      ).trim(),
      ciNitDestinatario: String(
        bcbAccount?.ciNitTitular ?? account.ciNitTitular ?? '',
      ).trim(),
    };
  }

  private normalizeBcbAccountNumber(value: unknown): string {
    return String(value ?? '')
      .replace(/\D/g, '')
      .trim();
  }

  private normalizeBcbText(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async getBcbQrStatus(qrId: string): Promise<any> {
    const response: any = await this.nats.firstValue('bcb.qrStatus', {
      qrId,
    });

    if (!response?.serviceStatus) {
      throw new Error(
        response?.message ??
          'Servicio BCB no disponible para consultar el estado del QR',
      );
    }

    if (response?.error === true || response?.finalizado === false) {
      throw new Error(
        this.getRemoteMessage(response, 'BCB no finalizó la consulta del QR'),
      );
    }

    if (
      typeof response.statusValidation?.isPaid !== 'boolean' ||
      typeof response.statusValidation?.isRejected !== 'boolean'
    ) {
      throw new Error('BCB devolvió un estado de QR incompleto o inválido');
    }

    return response;
  }

  private resolveQrPaymentStatus(
    response: any,
    qrPayment?: QrPaymentSale | null,
  ): QrPaymentStatus {
    if (response?.statusValidation?.isPaid) {
      return QrPaymentStatus.PAGADO;
    }

    if (response?.statusValidation?.isRejected) {
      return QrPaymentStatus.RECHAZADO;
    }

    if (
      qrPayment?.expirationDateQr &&
      qrPayment.expirationDateQr < new Date()
    ) {
      return QrPaymentStatus.EXPIRADO;
    }

    return QrPaymentStatus.PENDIENTE;
  }

  private parseOptionalDate(value?: string): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private buildDefaultQrExpiration(): Date {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.qrExpirationMinutes);

    return date;
  }

  private formatDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');

    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    ].join(' ');
  }

  private validateBcbQrData(qrData?: BcbQrDataDto): string[] {
    if (!qrData) {
      return ['qrData'];
    }

    const errors: string[] = [];
    const requiredStringFields: Array<keyof BcbQrDataDto> = [
      'titularDestinatario',
      'ciNitDestinatario',
      'eif',
      'cuentaDestino',
      'codMoneda',
      'fechaVencimiento',
      'codigoServicio',
    ];

    requiredStringFields.forEach((field) => {
      const value = qrData[field];

      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(field);
      }
    });

    if (typeof qrData.unicoUso !== 'boolean') {
      errors.push('unicoUso');
    }

    return errors;
  }

  private buildBcbQrPayload(
    qrData: BcbQrDataDto,
    sale: { id?: number | null; personId: number },
    saleTotal: number,
  ): Record<string, unknown> {
    const importe = Number(Number(saleTotal).toFixed(2));
    const metaData = this.buildBcbQrMetaData(qrData.metaData, sale);

    return {
      titularDestinatario: qrData.titularDestinatario.trim(),
      ciNitDestinatario: qrData.ciNitDestinatario.trim(),
      eif: qrData.eif.trim(),
      cuentaDestino: qrData.cuentaDestino.trim(),
      ...(qrData.cuentaDestinoDistribucion
        ? { cuentaDestinoDistribucion: qrData.cuentaDestinoDistribucion }
        : {}),
      codMoneda: qrData.codMoneda.trim(),
      importe,
      glosa: this.normalizeBcbText(qrData.glosa?.trim()),
      fechaVencimiento: qrData.fechaVencimiento.trim(),
      unicoUso: qrData.unicoUso,
      codigoServicio: qrData.codigoServicio.trim(),
      metaData,
    };
  }

  private buildBcbQrMetaData(
    input: Record<string, unknown> | undefined,
    sale: { id?: number | null; personId: number },
  ): Record<string, string> {
    const metadata: Record<string, unknown> = {
      ...(input ?? {}),
      personId: sale.personId,
    };

    return Object.fromEntries(
      Object.entries(metadata)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        ]),
    );
  }

  private async generateBcbQr(payload: any): Promise<any> {
    const response: any = await this.nats.firstValue('bcb.generateQr', payload);

    if (!response?.serviceStatus) {
      throw new Error(
        response?.message ?? 'Servicio BCB no disponible para generar QR',
      );
    }

    if (response?.error === true || response?.finalizado === false) {
      throw new Error(
        this.getRemoteMessage(response, 'BCB no finalizó la generación QR'),
      );
    }

    if (!response.datos?.idQr || !response.datos?.imagenQr) {
      throw new Error('BCB no devolvió idQr o imagenQr');
    }

    return response;
  }

  private extractDepositDateFromQrStatus(response: any): Date | null {
    const processedOrder = this.extractProcessedQrOrder(response);

    if (!processedOrder?.fecha) {
      return null;
    }

    const depositDate = new Date(processedOrder.fecha);

    return Number.isNaN(depositDate.getTime()) ? null : depositDate;
  }

  private extractProcessedQrOrder(response: any): any {
    const orders = Array.isArray(response.datos?.ordenes)
      ? response.datos.ordenes
      : [];

    return orders.find((order) => order.estado === 'PROCESADO') ?? null;
  }

  private isRecord(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private toRecord(value: any): any {
    return this.isRecord(value) ? value : {};
  }

  private getRemoteMessage(response: any, fallbackMessage: string): string {
    const responseData = this.toRecord(response.data);
    const message =
      response.message ??
      response.mensaje ??
      responseData.message ??
      responseData.mensaje;

    return typeof message === 'string' && message.trim()
      ? message.trim()
      : fallbackMessage;
  }

  private logError(context: string, error: unknown): void {
    if (error instanceof Error) {
      this.logger.error(`${context}: ${error.message}`, error.stack);
    } else {
      this.logger.error(`${context}: ${String(error)}`);
    }
  }

  async voucherPdf(saleId: number): Promise<any> {
    try {
      return await this.buildVoucherPdfResponse(saleId);
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }

      this.logError(`Error al obtener el detalle de la venta ${saleId}`, error);

      throw new RpcException({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error al obtener el detalle de la venta.',
      });
    }
  }

  private async buildVoucherPdfResponse(saleId: number): Promise<any> {
    const sale = await this.salesRepository.findOne({
      select: {
        id: true,
        code: true,
        saleState: true,
        personId: true,
        receptionist: true,
        createdAt: true,
        cancellation: {
          id: true,
          reason: true,
          cancelledByUser: true,
          cancelledAt: true,
        },
        parameter: {
          id: true,
          currencySymbol: true,
        },
        saleProducts: {
          id: true,
          name: true,
          amount: true,
          price: true,
          total: true,
          fileNumbers: {
            id: true,
            fileNumber: true,
          },
          product: {
            id: true,
            group: {
              name: true,
            },
          },
        },
        voucher: {
          id: true,
          customer: true,
          identityCardCustomer: true,
          paymentLocation: true,
          receiptNumber: true,
          description: true,
          paymentTypeState: true,
          depositDate: true,
          total: true,
          createdAt: true,
          paymentType: {
            id: true,
            name: true,
            shortened: true,
          },
        },
      },
      where: { id: saleId },
      relations: {
        cancellation: true,
        parameter: true,
        saleProducts: {
          fileNumbers: true,
          product: {
            group: true,
          },
        },
        voucher: {
          paymentType: true,
        },
      },
    });

    if (!sale) {
      throw new RpcException({
        code: HttpStatus.NOT_FOUND,
        message: `La venta con el ID ${saleId} no existe.`,
      });
    }

    if (sale.saleState !== SaleState.VIGENTE) {
      throw new RpcException({
        code: HttpStatus.CONFLICT,
        message:
          sale.saleState === SaleState.ANULADO
            ? 'No se puede generar el recibo porque la venta está anulada.'
            : `No se puede generar el recibo porque la venta no está VIGENTE. Estado actual: ${sale.saleState}.`,
      });
    }

    const voucher = sale.voucher;

    if (!voucher) {
      throw new RpcException({
        code: HttpStatus.NOT_FOUND,
        message: 'La venta no tiene comprobante asociado.',
      });
    }

    const personResult = await this.personDetailsById(sale.personId);

    if (personResult.error || !personResult.data) {
      throw new RpcException({
        code: HttpStatus.NOT_FOUND,
        message:
          personResult.message ??
          'No se pudieron obtener los datos del titular de la venta.',
      });
    }

    const principalCustomer = personResult.data;
    const paymentType = voucher.paymentType;
    const products = sale.saleProducts ?? [];

    const data = {
      sale: {
        code: this.formatSaleCode(sale.code, sale.createdAt),
        state: sale.saleState,
        personId: sale.personId,
        receptionist: sale.receptionist,
        createdAt: this.formatDate(sale.createdAt),
        cancellation: sale.cancellation
          ? {
              reason: sale.cancellation.reason,
              cancelledByUser: sale.cancellation.cancelledByUser,
              cancelledAt: this.formatDate(sale.cancellation.cancelledAt),
            }
          : null,
      },
      principalCustomer: {
        fullName: principalCustomer.fullName,
        identityCard: principalCustomer.identityCard,
      },
      payer: {
        customer: voucher.customer,
        identityCardCustomer: voucher.identityCardCustomer,
        isThirdParty: this.isThirdPartyPayer(
          principalCustomer.identityCard,
          voucher.identityCardCustomer,
        ),
      },
      voucher: {
        receiptNumber: voucher.receiptNumber,
        description: voucher.description,
        paymentTypeState: voucher.paymentTypeState,
        depositDate: voucher.depositDate
          ? this.formatDate(voucher.depositDate)
          : null,
        paymentLocation: voucher.paymentLocation,
        createdAt: this.formatDate(voucher.createdAt),
        total: this.formatAmount(voucher.total),
      },
      payment: {
        type: paymentType
          ? {
              name: paymentType.name,
              shortened: paymentType.shortened,
            }
          : null,
      },
      currency: {
        symbol: sale.parameter?.currencySymbol ?? null,
      },
      products: products.map((product) => {
        const fileNumbers = (product.fileNumbers ?? []).map(
          (fileNumber) => fileNumber.fileNumber,
        );

        return {
          productId: product.product.id,
          name: product.name,
          groupName: product.product.group.name.toUpperCase(),
          fileNumbers,
          amount: product.amount,
          price: this.formatAmount(product.price),
          total: this.formatAmount(product.total),
        };
      }),
      totals: {
        productCount: products.length,
        quantity: products.reduce(
          (total, product) => total + Number(product.amount ?? 0),
          0,
        ),
        amount: this.formatAmount(voucher.total),
      },
      metadata: {
        source: 'Sales-Service',
        generatedFor: 'receipt',
        generatedAt: this.formatDate(new Date()),
      },
    };

    return {
      error: false,
      message: 'Detalle de venta obtenido correctamente.',
      data,
    };
  }

  async salesList(filters: SalesListDto = {}): Promise<any> {
    try {
      return await this.buildSalesListResponse(filters);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logError('Error al obtener el listado de ventas', error);

      return {
        error: true,
        message: 'Error al obtener el listado de ventas.',
        data: null,
      };
    }
  }

  private async buildSalesListResponse(filters: SalesListDto): Promise<any> {
    const page = filters.page ?? 1;
    const hasLimit = filters.limit !== undefined && filters.limit !== null;
    const normalizedLimit = filters.limit ?? 0;
    const dateRange = this.validateSalesListDateRange(
      filters.dateFrom,
      filters.dateTo,
    );

    const voucherCreatedAt = this.buildVoucherCreatedAtFindOperator(
      dateRange.from,
      dateRange.to,
    );
    const where = {
      sale: {
        saleState: SaleState.VIGENTE,
        ...(voucherCreatedAt
          ? {
              voucher: {
                createdAt: voucherCreatedAt,
              },
            }
          : {}),
      },
    };

    const [saleProducts, totalItems] =
      await this.saleProductsRepository.findAndCount({
        select: {
          id: true,
          name: true,
          amount: true,
          price: true,
          total: true,
          sale: {
            id: true,
            code: true,
            createdAt: true,
            saleState: true,
            personId: true,
            receptionist: true,
            parameter: {
              id: true,
              currencySymbol: true,
            },
            voucher: {
              id: true,
              createdAt: true,
              total: true,
              paymentType: {
                id: true,
                name: true,
              },
            },
          },
        },
        where,
        relations: {
          sale: {
            parameter: true,
            voucher: {
              paymentType: true,
            },
          },
        },
        order: {
          sale: {
            voucher: {
              createdAt: 'ASC',
            },
            id: 'DESC',
          },
          id: 'ASC',
        },
        ...(hasLimit
          ? {
              skip: (page - 1) * normalizedLimit,
              take: normalizedLimit,
            }
          : {}),
      });

    const personIds = [
      ...new Set(
        saleProducts
          .map((saleProduct) => saleProduct.sale?.personId)
          .filter((personId) => Number.isInteger(Number(personId))),
      ),
    ];
    const people = await Promise.all(
      personIds.map((personId) => this.personDetailsById(Number(personId))),
    );
    const peopleById = new Map(
      personIds.map((personId, index) => [Number(personId), people[index]]),
    );

    const items: SalesListItemReportDto[] = saleProducts.map((saleProduct) => {
      const sale = saleProduct.sale;
      const voucher = sale?.voucher ?? null;
      const personResult = peopleById.get(Number(sale?.personId));
      const principalCustomer = this.formatPersonName(
        personResult?.data?.fullName,
      );

      return {
        code: sale ? this.formatSaleCode(sale.code, sale.createdAt) : null,
        receptionDate: voucher?.createdAt
          ? this.formatDate(voucher.createdAt)
          : null,
        principalCustomer,
        service: saleProduct.name,
        amount: Number(saleProduct.amount ?? 0),
        price: this.formatAmount(saleProduct.price),
        paymentType: voucher?.paymentType?.name ?? '',
        total: `${this.formatAmount(voucher?.total ?? null)} ${
          sale?.parameter?.currencySymbol ?? ''
        }`.trim(),
        receptionist: sale?.receptionist ?? '',
      };
    });

    const data = {
      sales: items,
      totalItems,
      pagination: hasLimit
        ? {
            page,
            limit: normalizedLimit,
            totalItems,
            totalPages: Math.ceil(totalItems / normalizedLimit),
            hasPreviousPage: page > 1,
            hasNextPage: page * normalizedLimit < totalItems,
          }
        : null,
      filters: {
        dateFrom: dateRange.from ? this.formatDate(dateRange.from) : null,
        dateTo: dateRange.to ? this.formatDate(dateRange.to) : null,
      },
      metadata: {
        source: 'Sales',
        generatedFor: 'reportSales',
        generatedAt: this.formatDate(new Date()),
      },
    };

    return {
      error: false,
      message: 'Listado de ventas obtenido correctamente.',
      data,
    };
  }

  private isThirdPartyPayer(
    principalIdentityCard: string | null,
    payerIdentityCard: string | null,
  ): boolean {
    const principal = this.normalizeIdentityCard(principalIdentityCard);
    const payer = this.normalizeIdentityCard(payerIdentityCard);

    return Boolean(principal && payer && principal !== payer);
  }

  private normalizeIdentityCard(value: string | null): string {
    return String(value ?? '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
  }

  private formatPersonName(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('es-BO')
      .replace(/(^|[\s'-])\p{L}/gu, (letter) =>
        letter.toLocaleUpperCase('es-BO'),
      );
  }

  private formatAmount(value: string | number | null): string {
    const amount = Number(value ?? 0);

    return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
  }

  private validateSalesListDateRange(
    dateFrom?: string,
    dateTo?: string,
  ): {
    from: Date | null;
    to: Date | null;
  } {
    const from = this.parseReportDate(dateFrom, 'start');
    const to = this.parseReportDate(dateTo, 'end');

    if (dateFrom && !from) {
      throw new BadRequestException(
        `dateFrom "${dateFrom}" no es una fecha válida.`,
      );
    }

    if (dateTo && !to) {
      throw new BadRequestException(
        `dateTo "${dateTo}" no es una fecha válida.`,
      );
    }

    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        `dateFrom "${dateFrom}" no puede ser posterior a dateTo "${dateTo}".`,
      );
    }

    return {
      from,
      to,
    };
  }

  private buildVoucherCreatedAtFindOperator(
    from: Date | null,
    to: Date | null,
  ) {
    if (from && to) {
      return Between(from, to);
    }

    if (from) {
      return MoreThanOrEqual(from);
    }

    if (to) {
      return LessThanOrEqual(to);
    }

    return null;
  }

  private parseReportDate(
    value: string | undefined,
    boundary: 'start' | 'end',
  ): Date | null {
    if (!value) {
      return null;
    }

    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? boundary === 'start'
        ? `${value}T00:00:00.000-04:00`
        : `${value}T23:59:59.999-04:00`
      : value;
    const date = new Date(normalized);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  async getPersonSalesRecords(personId: number): Promise<any> {
    const { serviceStatus, data } = await this.nats.firstValue(
      'sales.record.findPerson',
      {
        personId,
      },
    );

    if (!serviceStatus) {
      return {
        error: true,
        message: 'Servicio de Registros de ventas no disponible',
        data: [],
      };
    }

    return {
      error: false,
      message: 'Historial de ventas obtenido',
      data,
    };
  }
}
