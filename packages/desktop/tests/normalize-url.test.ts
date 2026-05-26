import { describe, it, expect } from 'vitest';
import { normalizeUrl, urlHash } from '../src/main/pipeline/normalize-url.js';

describe('normalizeUrl', () => {
  it('upgrades http to https', () => {
    expect(normalizeUrl('http://example.com')).toBe('https://example.com/');
  });

  it('removes www prefix', () => {
    expect(normalizeUrl('https://www.example.com/page')).toBe('https://example.com/page');
  });

  it('removes trailing slash', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('keeps root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('strips utm tracking params', () => {
    const url = 'https://example.com/article?utm_source=twitter&utm_medium=social&id=123';
    expect(normalizeUrl(url)).toBe('https://example.com/article?id=123');
  });

  it('strips fbclid', () => {
    const url = 'https://example.com/page?fbclid=abc123&q=test';
    expect(normalizeUrl(url)).toBe('https://example.com/page?q=test');
  });

  it('removes fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('sorts remaining params', () => {
    const url = 'https://example.com/search?z=1&a=2';
    expect(normalizeUrl(url)).toBe('https://example.com/search?a=2&z=1');
  });

  it('returns invalid URLs unchanged', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('urlHash', () => {
  it('generates 6 character hex string', () => {
    const hash = urlHash('https://example.com');
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
  });

  it('same URL produces same hash', () => {
    expect(urlHash('https://example.com')).toBe(urlHash('https://example.com'));
  });

  it('normalizes before hashing', () => {
    // http vs https should produce same hash
    expect(urlHash('http://example.com')).toBe(urlHash('https://example.com'));
  });
});
