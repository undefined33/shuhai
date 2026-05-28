import { describe, expect, it } from 'vitest';
import { getOnboarded, saveOnboarded } from '../src/utils/storage.js';
import { getStorageSnapshot } from './setup.js';

describe('storage helpers', () => {
  it('defaults onboarding to false', async () => {
    await expect(getOnboarded()).resolves.toBe(false);
  });

  it('persists onboarding state', async () => {
    await saveOnboarded(true);

    expect(getStorageSnapshot()).toMatchObject({
      onboarded: true,
    });
    await expect(getOnboarded()).resolves.toBe(true);
  });
});
