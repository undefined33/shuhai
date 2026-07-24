import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { assertClassicContentScript, finalizeClassicContentScript } from '../vite.config.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as {
  content_scripts?: Array<{ js?: string[]; matches?: string[] }>;
  host_permissions?: string[];
  key?: string;
  optional_host_permissions?: string[];
  permissions?: string[];
  side_panel?: { default_path?: string };
};
const popupStyles = readFileSync(new URL('../src/popup/styles.css', import.meta.url), 'utf8');
const EXPECTED_EXTENSION_ID = 'jdjmpeogiojjhdabdjmpeclcbjcekbje';

function extensionIdFromPublicKey(publicKeyDer: Buffer): string {
  const alphabet = 'abcdefghijklmnop';
  const digest = createHash('sha256').update(publicKeyDer).digest();

  return [...digest.subarray(0, 16)]
    .map((byte) => alphabet.charAt(byte >> 4) + alphabet.charAt(byte & 0x0f))
    .join('');
}

describe('extension manifest', () => {
  it('pins a stable development ID from an RSA 2048 public key', () => {
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    const publicKeyDer = Buffer.from(manifest.key ?? '', 'base64');
    expect(publicKeyDer.toString('base64')).toBe(manifest.key);

    const publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    expect(publicKey.asymmetricKeyType).toBe('rsa');
    expect(publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(extensionIdFromPublicKey(publicKeyDer)).toBe(EXPECTED_EXTENSION_ID);
  });

  it('declares the Chrome side panel entry', () => {
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel?.default_path).toBe('sidepanel/index.html');
  });

  it('uses activeTab and scripting for user-triggered X extraction', () => {
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('scripting');
  });

  it('keeps only exact X and built-in AI origins as optional host permissions', () => {
    expect(manifest.permissions).not.toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toEqual([
      'https://x.com/*',
      'https://api.deepseek.com/*',
      'https://api.moonshot.cn/*',
      'https://open.bigmodel.cn/*',
    ]);
    expect(manifest.optional_host_permissions).not.toContain('http://*/*');
    expect(manifest.optional_host_permissions).not.toContain('https://*/*');
  });

  it('does not grant or statically inject persistent platform access', () => {
    expect(manifest.host_permissions ?? []).toEqual([]);

    const staticMatches = (manifest.content_scripts ?? []).flatMap(
      (contentScript) => contentScript.matches ?? [],
    );
    const staticScripts = (manifest.content_scripts ?? []).flatMap(
      (contentScript) => contentScript.js ?? [],
    );
    expect(staticMatches).not.toContain('https://x.com/*');
    expect(staticMatches).not.toContain('https://twitter.com/*');
    expect(staticScripts).not.toContain('content/twitter.js');
    expect(staticMatches).not.toContain('https://weibo.com/*');
    expect(staticMatches).not.toContain('https://m.weibo.cn/*');
    expect(staticScripts).not.toContain('content/weibo.js');
  });

  it('does not load remote resources from extension UI styles', () => {
    expect(popupStyles).not.toMatch(/https?:\/\//iu);
  });
});

describe('content script build contract', () => {
  it('rejects module syntax that Chrome cannot inject as a classic script', () => {
    expect(() =>
      assertClassicContentScript('(() => { const value = 1; })();', 'valid.js'),
    ).not.toThrow();
    expect(() =>
      assertClassicContentScript('(() => { import "./shared.js"; })();', 'invalid.js'),
    ).toThrow(SyntaxError);
  });

  it('isolates minifier helpers from repeated content-script injections', () => {
    const sandbox: Record<string, unknown> = {};
    const script = new Script(
      finalizeClassicContentScript('var minifierHelper = true;', 'isolated.js'),
    );

    script.runInNewContext(sandbox);

    expect(sandbox).not.toHaveProperty('minifierHelper');
  });
});
