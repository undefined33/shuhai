import { describe, expect, it } from 'vitest';
import type { CustomRule } from '../src/shared/bookmark-types.js';
import {
  addRuleForEditor,
  deleteRuleForEditor,
  importPresetRulesForEditor,
  moveRuleForEditor,
  testRulesForEditor,
} from '../src/popup/pages/RulesEditor.js';

const rules: CustomRule[] = [
  {
    id: 'github',
    type: 'domain',
    pattern: 'github.com',
    category: '技术/开源',
    tags: ['github'],
  },
  {
    id: 'cve',
    type: 'title-keyword',
    pattern: 'CVE',
    category: '安全/漏洞研究',
    tags: ['cve'],
  },
];

describe('RulesEditor model helpers', () => {
  it('adds, deletes and resequences rules', () => {
    const added = addRuleForEditor(rules, {
      id: 'x',
      type: 'domain',
      pattern: 'x.com',
      category: '社交',
      tags: ['social'],
    });

    expect(added).toHaveLength(3);
    expect(added.map((rule) => rule.priority)).toEqual([3, 2, 1]);

    const deleted = deleteRuleForEditor(added, 'github');
    expect(deleted.map((rule) => rule.id)).toEqual(['cve', 'x']);
    expect(deleted.map((rule) => rule.priority)).toEqual([2, 1]);
  });

  it('sorts rules and keeps priority consistent', () => {
    const moved = moveRuleForEditor(rules, 'cve', -1);

    expect(moved.map((rule) => rule.id)).toEqual(['cve', 'github']);
    expect(moved.map((rule) => rule.priority)).toEqual([2, 1]);
    expect(moveRuleForEditor(moved, 'cve', -1)).toEqual(moved);
  });

  it('imports presets once and tests the active rules', () => {
    const imported = importPresetRulesForEditor([rules[0]]);
    const importedAgain = importPresetRulesForEditor(imported);

    expect(imported.length).toBeGreaterThan(1);
    expect(importedAgain).toHaveLength(imported.length);
    expect(
      testRulesForEditor(imported, 'https://github.com/undefined33/shuhai', 'ShuHai repository'),
    ).toContain('技术/开源');
    expect(testRulesForEditor([], 'https://example.com', 'Example')).toContain('未命中');
  });
});
