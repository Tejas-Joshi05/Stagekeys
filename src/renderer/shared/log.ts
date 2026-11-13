import type { LogLevel } from '../../ipc/contract';
import { api, hasApi } from './api';

function write(level: LogLevel, message: string, data?: unknown): void {
  try {
    if (hasApi()) api().log(level, message, data);
    else if (level === 'error' || level === 'warn')
      console.warn(`[${level}] ${message}`, data ?? '');
  } catch {
    // Logging must never throw.
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => write('debug', message, data),
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
