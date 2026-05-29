import { describe, expect, it } from 'vitest';
import type { CustomRule } from '../src/shared/bookmark-types.js';
import { matchRules, normalizeCustomRule, testGlob } from '../src/utils/rule-matcher.js';

describe('rule matcher', () => {
  it('matches domain, title keyword, URL glob and combined rules by priority', () => {
    const rules: CustomRule[] = [
      {
        id: 'domain',
        type: 'domain',
        pattern: 'github.com',
        category: '技术/开源',
        tags: ['github'],
        priority: 1,
      },
      {
        id: 'combined',
        type: 'combined',
        pattern: 'https://github.com/**',
        urlPattern: 'https://github.com/**',
        titlePattern: 'CVE',
        category: '安全/漏洞研究',
        tags: ['cve'],
        priority: 10,
      },
    ];

    const result = matchRules(
      {
        url: 'https://github.com/org/repo/issues/1',
        title: 'CVE writeup',
      },
      rules,
    );

    expect(result.matched).toBe(true);
    expect(result.rule?.id).toBe('combined');
    expect(result.category).toBe('安全/漏洞研究');
  });

  it('supports simple glob semantics and rejects overlong patterns', () => {
    expect(testGlob('https://*.github.com/**', 'https://docs.github.com/a/b')).toBe(true);
    expect(testGlob('https://*.github.com/*', 'https://docs.github.com/a/b')).toBe(false);
    expect(testGlob('*'.repeat(201), 'https://example.com')).toBe(false);
  });

  it('migrates legacy rules with ids, enabled state and priority', () => {
    const rule = normalizeCustomRule(
      {
        type: 'title-keyword',
        pattern: 'React',
        category: '开发/前端',
        tags: ['frontend'],
      },
      0,
      3,
    );

    expect(rule.id).toBeTruthy();
    expect(rule.enabled).toBe(true);
    expect(rule.priority).toBe(3);
  });
});
