import { describe, expect, it } from 'vitest';
import { errorMessage, messageClassName, userMessage } from '../src/renderer/message.js';

describe('renderer message helpers', () => {
  it('formats typed message class names', () => {
    expect(messageClassName(userMessage('success', '已保存'))).toBe('notice success');
    expect(messageClassName(userMessage('error', '失败'))).toBe('notice error');
  });

  it('formats user visible errors with a recovery prefix', () => {
    expect(errorMessage(new Error('Vault 不存在'), '保存失败')).toEqual({
      type: 'error',
      text: '保存失败：Vault 不存在',
    });
  });
});
