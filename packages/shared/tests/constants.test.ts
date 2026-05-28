import { describe, it, expect } from 'vitest';
import {
  AI_BATCH_SIZE,
  DEFAULT_PORT,
  DOMAIN_RATE_LIMIT_MS,
  URL_CHECK_CONCURRENCY,
} from '../src/constants.js';

describe('constants', () => {
  it('has correct default values', () => {
    expect(DEFAULT_PORT).toBe(39281);
    expect(AI_BATCH_SIZE).toBe(50);
    expect(URL_CHECK_CONCURRENCY).toBe(5);
    expect(DOMAIN_RATE_LIMIT_MS).toBe(2000);
  });
});
