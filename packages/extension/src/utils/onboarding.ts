import type { AppSettings, ExportManifest } from '../shared/bookmark-types.js';

export interface OnboardingProgress {
  vaultConfigured: boolean;
  providerConfigured: boolean;
  firstClassifyDone: boolean;
  firstExportDone: boolean;
}

interface OnboardingProgressInput {
  hasVaultHandle: boolean;
  settings: AppSettings;
  lastMoveRecordCount: number;
  exportManifests: ExportManifest[];
}

export function computeOnboardingProgress({
  hasVaultHandle,
  settings,
  lastMoveRecordCount,
  exportManifests,
}: OnboardingProgressInput): OnboardingProgress {
  const activeProvider = settings.aiProviders.find(
    (provider) => provider.id === settings.activeProviderId,
  );

  return {
    vaultConfigured: hasVaultHandle,
    providerConfigured: Boolean(
      settings.useAi &&
        activeProvider?.enabled &&
        activeProvider.hasApiKey &&
        activeProvider.model.trim(),
    ),
    firstClassifyDone: lastMoveRecordCount > 0,
    firstExportDone: exportManifests.length > 0,
  };
}

export function onboardingComplete(progress: OnboardingProgress): boolean {
  return (
    progress.vaultConfigured &&
    progress.providerConfigured &&
    progress.firstClassifyDone &&
    progress.firstExportDone
  );
}
