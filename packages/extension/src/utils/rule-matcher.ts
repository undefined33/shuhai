import type { CustomRule, RuleType } from '../shared/bookmark-types.js';

export interface RuleMatchInput {
  url: string;
  title: string;
}

export interface RuleMatchResult {
  matched: boolean;
  rule?: CustomRule;
  category: string;
  tags: string[];
}

const VALID_TYPES = new Set<RuleType>(['domain', 'title-keyword', 'url-pattern', 'combined']);
const MAX_GLOB_LENGTH = 200;

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function testGlob(pattern: string, value: string): boolean {
  if (!pattern || pattern.length > MAX_GLOB_LENGTH) {
    return false;
  }

  let regexSource = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === '*' && next === '*') {
      regexSource += '.*';
      index += 1;
      continue;
    }

    if (character === '*') {
      regexSource += '[^/]*';
      continue;
    }

    regexSource += escapeRegex(character ?? '');
  }

  return new RegExp(`^${regexSource}$`, 'i').test(value);
}

export function normalizeCustomRule(rule: Partial<CustomRule>, index = 0, total = 1): CustomRule {
  const type = VALID_TYPES.has(rule.type as RuleType) ? (rule.type as RuleType) : 'domain';
  const fallbackPattern = typeof rule.pattern === 'string' ? rule.pattern : '';

  return {
    id: rule.id || `rule-${index}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    type,
    pattern: fallbackPattern,
    urlPattern:
      typeof rule.urlPattern === 'string' && rule.urlPattern.trim()
        ? rule.urlPattern
        : fallbackPattern,
    titlePattern:
      typeof rule.titlePattern === 'string' && rule.titlePattern.trim()
        ? rule.titlePattern
        : fallbackPattern,
    category: typeof rule.category === 'string' ? rule.category : '',
    tags: Array.isArray(rule.tags) ? rule.tags.filter((tag) => typeof tag === 'string') : [],
    priority: typeof rule.priority === 'number' ? rule.priority : total - index,
    enabled: rule.enabled !== false,
  };
}

function titleMatchesKeyword(pattern: string, title: string): boolean {
  return pattern
    .split('|')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .some((part) => title.includes(part));
}

function matchesRule(input: RuleMatchInput, rule: CustomRule): boolean {
  const hostname = getHostname(input.url);
  const title = input.title.toLowerCase();
  const pattern = rule.pattern.trim().toLowerCase();

  if (rule.type === 'domain') {
    return Boolean(pattern && hostname.includes(pattern));
  }

  if (rule.type === 'title-keyword') {
    return Boolean(pattern && titleMatchesKeyword(pattern, title));
  }

  if (rule.type === 'url-pattern') {
    return testGlob((rule.urlPattern || rule.pattern).trim(), input.url);
  }

  if (rule.type === 'combined') {
    const urlPattern = (rule.urlPattern || rule.pattern).trim();
    const titlePattern = (rule.titlePattern || rule.pattern).trim();
    return testGlob(urlPattern, input.url) && titleMatchesKeyword(titlePattern, title);
  }

  return false;
}

export function matchRules(input: RuleMatchInput, rules: CustomRule[]): RuleMatchResult {
  const normalized = rules
    .map((rule, index) => normalizeCustomRule(rule, index, rules.length))
    .filter((rule) => rule.enabled !== false && rule.category.trim())
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of normalized) {
    if (matchesRule(input, rule)) {
      return {
        matched: true,
        rule,
        category: rule.category,
        tags: [...rule.tags],
      };
    }
  }

  return {
    matched: false,
    category: '',
    tags: [],
  };
}
