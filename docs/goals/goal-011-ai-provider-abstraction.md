# Goal 011: AI Provider 抽象 — 多模型支持

> **历史 Goal，不得直接执行。** Provider 数量近期冻结，当前队列见 [`README.md`](./README.md)。

将 AI 分类从 DeepSeek 专用改为通用 Provider 架构，支持多个 OpenAI 兼容的国产模型。

═══════════════════════════════════════════
验证标准（Goal 完成的唯一判据）：
═══════════════════════════════════════════

1. pnpm lint && pnpm typecheck && pnpm test 全部通过（测试数不能减少）
2. pnpm --filter @shuhai/extension run build 成功
3. 设置页可以添加/切换多个 AI 服务商（DeepSeek、Kimi、GLM、自定义）
4. 切换服务商后 AI 分类功能正常工作
5. "测试连接"按钮能验证 API Key 和 baseUrl 是否可用
6. 旧配置（deepSeekApiKey/deepSeekModel）自动迁移到新格式
7. 所有新代码有对应的单元测试

═══════════════════════════════════════════
项目背景：
═══════════════════════════════════════════

仓库：https://github.com/undefined33/shuhai
工作分支：feat/chrome-extension
当前状态：

- AI 分类硬编码为 DeepSeek（apiKey、baseUrl、model 都写死）
- 用户可能想用 Kimi、GLM 或其他 OpenAI 兼容服务
- 这些服务的请求格式完全相同（POST /chat/completions），只是 baseUrl 和 model 不同

