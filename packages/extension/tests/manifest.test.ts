import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as {
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
});
