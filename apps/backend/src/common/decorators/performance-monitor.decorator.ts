import { SetMetadata } from '@nestjs/common';

export const PERFORMANCE_MONITOR_KEY = 'performance_monitor';

/**
 * Decorator to enable performance monitoring for specific endpoints
 *
 * @param options - Performance monitoring options
 * @example
 * ```typescript
 * @PerformanceMonitor({ threshold: 1000, logSlowQueries: true })
 * @Get('heavy-operation')
 * heavyOperation() {
 *   return this.service.heavyOperation();
 * }
 * ```
 */
export const PerformanceMonitor = (
  options: {
    threshold?: number; // milliseconds
    logSlowQueries?: boolean;
    trackMemory?: boolean;
  } = {},
) =>
  SetMetadata(PERFORMANCE_MONITOR_KEY, {
    threshold: 500, // default 500ms
    logSlowQueries: false,
    trackMemory: false,
    ...options,
  });
