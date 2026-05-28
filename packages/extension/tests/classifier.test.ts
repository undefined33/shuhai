import { describe, expect, it } from 'vitest';
import type { BookmarkItem, FolderItem } from '../src/shared/bookmark-types.js';
import {
  classifyBookmark,
  generateClassificationPlan,
} from '../src/shared/classifier.js';

function bookmark(overrides: Partial<BookmarkItem>): BookmarkItem {
  return {
    id: 'b1',
    title: 'Example',
    url: 'https://example.com',
    parentId: '1',
    parentTitle: 'Bookmarks Bar',
    parentPath: 'Bookmarks Bar',
    index: 0,
    ...overrides,
  };
}

const folders: FolderItem[] = [
  {
    id: '1',
    title: 'Bookmarks Bar',
    path: 'Bookmarks Bar',
    bookmarkCount: 2,
  },
];

describe('classifier', () => {
  it('classifies exploit-db links into security vulnerability folders', () => {
    const result = classifyBookmark(
      bookmark({
        url: 'https://www.exploit-db.com/exploits/12345',
        title: 'Local privilege escalation',
      }),
    );

    expect(result.targetFolder).toBe('安全/漏洞研究');
    expect(result.tags).toContain('exploit');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies CVE, malware, red-team, and CTF title payloads', () => {
    const cve = classifyBookmark(
      bookmark({
        id: 'cve',
        title: 'CVE-2026-1000 reverse shell payload analysis',
      }),
    );
    const malware = classifyBookmark(
      bookmark({
        id: 'malware',
        title: 'Cobalt Strike Beacon malware development part 2',
      }),
    );
    const ctf = classifyBookmark(
      bookmark({
        id: 'ctf',
        title: 'CTF writeup flag{demo}',
      }),
    );

    expect(cve.targetFolder).toBe('安全/漏洞研究');
    expect(malware.targetFolder).toBe('安全/恶意软件分析');
    expect(ctf.targetFolder).toBe('安全/CTF');
  });

  it('keeps bookmarks that are already in a specific Chrome folder unchanged in safe mode', () => {
    const plan = generateClassificationPlan(
      [
        bookmark({
          id: 'already-sorted',
          parentPath: 'Bookmarks Bar/安全/漏洞研究',
          url: 'https://github.com/example/repo',
        }),
      ],
      [
        ...folders,
        {
          id: 'safe',
          title: '漏洞研究',
          path: 'Bookmarks Bar/安全/漏洞研究',
          parentId: 'sec',
          bookmarkCount: 1,
        },
      ],
    );

    expect(plan.mode).toBe('safe');
    expect(plan.moves).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it('can reclassify bookmarks that are already in folders in full mode', () => {
    const plan = generateClassificationPlan(
      [
        bookmark({
          id: 'repo',
          parentPath: 'Bookmarks Bar/APT',
          title: 'GitHub malware tooling repo',
          url: 'https://github.com/example/repo',
        }),
      ],
      folders,
      [],
      [],
      'full',
    );

    expect(plan.mode).toBe('full');
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0]?.targetFolder).toBe('开发/代码');
    expect(plan.moves[0]?.selected).toBe(false);
  });

  it('marks low-confidence fallback moves as unchecked', () => {
    const plan = generateClassificationPlan(
      [
        bookmark({
          id: 'unknown',
          title: 'random page',
          url: 'https://unknown.invalid/page',
        }),
      ],
      folders,
    );

    expect(plan.moves[0]?.targetFolder).toBe('未分类');
    expect(plan.moves[0]?.confidence).toBeLessThan(0.6);
    expect(plan.moves[0]?.selected).toBe(false);
  });

  it('treats custom title-keyword rules as plain text instead of regex', () => {
    const result = classifyBookmark(
      bookmark({
        title: 'literal (a+)+$ payload note',
      }),
      [
        {
          type: 'title-keyword',
          pattern: '(a+)+$',
          category: '安全/自定义',
          tags: ['custom'],
        },
      ],
    );

    expect(result.targetFolder).toBe('安全/自定义');
  });
});
