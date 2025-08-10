import { Injectable, Logger } from '@nestjs/common';

export interface CircuitBreakerOptions {
  failureThreshold: number; // consecutive failures to open
  cooldownMs: number; // time window to half-open
  successThreshold: number; // successes to close from half-open
}

type State = 'closed' | 'open' | 'half-open';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private state: State = 'closed';
  private failures = 0;
  private successes = 0;
  private nextAttemptTs = 0;
  private readonly options: CircuitBreakerOptions = {
    failureThreshold: 3,
    cooldownMs: 30000,
    successThreshold: 2,
  };

  configure(options: Partial<CircuitBreakerOptions>): void {
    if (typeof options.failureThreshold === 'number') {
      this.options.failureThreshold = options.failureThreshold;
    }
    if (typeof options.cooldownMs === 'number') {
      this.options.cooldownMs = options.cooldownMs;
    }
    if (typeof options.successThreshold === 'number') {
      this.options.successThreshold = options.successThreshold;
    }
  }

  async exec<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.state === 'open') {
      if (now >= this.nextAttemptTs) {
        this.state = 'half-open';
        this.logger.warn('Circuit moved to half-open');
      } else {
        this.logger.warn('Circuit open; using fallback');
        return fallback();
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      this.logger.warn(
        `Circuit failure: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback();
    }
  }

  private recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successes += 1;
      if (this.successes >= this.options.successThreshold) {
        this.close();
      }
    } else {
      this.reset();
    }
  }

  private recordFailure(): void {
    this.failures += 1;
    if (
      this.state === 'half-open' ||
      this.failures >= this.options.failureThreshold
    ) {
      this.open();
    }
  }

  private open(): void {
    this.state = 'open';
    this.nextAttemptTs = Date.now() + this.options.cooldownMs;
    this.failures = 0;
    this.successes = 0;
    this.logger.warn('Circuit opened');
  }

  private close(): void {
    this.state = 'closed';
    this.reset();
    this.logger.log('Circuit closed');
  }

  private reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.nextAttemptTs = 0;
  }
}
