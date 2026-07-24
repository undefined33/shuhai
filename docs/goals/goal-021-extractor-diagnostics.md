# Goal 021: 内容提取诊断与韧性

> **历史 Goal，不得直接执行。** 新提取 spike/adapter 方向见 Goal 035-036。

## 背景

Twitter/Weibo 的 DOM 选择器是整个扩展最脆弱的依赖。平台任何一次前端改版都可能导致提取全部失败，而用户只看到一句"提取失败"，无法区分是平台改了、页面没加载完、还是插件有 bug。

当前 `twitter.ts` 和 `weibo.ts` 已有基本的 fallback 选择器（如 tweetText 有两个备选），但缺少：

- 系统性的结构探测（哪些选择器还活着）
- 失败记录持久化（用户无法回顾）
- 降级提取的可见性（fallback 命中时用户不知道）

## 目标

让用户在提取失败时能看到**具体原因和建议**，而不是一句通用错误。让开发者能从失败记录中快速定位哪个选择器挂了。

## 改动范围

| 文件                                 | 改动                          |
| ------------------------------------ | ----------------------------- |
| `src/utils/extractor-diagnostics.ts` | 新增：诊断引擎                |
| `src/content/twitter.ts`             | 改造：接入诊断，扩展 fallback |
| `src/content/weibo.ts`               | 改造：接入诊断，扩展 fallback |
| `src/background/service-worker.ts`   | 小改：接收诊断上报            |
| `src/popup/pages/HelpPage.tsx`       | 新增：提取状态区域            |
| `src/shared/bookmark-types.ts`       | 新增：诊断相关类型            |

## 具体设计

### 1. 结构探针（Structure Probes）

```typescript
// src/utils/extractor-diagnostics.ts

interface SelectorProbe {
  name: string; // 人类可读名，如 "tweetText"
  selector: string; // CSS 选择器
  required: boolean; // true = 缺失则判定"结构已变"
  description: string; // 给用户看的说明
}

interface ProbeResult {
  name: string;
  found: boolean;
  selector: string;
}

interface DiagnosticReport {
  platform: 'twitter' | 'weibo';
  timestamp: string;
  url: string; // 只保留 hostname + pathname 前两段
  probeResults: ProbeResult[];
  structureValid: boolean;
  fallbacksUsed: string[];
  error?: string;
}
```

每个提取器定义自己的探针集：

**Twitter 探针**：

- `[data-testid="tweetText"]` — required
- `[data-testid="User-Name"]` — required
- `article` — required
- `time[datetime]` — optional
- `[data-testid="videoPlayer"]` — optional

**Weibo 探针**：

- `[class*="detail_wbtext"], [class*="weibo-text"]` — required（任一命中即可）
- `[class*="head_name"], [class*="username"]` — required
- `time, [class*="time"]` — optional

### 2. 提取前诊断流程

```
1. 运行所有探针
2. 若任何 required 探针缺失 → 直接返回结构化错误（不尝试提取）
3. 若全部 required 命中 → 正常提取
4. 提取过程中若主选择器失败但 fallback 命中 → 记录 fallbacksUsed
5. 提取完成后生成 DiagnosticReport
```

### 3. 失败记录存储

- Storage key: `'extractorDiagnostics'`
- 最多保留 **20 条**失败/降级记录（成功且无降级的不存）
- URL 脱敏：只保留 `platform + pathname 前两段`（如 `x.com/user/status`）
- 不存储提取到的内容正文

### 4. 用户可见诊断（HelpPage）

在 HelpPage 新增"内容提取状态"区域：

```
┌─────────────────────────────────────┐
│ 📡 内容提取状态                      │
├─────────────────────────────────────┤
│ Twitter: ✅ 正常 (最近成功 2 小时前)  │
│ Weibo:   ⚠️ 降级 (fallback 命中)     │
│                                     │
│ 最近问题：                           │
│ · 5/28 Weibo: 主选择器未命中，        │
│   使用了备选 [class*="txt"]          │
│                                     │
│ 💡 如果持续失败，请检查扩展更新       │
└─────────────────────────────────────┘
```

### 5. 错误消息改进

当前错误消息：

- `页面结构可能已更新，提取失败。请反馈此问题。`

改为结构化消息：

- 探针全部缺失：`Twitter 页面结构已变化（tweetText、User-Name 均未找到）。可能是平台改版，请检查扩展是否有新版本。`
- 部分缺失：`提取不完整：未找到发布时间。其他内容已正常提取。`
- 页面未加载完：`页面可能未完全加载，请等待内容显示后重试。`

### 6. 降级提取策略

对每个数据点维护优先级列表：

| 数据点       | 主选择器                                 | Fallback 1                  | Fallback 2               |
| ------------ | ---------------------------------------- | --------------------------- | ------------------------ |
| Twitter 正文 | `article [data-testid="tweetText"]`      | `[data-testid="tweetText"]` | `article [lang]`         |
| Twitter 作者 | `[data-testid="User-Name"] a[href^="/"]` | URL 路径提取                | —                        |
| Weibo 正文   | `[class*="detail_wbtext"]`               | `[class*="weibo-text"]`     | `[class*="txt"]`         |
| Weibo 作者   | `[class*="head_name"]`                   | `[class*="username"]`       | `article a[href*="/u/"]` |

Fallback 命中时标记 `fallbacksUsed`，不影响用户操作，但记录到诊断日志。

## 安全考量

- URL 脱敏：不存储完整 URL（可能含 token/session）
- 不存储提取内容
- 诊断数据仅存 `chrome.storage.local`，不同步

## 验证

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @shuhai/extension run build
```

新增测试：

- 探针检测逻辑（全部命中、部分缺失、全部缺失）
- 降级提取路径
- 诊断报告生成和存储
- URL 脱敏
