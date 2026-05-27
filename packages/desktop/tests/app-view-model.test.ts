import { describe, expect, it } from 'vitest';
import { formatAppLoadError } from '../src/renderer/app-view-model.js';

describe('App view model', () => {
  it('formats renderer startup errors with a retry recovery path', () => {
    expect(formatAppLoadError(new Error('config missing'))).toBe(
      '应用配置加载失败：config missing。请点击重试；如果仍然失败，请重新打开应用。',
    );
  });
});
