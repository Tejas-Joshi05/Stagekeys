import { appendFile, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LogLevel } from '../ipc/contract';

const MAX_BYTES = 5 * 1024 * 1024;

let logDir = '';
let logFile = '';
let pendingBytes = 0;

export function initLog(dir: string): void {
  logDir = dir;
  logFile = path.join(dir, 'stagekeys.log');
  try {
    mkdirSync(dir, { recursive: true });
    pendingBytes = statSync(logFile).size;
  } catch {
    pendingBytes = 0;
  }
}

export function getLogDir(): string {
  return logDir;
}

function rotateIfNeeded(): void {
  if (pendingBytes < MAX_BYTES) return;
  try {
    renameSync(logFile, path.join(logDir, 'stagekeys.previous.log'));
  } catch {
    // If rotation fails we keep appending; logging must never throw.
  }
  pendingBytes = 0;
}

export function log(level: LogLevel, source: string, message: string, data?: unknown): void {
  if (!logFile) return;
  let extra = '';
  if (data !== undefined) {
    try {
      extra = ' ' + JSON.stringify(data);
    } catch {
      extra = ' [unserialisable data]';
    }
  }
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${message}${extra}\n`;
  pendingBytes += line.length;
  rotateIfNeeded();
  appendFile(logFile, line, () => undefined);
  if (level === 'error') console.error(line.trimEnd());
}
