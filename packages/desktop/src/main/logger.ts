import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

interface LoggerState {
  logsDir: string | null;
  getUserDataPath: () => string;
  now: () => Date;
  console: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

export interface StructuredLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const LOG_FILE_PREFIX = 'shuhai-';
const LOG_FILE_SUFFIX = '.log';
const MAX_LOG_FILES = 7;

const state: LoggerState = {
  logsDir: null,
  getUserDataPath: getDefaultUserDataPath,
  now: () => new Date(),
  console,
};

export function configureLogger(overrides: Partial<LoggerState>): void {
  if (overrides.logsDir !== undefined) {
    state.logsDir = overrides.logsDir;
  }
  if (overrides.getUserDataPath) {
    state.getUserDataPath = overrides.getUserDataPath;
  }
  if (overrides.now) {
    state.now = overrides.now;
  }
  if (overrides.console) {
    state.console = overrides.console;
  }
}

export function initializeLogging(userDataPath = state.getUserDataPath()): string {
  const logsDir = getLogsDirectory(userDataPath);
  mkdirSync(logsDir, { recursive: true });
  cleanupOldLogFiles(logsDir);
  state.logsDir = logsDir;
  return logsDir;
}

export function getLogsDirectory(userDataPath = state.getUserDataPath()): string {
  return join(userDataPath, 'logs');
}

export function createLogger(module: string): StructuredLogger {
  return {
    debug: (message, context) => writeLog('debug', module, message, context),
    info: (message, context) => writeLog('info', module, message, context),
    warn: (message, context) => writeLog('warn', module, message, context),
    error: (message, context) => writeLog('error', module, message, context),
  };
}

export function cleanupOldLogFiles(logsDir: string, keep = MAX_LOG_FILES): void {
  if (!existsSync(logsDir)) {
    return;
  }

  const logFiles = readdirSync(logsDir)
    .filter((file) => file.startsWith(LOG_FILE_PREFIX) && file.endsWith(LOG_FILE_SUFFIX))
    .map((file) => join(logsDir, file))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  for (const staleFile of logFiles.slice(keep)) {
    unlinkSync(staleFile);
  }
}

function writeLog(
  level: LogLevel,
  module: string,
  message: string,
  context?: LogContext,
): void {
  const logsDir = state.logsDir ?? initializeLogging();
  const entry = {
    timestamp: state.now().toISOString(),
    level,
    module,
    message,
    context: sanitizeLogValue(context ?? {}),
  };

  appendFileSync(getCurrentLogPath(logsDir), `${JSON.stringify(entry)}\n`, 'utf-8');
  writeConsole(level, module, message, entry.context);
}

function getCurrentLogPath(logsDir: string): string {
  return join(logsDir, `${LOG_FILE_PREFIX}${state.now().toISOString().slice(0, 10)}${LOG_FILE_SUFFIX}`);
}

function writeConsole(
  level: LogLevel,
  module: string,
  message: string,
  context: unknown,
): void {
  state.console[level](`[ShuHai] [${module}] ${message}`, context);
}

function sanitizeLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, seen));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSecretKey(key) ? '[REDACTED]' : sanitizeLogValue(item, seen),
    ]),
  );
}

function isSecretKey(key: string): boolean {
  return /api[-_]?key|authorization|password|secret/i.test(key);
}

function getDefaultUserDataPath(): string {
  try {
    return app?.getPath('userData') ?? join(tmpdir(), 'ShuHai');
  } catch {
    return join(tmpdir(), 'ShuHai');
  }
}
