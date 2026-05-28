import { describe, expect, it } from 'vitest';
import { toastDuration } from '../src/components/ui/toast.js';

describe('toast helpers', () => {
  it('keeps errors until dismissed and auto-dismisses success toasts', () => {
    expect(toastDuration({ kind: 'error', message: 'failed' })).toBeNull();
    expect(toastDuration({ kind: 'success', message: 'saved' })).toBe(3000);
  });
});
