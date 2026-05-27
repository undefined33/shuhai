import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOldLogFiles,
  configureLogger,
  createLogger,
  initializeLogging,
} from '../src/main/logger.js';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  configureLogger({
    logsDir: null,
    now: () => new Date(),
    console,
  });
});

describe('structured logger', () => {
  it('writes JSON lines and redacts secret fields', () => {
    tempDir = join(tmpdir(), `shuhai-logs-${crypto.randomUUID()}`);
    const consoleMock = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    configureLogger({
      now: () => new Date('2024-02-01T12:00:00.000Z'),
      console: consoleMock,
    });
    const logsDir = initializeLogging(tempDir);

    createLogger('test').info('saved config', {
      apiKey: 'sk-secret',
      nested: { password: 'pw', tokenCount: 12 },
    });

    const log = readFileSync(join(logsDir, 'shuhai-2024-02-01.log'), 'utf-8');
    const entry = JSON.parse(log) as Record<string, unknown>;

    expect(entry).toMatchObject({
      timestamp: '2024-02-01T12:00:00.000Z',
      level: 'info',
      module: 'test',
      message: 'saved config',
      context: {
        apiKey: '[REDACTED]',
        nested: {
          password: '[REDACTED]',
          tokenCount: 12,
        },
      },
    });
    expect(log).not.toContain('sk-secret');
    expect(log).not.toContain('pw');
    expect(consoleMock.info).toHaveBeenCalled();
  });

  it('keeps only the newest log files', () => {
    tempDir = join(tmpdir(), `shuhai-logs-${crypto.randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });

    for (let day = 1; day <= 9; day++) {
      const file = join(tempDir, `shuhai-2024-02-0${day}.log`);
      writeFileSync(file, `${day}`);
      const timestamp = new Date(`2024-02-0${day}T00:00:00.000Z`);
      utimesSync(file, timestamp, timestamp);
    }

    cleanupOldLogFiles(tempDir, 7);

    expect(() => readFileSync(join(tempDir, 'shuhai-2024-02-01.log'))).toThrow();
    expect(readFileSync(join(tempDir, 'shuhai-2024-02-09.log'), 'utf-8')).toBe('9');
  });
});
