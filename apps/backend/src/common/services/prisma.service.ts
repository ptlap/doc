import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
// no express types needed here

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private tenantIdForRequest?: string;

  public setTenantId(tenantId?: string): void {
    this.tenantIdForRequest =
      typeof tenantId === 'string' ? tenantId : undefined;
  }

  public clearTenantId(): void {
    this.tenantIdForRequest = undefined;
  }

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to database');

    // Prisma middleware: enforce tenantId filtering and auto-populate on create
    this.$use(
      async (
        params: Prisma.MiddlewareParams,
        next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
      ): Promise<unknown> => {
        const modelsWithTenant = new Set([
          'Project',
          'Document',
          'Conversation',
          'Message',
          // include additional models if needed in the future
        ]);
        const whereCapableActions = new Set([
          'findMany',
          'findFirst',
          'findUnique',
          'count',
          'aggregate',
          'updateMany',
          'deleteMany',
        ]);
        const createActions = new Set(['create', 'createMany']);

        const model =
          typeof params.model === 'string' ? params.model : undefined;
        const action =
          typeof params.action === 'string' ? params.action : undefined;
        const tenantId = this.tenantIdForRequest;

        const isObject = (val: unknown): val is Record<string, unknown> =>
          typeof val === 'object' && val !== null;

        // Filter by tenant for supported read/update-many actions
        if (
          tenantId &&
          model &&
          modelsWithTenant.has(model) &&
          action &&
          whereCapableActions.has(action)
        ) {
          if (!isObject(params.args)) {
            params.args = { where: { tenantId } };
          } else {
            const argsObj = params.args as Record<string, unknown> & {
              where?: Record<string, unknown>;
            };
            const currentWhere = isObject(argsObj.where)
              ? argsObj.where
              : undefined;
            // Do not add tenantId filter for User model to avoid UUID/text errors on raw queries
            if (model !== 'User') {
              argsObj.where = currentWhere
                ? { ...currentWhere, tenantId }
                : { tenantId };
            }
          }
        }

        // Auto-populate tenantId on create for supported models
        if (
          tenantId &&
          model &&
          modelsWithTenant.has(model) &&
          action &&
          createActions.has(action)
        ) {
          if (isObject(params.args)) {
            const argsObj = params.args as Record<string, unknown> & {
              data?: unknown;
            };
            const dataValue = argsObj.data;
            if (Array.isArray(dataValue)) {
              argsObj.data = dataValue.map((d: unknown) =>
                isObject(d) ? { ...d, tenantId } : d,
              );
            } else if (isObject(dataValue)) {
              argsObj.data = { ...dataValue, tenantId };
            }
          }
        }

        const result: unknown = await next(params);
        return result;
      },
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }

  enableShutdownHooks(app: { close: () => Promise<void> }) {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
