# Goal 023: 标签规则可视化编辑

> **历史 Goal，不得直接执行。** 当前队列见 [`README.md`](./README.md)。

## 背景

当前 `CustomRule` 的编辑方式是 Settings 页面中的一个 JSON textarea。问题：

- 普通用户不会写 JSON（漏逗号、引号错误是常态）
- 规则类型只有 `domain` 和 `title-keyword` 两种，覆盖面有限
- 无法验证规则是否生效（写完保存，要等下次分类才知道对不对）
- 无法排序优先级

## 目标

用表单化 UI 替代 JSON textarea，扩展规则类型，并提供即时测试能力。

## 改动范围

| 文件                              | 改动                                     |
| --------------------------------- | ---------------------------------------- |
| `src/popup/pages/RulesEditor.tsx` | 新增：规则编辑器组件                     |
| `src/popup/pages/Settings.tsx`    | 替换 JSON textarea 为 RulesEditor        |
| `src/shared/bookmark-types.ts`    | CustomRule 类型扩展                      |
| `src/shared/classifier.ts`        | 适配新规则类型                           |
| `src/utils/rule-matcher.ts`       | 新增：规则匹配引擎（从 classifier 抽出） |

## 具体设计

### 1. 规则类型扩展

```typescript
// src/shared/bookmark-types.ts

type RuleType = 'domain' | 'title-keyword' | 'url-pattern' | 'combined';

interface CustomRule {
  id: string; // 新增，用于排序和引用
  type: RuleType;
  pattern: string; // domain: "github.com", keyword: "React"
  urlPattern?: string; // url-pattern: glob 如 "*.github.com/*/issues*"
  titlePattern?: string; // combined: 标题关键词
  category: string; // 目标文件夹
  tags: string[]; // 追加的标签
  priority?: number; // 排序权重，越大越优先
  enabled: boolean; // 新增，可临时禁用
}
```

新增规则类型：

- `url-pattern`：支持简单 glob（`*` 匹配任意字符，不含 `/`；`**` 匹配含 `/`）
- `combined`：同时匹配 URL pattern + 标题关键词（AND 关系）

### 2. 表单化编辑器

每条规则渲染为一张卡片：

```
┌─────────────────────────────────────────────┐
│ ☰ [domain ▾] [github.com        ] [启用 ✓] │
│   → 文件夹: [技术/开源           ]          │
│   → 标签:   [github] [opensource] [+]       │
│                                [删除] [测试] │
└─────────────────────────────────────────────┘
```

- 左侧拖拽手柄（☰）用于排序
- 类型 select：domain / title-keyword / url-pattern / combined
- 根据类型动态显示对应输入框
- 标签用 chip 组件，支持添加/删除
- 每条规则可独立启用/禁用
- 底部"添加规则"按钮

### 3. 规则测试

编辑器底部提供测试区域：

```
┌─────────────────────────────────────────────┐
│ 测试规则                                     │
│ URL:   [https://github.com/anthropics/cl... ]│
│ 标题:  [Claude Code - GitHub               ]│
│ [测试] → 命中规则 #2 "domain:github.com"    │
│          文件夹: 技术/开源                   │
│          标签: github, opensource            │
└─────────────────────────────────────────────┘
```

- 输入 URL + 标题，点击测试
- 显示命中的规则（按优先级，第一条生效）
- 如果没有命中，显示"未命中任何规则，将使用 AI 分类"

### 4. 预设规则

提供一键导入的常见预设：

| 预设名   | 类型   | 匹配                          | 文件夹    | 标签        |
| -------- | ------ | ----------------------------- | --------- | ----------- |
| 社交媒体 | domain | twitter.com, x.com, weibo.com | 社交      | social      |
| GitHub   | domain | github.com                    | 技术/开源 | github, dev |
| 新闻     | domain | 常见新闻站                    | 阅读/新闻 | news        |
| 视频     | domain | youtube.com, bilibili.com     | 媒体/视频 | video       |

导入时不覆盖已有规则，追加到末尾。

### 5. 规则匹配引擎

从 `classifier.ts` 中抽出规则匹配逻辑到独立模块：

```typescript
// src/utils/rule-matcher.ts

interface RuleMatchInput {
  url: string;
  title: string;
}

interface RuleMatchResult {
  matched: boolean;
  rule?: CustomRule;
  category: string;
  tags: string[];
}

function matchRules(input: RuleMatchInput, rules: CustomRule[]): RuleMatchResult;
function testGlob(pattern: string, value: string): boolean;
```

glob 实现：

- `*` → `[^/]*`
- `**` → `.*`
- 其他特殊字符转义
- 不使用外部库（避免供应链风险）

### 6. 向后兼容

- 旧格式（无 `id`、无 `enabled`、无 `priority`）自动迁移：
  - 生成 `id`（crypto.randomUUID）
  - `enabled` 默认 `true`
  - `priority` 按数组顺序递减
- JSON textarea 作为"高级模式"保留（折叠在底部），供需要批量编辑的用户使用
- 迁移在 Settings 加载时自动执行，无需用户操作

### 7. 安全考量

- `url-pattern` 的 glob 转正则时限制长度（最大 200 字符）防止 ReDoS
- 规则的 `category` 和 `tags` 值在写入 Markdown 前仍过消毒
- 预设规则硬编码在代码中，不从远程加载

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- `rule-matcher.ts`：各规则类型匹配、优先级排序、glob 边界情况
- `RulesEditor` 组件：添加/删除/排序/测试交互
- 旧格式迁移
- glob ReDoS 防护（超长 pattern 不卡死）
