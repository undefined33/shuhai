import { describe, expect, it } from 'vitest';
import { isPrivateIp, isSafeUrl, resolveSafeUrl } from '../src/main/health/ssrf-guard.js';

describe('SSRF guard', () => {
  it('detects private IPv4 and IPv6 ranges', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('169.254.1.1')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12::1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);

    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
  });

  it('rejects non-http URLs and direct private hosts', () => {
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('chrome://settings')).toBe(false);
    expect(isSafeUrl('about:blank')).toBe(false);
    expect(isSafeUrl('http://localhost:3000')).toBe(false);
    expect(isSafeUrl('http://127.0.0.1/admin')).toBe(false);
    expect(isSafeUrl('http://10.0.0.8')).toBe(false);
    expect(isSafeUrl('http://[::1]/')).toBe(false);

    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('https://8.8.8.8')).toBe(true);
  });

  it('rejects domains that resolve to private addresses', async () => {
    await expect(resolveSafeUrl('https://safe.example', async () => ['93.184.216.34']))
      .resolves.toBe(true);
    await expect(resolveSafeUrl('https://internal.example', async () => ['192.168.1.10']))
      .resolves.toBe(false);
  });
});
