import type { PropsWithChildren } from 'react';

type Page = 'bookmarks' | 'settings';

interface LayoutProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export function Layout({ activePage, onNavigate, children }: PropsWithChildren<LayoutProps>) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">书</span>
          <div>
            <strong>ShuHai</strong>
            <span>书海</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <button
            type="button"
            className={activePage === 'bookmarks' ? 'active' : ''}
            aria-current={activePage === 'bookmarks' ? 'page' : undefined}
            onClick={() => onNavigate('bookmarks')}
          >
            书签
          </button>
          <button
            type="button"
            className={activePage === 'settings' ? 'active' : ''}
            aria-current={activePage === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate('settings')}
          >
            设置
          </button>
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
