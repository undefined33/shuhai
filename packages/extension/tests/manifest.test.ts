import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as {
  content_scripts?: Array<{ js?: string[]; matches?: string[] }>;
  host_permissions?: string[];
  optional_host_permissions?: string[];
  permissions?: string[];
  side_panel?: { default_path?: string };
};

describe('extension manifest', () => {
  it('declares the Chrome side panel entry', () => {
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel?.default_path).toBe('sidepanel/index.html');
  });

  it('uses activeTab and scripting for user-triggered article extraction', () => {
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('scripting');
  });

  it('requests broad URL access only as an optional health-check permission', () => {
    expect(manifest.permissions).not.toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  });

  it('does not grant or statically inject X and Twitter access', () => {
    expect(manifest.host_permissions).toEqual(['https://weibo.com/*', 'https://m.weibo.cn/*']);
    expect(manifest.host_permissions).not.toContain('https://x.com/*');
    expect(manifest.host_permissions).not.toContain('https://twitter.com/*');

    const staticMatches = (manifest.content_scripts ?? []).flatMap(
      (contentScript) => contentScript.matches ?? [],
    );
    const staticScripts = (manifest.content_scripts ?? []).flatMap(
      (contentScript) => contentScript.js ?? [],
    );
    expect(staticMatches).not.toContain('https://x.com/*');
    expect(staticMatches).not.toContain('https://twitter.com/*');
    expect(staticScripts).not.toContain('content/twitter.js');
    expect(staticMatches).toEqual(['https://weibo.com/*', 'https://m.weibo.cn/*']);
  });
});