参考项目：[read-frog](https://github.com/mengxi-ream/read-frog) 的 provider 配置架构

═══════════════════════════════════════════
具体工作（按优先级排列）：
═══════════════════════════════════════════

## 1. [Critical] Provider 数据模型

### 1.1 新增类型定义

修改 `src/shared/bookmark-types.ts`：

```typescript
type AiProviderType = 'deepseek' | 'kimi' | 'glm' | 'openai-compatible';

interface AiProviderConfig {
  id: string; // 唯一标识，如 'deepseek-default'
  name: string; // 显示名称，如 'DeepSeek'
  provider: AiProviderType;
  enabled: boolean;
  apiKey: string;
  baseUrl: string; // API 端点
  model: string; // 模型名称
  temperature?: number; // 默认 0.1
  maxTokens?: number; // 可选，限制响应长度
}

// 预置服务商模板（用户选择后自动填充 baseUrl 和默认 model）
interface AiProviderTemplate {
  provider: AiProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[]; // 可选模型列表
  description: string; // 简短说明
}
```

### 1.2 预置模板

```typescript
const PROVIDER_TEMPLATES: AiProviderTemplate[] = [
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: '高性价比，适合书签分类',
  },
  {
    provider: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    description: '月之暗面，支持长上下文',
  },
  {
    provider: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4'],
    description: '智谱 AI，国产大模型',
  },
  {
    provider: 'openai-compatible',
    name: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    description: '任何兼容 OpenAI /chat/completions 接口的服务',
  },
];
```

### 1.3 AppSettings 修改

```typescript
interface AppSettings {
  useAi: boolean;
  activeProviderId: string; // 当前使用的 provider id
  aiProviders: AiProviderConfig[]; // 用户配置的所有 provider
  defaultClassifyMode: ClassificationMode;
  customRules: CustomRule[];

  // 废弃字段（迁移后删除）：
  // deepSeekApiKey → aiProviders[0].apiKey
  // deepSeekModel → aiProviders[0].model
}
```

## 2. [Critical] 请求层重构

### 2.1 通用 AI 请求函数

将 `classifyWithDeepSeek` 重命名为 `classifyWithAi`，改为从 provider 配置读取参数：

```typescript
async function classifyWithAi(
  bookmarks: BookmarkItem[],
  provider: AiProviderConfig,
  folders: FolderItem[],
  mode: ClassificationMode,
  fetchImpl: FetchLike = fetch,
): Promise<ClassificationSuggestion[]> {
  if (!provider.apiKey.trim()) {
    return [];
  }

  const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: buildPrompt(bookmarks, folders, mode) }],
      temperature: provider.temperature ?? 0.1,
      ...(provider.maxTokens ? { max_tokens: provider.maxTokens } : {}),
    }),
  });

  // ... 解析响应（格式相同，都是 OpenAI 格式）
}
```

### 2.2 获取当前活跃 Provider

```typescript
function getActiveProvider(settings: AppSettings): AiProviderConfig | undefined {
  return settings.aiProviders.find((p) => p.id === settings.activeProviderId && p.enabled);
}
```

### 2.3 Background service worker 适配

修改 `plan:create` handler，从 settings 中获取 active provider 而不是直接读 deepSeekApiKey。

## 3. [Critical] 配置迁移

用户可能已经配置了 deepSeekApiKey，需要自动迁移：

```typescript
function migrateSettings(raw: unknown): AppSettings {
  const settings = raw as Record<string, unknown>;

  // 如果有旧格式的 deepSeekApiKey 但没有 aiProviders
  if (settings.deepSeekApiKey && !settings.aiProviders) {
    const legacyProvider: AiProviderConfig = {
      id: 'deepseek-migrated',
      name: 'DeepSeek',
      provider: 'deepseek',
      enabled: true,
      apiKey: settings.deepSeekApiKey as string,
      baseUrl: 'https://api.deepseek.com',
      model: (settings.deepSeekModel as string) || 'deepseek-chat',
      temperature: 0.1,
    };

    return {
      ...DEFAULT_SETTINGS,
      useAi: true,
      activeProviderId: 'deepseek-migrated',
      aiProviders: [legacyProvider],
      // 保留其他设置
      customRules: (settings.customRules as CustomRule[]) ?? [],
      defaultClassifyMode: (settings.defaultClassifyMode as ClassificationMode) ?? 'safe',
    };
  }

  return settings as AppSettings;
}
```

## 4. [Major] 设置页 UI — AI 服务商管理

### 4.1 Provider 列表

```
┌─────────────────────────────────────────┐
│  ── AI 服务商 ──                         │
│                                          │
│  当前使用: DeepSeek ✓                    │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │ ● DeepSeek                [编辑] │    │
│  │   deepseek-chat · 已连接         │    │
│  ├─────────────────────────────────┤    │
│  │ ○ Kimi (Moonshot)         [编辑] │    │
│  │   未配置                          │    │
│  ├─────────────────────────────────┤    │
│  │ ○ 智谱 GLM               [编辑] │    │
│  │   未配置                          │    │
│  └─────────────────────────────────┘    │
│                                          │
│  [+ 添加自定义服务商]                    │
└─────────────────────────────────────────┘
```

### 4.2 Provider 编辑表单

点击"编辑"展开：

```
┌─────────────────────────────────────────┐
│  DeepSeek 配置                           │
│                                          │
│  API Key: [••••••••••••]  [显示/隐藏]    │
│  模型:    [deepseek-chat ▾]              │
│  API 地址: https://api.deepseek.com      │
│                                          │
│  [测试连接]  [保存]  [删除]              │
│                                          │
│  ✓ 连接成功，模型可用                    │
└─────────────────────────────────────────┘
```

### 4.3 添加自定义服务商

```
┌─────────────────────────────────────────┐
│  添加 AI 服务商                          │
│                                          │
│  选择类型:                               │
│  [DeepSeek] [Kimi] [智谱GLM] [自定义]    │
│                                          │
│  （选择后自动填充 baseUrl 和默认 model）  │
│                                          │
│  名称:    [我的 DeepSeek]                │
│  API Key: [sk-...]                       │
│  模型:    [deepseek-chat ▾]              │
│  API 地址: [https://api.deepseek.com]    │
│                                          │
│  [测试连接]  [添加]                      │
└─────────────────────────────────────────┘
```

## 5. [Major] 测试连接功能

```typescript
async function testConnection(provider: AiProviderConfig): Promise<TestResult> {
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: '请回复"ok"' }],
        max_tokens: 5,
        temperature: 0,
      }),
    });

    if (response.ok) {
      return { success: true, message: '连接成功，模型可用' };
    }

    if (response.status === 401) {
      return { success: false, message: 'API Key 无效' };
    }

    if (response.status === 404) {
      return { success: false, message: '模型不存在或 API 地址错误' };
    }

    return { success: false, message: `请求失败: ${response.status}` };
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error instanceof Error ? error.message : '未知'}`,
    };
  }
}
```

## 6. [Minor] 清理旧代码

- 删除 `DeepSeekChoice`、`DeepSeekResponse` 等 DeepSeek 专用类型名
- 重命名为通用名：`AiChoice`、`AiResponse`
- 删除 `deepSeekApiKey`、`deepSeekModel` 字段（迁移后）
- 更新帮助文档中的 "DeepSeek API Key" 文案为 "AI 服务商配置"

═══════════════════════════════════════════
强制约束：
═══════════════════════════════════════════

【网络与代理】

- 所有 git push/pull/fetch 必须加代理

【供应链安全】

- 本 Goal 不引入新依赖
- 所有 AI 请求都是标准 fetch + OpenAI 格式，不需要 SDK

【代码规范】

- TypeScript strict 模式
- 单引号，尾逗号，100 字符行宽

【安全】

- API Key 存储在 chrome.storage.local（与之前一致）
- 测试连接时发送最小 payload（"请回复ok"），不发送用户书签数据
- 不在日志中记录 API Key
- UI 中 API Key 默认隐藏（password input）

═══════════════════════════════════════════
工作方式：
═══════════════════════════════════════════

- 优先级：数据模型（1）→ 请求层（2）→ 迁移（3）→ UI（4）→ 测试连接（5）→ 清理（6）
- 每完成一个功能后运行：pnpm lint && pnpm typecheck && pnpm test
- 每个功能一个 commit
- push 到远程后继续

═══════════════════════════════════════════
如果被阻塞：
═══════════════════════════════════════════

- 某个 provider 的 API 格式不完全兼容 OpenAI → 添加 provider-specific 的请求/响应适配层
- GLM 的 token 格式不同（JWT 而非 Bearer）→ 在 headers 配置中支持自定义 Authorization 格式
- 测试连接被 CORS 阻止 → 通过 background service worker 发请求（不受 CORS 限制）
- 旧配置迁移丢失数据 → 保留旧字段作为 fallback，不立即删除
- 网络不可用无法 push → 本地 commit

最终停止时必须报告：

1. 已完成的功能列表（附 commit hash）
2. 被阻塞的功能及原因
3. 当前测试数量和通过状态
4. 支持的 provider 列表及测试结果
5. 需要人工介入的事项
