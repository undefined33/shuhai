import { describe, expect, it } from 'vitest';
import {
  CHROME_NOT_DETECTED_MESSAGE,
  SETUP_STEP_COPY,
  normalizeChromeProfileDetection,
} from '../src/renderer/pages/setup-view-model.js';

describe('Setup view model', () => {
  it('keeps detected Chrome profiles without warnings', () => {
    expect(normalizeChromeProfileDetection(['Default', 'Profile 1'])).toEqual({
      profiles: ['Default', 'Profile 1'],
      selectedProfile: 'Default',
      warning: null,
    });
  });

  it('falls back to Default with a Chinese warning when Chrome is not detected', () => {
    expect(normalizeChromeProfileDetection([])).toEqual({
      profiles: ['Default'],
      selectedProfile: 'Default',
      warning: CHROME_NOT_DETECTED_MESSAGE,
    });
  });

  it('explains each setup step in Chinese', () => {
    expect(SETUP_STEP_COPY.chrome).toContain('读取你的 Chrome 书签');
    expect(SETUP_STEP_COPY.vault).toContain('Obsidian 笔记库目录');
    expect(SETUP_STEP_COPY.ai).toContain('留空会使用内置规则分类');
  });
});
