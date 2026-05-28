import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/utils/storage.js';
import { computeOnboardingProgress, onboardingComplete } from '../src/utils/onboarding.js';
import { createProviderFromTemplate, providerTemplate } from '../src/shared/ai-providers.js';

describe('onboarding progress', () => {
  it('requires vault, configured provider, first classify, and first export', () => {
    const provider = createProviderFromTemplate(providerTemplate('deepseek'), {
      id: 'deepseek-ready',
      apiKey: 'sk-test',
      enabled: true,
    });
    const progress = computeOnboardingProgress({
      hasVaultHandle: true,
      settings: {
        ...DEFAULT_SETTINGS,
        useAi: true,
        activeProviderId: provider.id,
        aiProviders: [provider],
      },
      lastMoveRecordCount: 3,
      exportManifests: [
        {
          id: 'manifest-1',
          exportedAt: new Date(0).toISOString(),
          vaultPath: 'Vault',
          files: ['Bookmarks/a.md'],
          bookmarkCount: 1,
        },
      ],
    });

    expect(progress).toEqual({
      vaultConfigured: true,
      providerConfigured: true,
      firstClassifyDone: true,
      firstExportDone: true,
    });
    expect(onboardingComplete(progress)).toBe(true);
  });

  it('does not treat default provider templates without api keys as configured', () => {
    const progress = computeOnboardingProgress({
      hasVaultHandle: false,
      settings: DEFAULT_SETTINGS,
      lastMoveRecordCount: 0,
      exportManifests: [],
    });

    expect(progress.providerConfigured).toBe(false);
    expect(onboardingComplete(progress)).toBe(false);
  });
});
