import { describe, expect, it } from 'vitest';
import { inferErrorCode, toStructuredError } from '../src/utils/error-messages.js';

describe('error messages', () => {
  it.each([
    ['AI request failed: 401 unauthorized', 'AI_KEY_INVALID'],
    ['AI request failed: 429 quota exceeded', 'AI_QUOTA_EXCEEDED'],
    ['Failed to fetch', 'AI_NETWORK_ERROR'],
    ['没有 Vault 写入权限，请重新选择目录', 'VAULT_PERMISSION_DENIED'],
    ['请先打开一条推文的详情页（点击推文进入）', 'EXTRACT_NOT_DETAIL_PAGE'],
    ['signal is aborted without reason', 'HEALTH_ABORTED'],
  ])('maps %s to %s', (message, code) => {
    expect(inferErrorCode(new Error(message))).toBe(code);
  });

  it('returns human-readable recovery copy', () => {
    const error = toStructuredError(new Error('AI request failed: 401 unauthorized'));

    expect(error).toMatchObject({
      code: 'AI_KEY_INVALID',
      message: 'API Key 无效或已过期',
      action: { handler: 'openSettings' },
    });
  });
});
