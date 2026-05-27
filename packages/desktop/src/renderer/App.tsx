import { useEffect, useCallback, useState } from 'react';
import { Layout } from './components/Layout.js';
import { BookmarkList } from './pages/BookmarkList.js';
import { Settings } from './pages/Settings.js';
import { Setup } from './pages/Setup.js';
import { UNSAVED_SETTINGS_MESSAGE } from './pages/settings-view-model.js';
import { formatAppLoadError } from './app-view-model.js';
import type { AppConfig } from '../main/app-config.js';

type Page = 'bookmarks' | 'settings';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [page, setPage] = useState<Page>('bookmarks');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);

  const loadAppConfig = useCallback(() => {
    setIsLoading(true);
    setError(null);
    window.shuhai.getConfig()
      .then(setConfig)
      .catch((reason: unknown) => {
        setError(formatAppLoadError(reason));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    loadAppConfig();
  }, [loadAppConfig]);

  if (isLoading) {
    return <main className="loading-screen">正在打开书海...</main>;
  }

  if (error) {
    return (
      <main className="error-screen">
        <div className="error-panel">
          <p>{error}</p>
          <button type="button" onClick={loadAppConfig}>
            重试
          </button>
        </div>
      </main>
    );
  }

  if (!config?.firstRunComplete) {
    return (
      <Setup
        onComplete={(nextConfig) => {
          setConfig(nextConfig);
          setPage('bookmarks');
        }}
      />
    );
  }

  function navigate(nextPage: Page): void {
    if (page === 'settings' && nextPage !== 'settings' && isSettingsDirty) {
      const confirmed = window.confirm(UNSAVED_SETTINGS_MESSAGE);
      if (!confirmed) {
        return;
      }
    }

    setPage(nextPage);
  }

  return (
    <Layout activePage={page} onNavigate={navigate}>
      {page === 'bookmarks' ? (
        <BookmarkList config={config} onConfigChange={setConfig} />
      ) : (
        <Settings
          config={config}
          onConfigChange={setConfig}
          onDirtyChange={setIsSettingsDirty}
        />
      )}
    </Layout>
  );
}
