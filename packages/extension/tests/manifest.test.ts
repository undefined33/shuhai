import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { assertClassicContentScript, finalizeClassicContentScript } from '../vite.config.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as {
  action?: { default_icon?: Record<string, string> };
  content_scripts?: Array<{ js?: string[]; matches?: string[] }>;
  description?: string;
  host_permissions?: string[];
  icons?: Record<string, string>;
  key?: string;
  minimum_chrome_version?: string;
  name?: string;
  optional_host_permissions?: string[];
  options_ui?: { open_in_tab?: boolean; page?: string };
  permissions?: string[];
  short_name?: string;
  side_panel?: { default_path?: string };
};
const popupStyles = readFileSync(new URL('../src/popup/styles.css', import.meta.url), 'utf8');
const EXPECTED_EXTENSION_ID = 'jdjmpeogiojjhdabdjmpeclcbjcekbje';
const EXPECTED_ICONS = {
  '16': 'icons/icon-16.png',
  '32': 'icons/icon-32.png',
  '48': 'icons/icon-48.png',
  '128': 'icons/icon-128.png',
};

interface DecodedPng {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}

function decodeRgbaPng(input: Buffer): DecodedPng {
  expect(input.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  let cursor = 8;
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  while (cursor < input.length) {
    const length = input.readUInt32BE(cursor);
    const type = input.toString('ascii', cursor + 4, cursor + 8);
    const data = input.subarray(cursor + 8, cursor + 8 + length);
    cursor += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8, 13)]).toEqual([8, 6, 0, 0, 0]);
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  expect(filtered.length).toBe((rowBytes + 1) * height);
  const pixels = new Uint8Array(rowBytes * height);

  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (rowBytes + 1)];
    expect(filter).toBeLessThanOrEqual(4);
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = filtered[row * (rowBytes + 1) + column + 1] as number;
      const outputIndex = row * rowBytes + column;
      const left = column >= bytesPerPixel ? (pixels[outputIndex - bytesPerPixel] as number) : 0;
      const above = row > 0 ? (pixels[outputIndex - rowBytes] as number) : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? (pixels[outputIndex - rowBytes - bytesPerPixel] as number)
          : 0;
      const reconstructed =
        filter === 0
          ? raw
          : filter === 1
            ? raw + left
            : filter === 2
              ? raw + above
              : filter === 3
                ? raw + Math.floor((left + above) / 2)
                : raw + paethPredictor(left, above, upperLeft);
      pixels[outputIndex] = reconstructed & 0xff;
    }
  }

  return { width, height, pixels };
}

function extensionIdFromPublicKey(publicKeyDer: Buffer): string {
  const alphabet = 'abcdefghijklmnop';
  const digest = createHash('sha256').update(publicKeyDer).digest();

  return [...digest.subarray(0, 16)]
    .map((byte) => alphabet.charAt(byte >> 4) + alphabet.charAt(byte & 0x0f))
    .join('');
}

describe('extension manifest', () => {
  it('uses current product metadata and the Chrome 116 side-panel floor', () => {
    expect(manifest.name).toBe('ShuHai');
    expect(manifest.short_name).toBe('ShuHai');
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.description).toContain('Chrome bookmarks');
    expect(manifest.description).toContain('X favorites');
    expect(manifest.description).toContain('Obsidian');
    expect(manifest.description).toContain('optional');
  });

  it('declares nonblank transparent PNG icons at every browser-owned size', () => {
    expect(manifest.icons).toEqual(EXPECTED_ICONS);
    expect(manifest.action?.default_icon).toEqual(EXPECTED_ICONS);

    for (const [declaredSize, relativePath] of Object.entries(EXPECTED_ICONS)) {
      expect(relativePath).not.toMatch(/^https?:/u);
      const png = decodeRgbaPng(
        readFileSync(new URL(`../src/public/${relativePath}`, import.meta.url)),
      );
      const expectedSize = Number(declaredSize);
      expect([png.width, png.height]).toEqual([expectedSize, expectedSize]);

      let transparentPixels = 0;
      const visibleColors = new Set<string>();
      for (let index = 0; index < png.pixels.length; index += 4) {
        const alpha = png.pixels[index + 3] as number;
        if (alpha === 0) {
          transparentPixels += 1;
        } else {
          visibleColors.add(
            `${png.pixels[index]},${png.pixels[index + 1]},${png.pixels[index + 2]}`,
          );
        }
      }
      expect(transparentPixels).toBeGreaterThan(0);
      expect(visibleColors.size).toBeGreaterThan(1);
    }
  });

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

  it('declares an independent Options page without adding permissions', () => {
    expect(manifest.options_ui).toEqual({
      page: 'options/index.html',
      open_in_tab: true,
    });
    expect(manifest.permissions).not.toContain('tabs');
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
