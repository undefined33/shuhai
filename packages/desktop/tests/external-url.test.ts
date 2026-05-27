import { describe, expect, it } from 'vitest';
import {
  assertAllowedExternalUrl,
  isAllowedExternalUrl,
} from '../src/main/external-url.js';

describe('external URL guard', () => {
  it('allows only http and https URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/docs')).toBe(true);
    expect(isAllowedExternalUrl('http://example.com/docs')).toBe(true);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Users/test/secret.txt')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });

  it('throws a Chinese recovery hint for blocked URLs', () => {
    expect(() => assertAllowedExternalUrl('javascript:alert(1)')).toThrow(
      '只能打开 http 或 https 链接',
    );
  });
});
