import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextStore {
  correlationId?: string;
  userId?: string;
  tenantId?: string;
}

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextStore>();

  runWith<T>(store: RequestContextStore, callback: () => T): T {
    return this.als.run(store, callback);
  }

  get<T extends keyof RequestContextStore>(key: T): RequestContextStore[T] {
    const store = this.als.getStore();
    return store ? store[key] : undefined;
  }

  set<T extends keyof RequestContextStore>(
    key: T,
    value: RequestContextStore[T],
  ): void {
    const store = this.als.getStore();
    if (store) {
      // mutate in-place to preserve reference
      (store as Record<string, unknown>)[key as string] = value as unknown;
    }
  }
}
