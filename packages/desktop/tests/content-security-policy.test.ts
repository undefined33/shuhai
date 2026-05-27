import { describe, expect, it } from 'vitest';
import {
  CONTENT_SECURITY_POLICY,
  withContentSecurityPolicy,
} from '../src/main/content-security-policy.js';

describe('content security policy', () => {
  it('blocks external scripts while allowing DeepSeek API connections', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self' https://api.deepseek.com");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it('adds the CSP response header without dropping existing headers', () => {
    expect(withContentSecurityPolicy({ 'X-Test': ['ok'] })).toMatchObject({
      'X-Test': ['ok'],
      'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
    });
  });
});
