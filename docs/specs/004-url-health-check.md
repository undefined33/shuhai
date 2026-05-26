---
version: 1
assignee: codex
status: ready
issue: "#4"
---

# URL 健康检测

## 目标

对数据库中的书签进行 URL 可达性检测，标记死链/重定向/有效链接，支持并发控制和同域名限速，进度可断点续检。

## Prior Context

- 已完成: SQLite 持久化层 (`packages/desktop/src/main/db/`)
- 已完成: `ShuHaiDatabase.getBookmarksNeedingCheck(olderThanDays)` 已实现
- 已完成: `ShuHaiDatabase.recordUrlCheck(check)` 已实现
- 已完成: `ShuHaiDatabase.updateBookmarkStatus(id, status)` 已实现
- 常量已定义: `URL_CHECK_CONCURRENCY = 5`, `DOMAIN_RATE_LIMIT_MS = 2000` (在 `@shuhai/shared`)

## 技术方案

### 检测策略

```
对每个 URL:
  1. HEAD 请求 (timeout 10s)
  2. 如果 HEAD 返回 405/403 → 降级 GET (只读 headers, abort body)
  3. 根据响应判定状态:
     - 2xx → alive
     - 301/302/307/308 → redirect (记录 finalUrl)
     - 404/410 → dead
     - 5xx → error (可能暂时性，不立即标记 dead)
     - timeout/network error → error
  4. 记录到 url_checks 表
  5. 更新 bookmarks.status
```

### 并发与限速

```
全局并发上限: 5 (URL_CHECK_CONCURRENCY)
同域名限速: 同一域名两次请求间隔 ≥ 2s (DOMAIN_RATE_LIMIT_MS)
优先级: 不同域名的 URL 优先检测，同域名排到队列尾部

实现方式:
  - 使用 p-limit 控制全局并发
  - 维护 Map<domain, lastRequestTime> 做域名限速
  - 队列按域名交错排列（round-robin across domains）
```

### SSRF 防护

```
拒绝检测的 URL:
  - 127.0.0.0/8 (loopback)
  - 10.0.0.0/8 (private)
  - 172.16.0.0/12 (private)
  - 192.168.0.0/16 (private)
  - 169.254.0.0/16 (link-local)
  - ::1, fc00::/7 (IPv6 private)
  - file://, chrome://, about:// 等非 HTTP scheme

检测方式: 解析 hostname，如果是 IP 直接判断；如果是域名，
先 DNS 解析再判断（防止 DNS rebinding 到内网）。
```

### 进度与事件

```typescript
interface UrlCheckProgress {
  total: number;       // 待检测总数
  completed: number;   // 已完成
  alive: number;
  dead: number;
  redirect: number;
  errors: number;
  currentUrl?: string; // 当前正在检测的 URL
}

// 通过 IPC 向 renderer 推送进度
// channel: 'url-check:progress'
```

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 新建 | `packages/desktop/src/main/health/url-checker.ts` | 核心检测逻辑 |
| 新建 | `packages/desktop/src/main/health/domain-scheduler.ts` | 域名限速调度器 |
| 新建 | `packages/desktop/src/main/health/ssrf-guard.ts` | SSRF 防护 |
| 新建 | `packages/desktop/src/main/health/index.ts` | 导出入口 |
| 修改 | `packages/desktop/src/main/ipc.ts` | 添加 url-check IPC handlers |
| 修改 | `packages/desktop/src/main/bookmark-service.ts` | 添加 `runUrlHealthCheck` |
| 新建 | `packages/desktop/tests/url-checker.test.ts` | 单元测试 |
| 新建 | `packages/desktop/tests/ssrf-guard.test.ts` | SSRF 防护测试 |

## 核心接口

```typescript
// packages/desktop/src/main/health/url-checker.ts

interface UrlCheckOptions {
  concurrency?: number;        // 默认 URL_CHECK_CONCURRENCY (5)
  domainRateLimitMs?: number;  // 默认 DOMAIN_RATE_LIMIT_MS (2000)
  timeoutMs?: number;          // 单个请求超时，默认 10000
  olderThanDays?: number;      // 检测多少天前未检测的，默认 7
  onProgress?: (progress: UrlCheckProgress) => void;
  signal?: AbortSignal;        // 支持取消
}

export class UrlHealthChecker {
  constructor(private db: ShuHaiDatabase, options?: UrlCheckOptions);

  // 检测所有需要检测的书签
  async runAll(): Promise<UrlCheckProgress>;

  // 检测指定书签
  async checkOne(bookmarkId: string): Promise<UrlStatus>;

  // 取消正在进行的检测
  abort(): void;
}
```

```typescript
// packages/desktop/src/main/health/domain-scheduler.ts

export class DomainScheduler {
  constructor(rateLimitMs: number);

  // 返回需要等待的毫秒数（0 = 可以立即请求）
  getDelay(domain: string): number;

  // 记录一次请求完成
  recordRequest(domain: string): void;

  // 将 URL 列表按域名交错排列
  static interleaveByDomain(urls: Array<{ url: string; id: string }>): Array<{ url: string; id: string }>;
}
```

```typescript
// packages/desktop/src/main/health/ssrf-guard.ts

// 判断 URL 是否安全可检测
export function isSafeUrl(url: string): boolean;

// 判断 IP 是否为私有地址
export function isPrivateIp(ip: string): boolean;
```

## IPC 新增 channels

```typescript
// 添加到 ipc.ts:
ipcMain.handle('url-check:start', async () => { ... });
ipcMain.handle('url-check:abort', () => { ... });

// 进度推送（main → renderer）:
mainWindow.webContents.send('url-check:progress', progress);
```

## 依赖

使用 Node.js 内置 `fetch`（Node 18+ 原生支持），不需要额外 HTTP 库。

需要安装 `p-limit` 用于并发控制：

```bash
# p-limit@6.2.0 (2024-11-18 发布，已超过 7 天)
# 维护者: sindresorhus (知名开源作者，900+ packages)
# 纯 ESM，零依赖，无 typosquatting 风险
pnpm add p-limit@6.2.0 --filter @shuhai/desktop
```

## 验收标准

- [ ] `isSafeUrl` 正确拒绝私有 IP 和非 HTTP URL
- [ ] HEAD 请求失败时自动降级到 GET
- [ ] 全局并发不超过 5
- [ ] 同域名请求间隔 ≥ 2s
- [ ] 2xx → alive, 301/302 → redirect (记录 finalUrl), 404/410 → dead
- [ ] 检测结果写入 `url_checks` 表并更新 `bookmarks.status`
- [ ] `signal.abort()` 能中止正在进行的检测
- [ ] 进度通过 `onProgress` 回调实时报告
- [ ] 重启后从数据库恢复进度（只检测未检测/过期的）
- [ ] 所有测试通过 (`pnpm test`)
- [ ] lint + typecheck 无错误

## 注意事项

- MUST: 不检测私有 IP（SSRF 防护）
- MUST: 遵守并发和限速约束
- MUST: 支持 AbortSignal 取消
- MUST: 测试中 mock fetch，不发真实网络请求
- SHOULD: 5xx 标记为 error 而非 dead（可能是暂时性故障）
- SHOULD: 跟随重定向但记录最终 URL
- 不要修改 renderer 代码（进度展示后续单独做）
- 不要修改 shared 包（常量已经定义好）
