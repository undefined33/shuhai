---
id: goal-046a
title: Surface Shell Split And Context Popup
status: DONE
version: 3
updated: 2026-07-24
depends_on:
  - goal-045c
branch: codex/goal-046-ui-shell
base_commit: ed1a26c
contract_review:
  verdict: PASS
  rounds:
    - reviewer: Boyle
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 初版缺少可闭环 launch、X 退出、active task 和视觉验收合同。
    - reviewer: Boyle
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 二版仍缺少慢速单条通知、多窗口隔离和完整协议预算。
    - reviewer: Boyle
      reviewed_at: 2026-07-24
      verdict: PASS
      summary: strict union、预算、窗口隔离、幂等、视觉与测试边界完整，P0/P1/P2 为 0。
    - reviewer: Galileo
      reviewed_at: 2026-07-24
      verdict: PASS
      summary: v3 nullable metadata 修订阻断完整树和 Vault 读取，P0/P1/P2 为 0。
implementation_review:
  verdict: PASS
  rounds:
    - reviewer: Galileo
      reviewed_at: 2026-07-24
      verdict: FAIL
      summary: 发现 summary 重读完整树、registry 竞态和 Side Panel lost-wakeup；P1 为 3。
    - reviewer: Galileo
      reviewed_at: 2026-07-24
      verdict: PASS
      summary: 原问题全部修复，独立重跑 84 条关键测试并核验 9 张隔离截图；P0/P1/P2 为 0。
---

# Goal 046A：主壳拆分与上下文 Popup

## 1. 用户问题

当前 Popup 与 Side Panel 都从同一个 72 KB `App.tsx` 启动。打开一个只需要单次操作的
Popup 时，仍会加载书签树、设置、历史页面、Vault、X 任务和旧工作区路由。用户看到的
入口重复、视觉层级混乱，生产 build 也保留单个 500 kB 以上 UI chunk。

本 Goal 只解决 surface 边界：

1. Popup 根据当前 tab 和持久任务摘要只显示一个主动作。
2. Side Panel 先进入轻量任务壳，再按当前任务 lazy-load。
3. Popup、Side Panel 不再共享同一个静态 `App` 入口。
4. 不改变书签、X 同步、Vault、AI 或 operation journal 的业务语义。

## 2. 用户结果

完成后：

- X 收藏页 Popup 只显示“同步 X 收藏”或“继续同步”。
- X 单条详情页 Popup 只显示“保存当前内容”。
- 其它页面 Popup 只显示“整理 Chrome 书签”。
- 有未完成任务时，Popup 优先显示“继续当前任务”。
- Popup 打开后不读取完整 `ExtensionState`，也不 import 任务页或旧 `App`。
- Side Panel 空闲态只显示两条任务入口；X 任务按需加载，书签旧工作区仅作为 046B 前的
  过渡 lazy route。
- X 任务结束或返回后进入新 Side Panel 空闲态，不再进入旧总控制台。

## 3. 非目标

- 不重写书签分类、重复项、链接历史、mutation 或恢复算法。
- 不重写 `XSyncPage`、SyncStore、catalog、Vault writer 或平台 adapter。
- 不建立 Options Page；独立 Options 属于 Goal 046B。
- 不删除旧页面；只有 046B 完成替代和回归后才能删除不可达页面。
- 不增加微博、知乎、小红书或普通网页剪藏。
- 不新增运行时或开发依赖。
- 不把手工 `manualChunks` 当作唯一性能修复；必须证明 Popup 首包没有任务页和旧 `App`。

## 4. 设计合同

### 4.1 Popup

Popup 固定为 summary-only surface：

- 只查询当前 active tab。
- 状态读取只发送新的 strict read-only `surface:summary` 请求。
- 用户点击主动作后允许发送 strict `surface:launch` / 既有 X domain request；这些请求
  只能创建受界任务入口或既有 X 任务，不能移动、删除、更新书签或写入 Vault。
- 不发送 `state:get`、`operations:getRecent` 或设置全量请求。
- 不打开 IndexedDB、Vault handle 或完整书签树。
- 一个主按钮。046A 不显示没有有效目的地的设置按钮；独立 Options 在 046B 接入后再
  增加设置 icon。
- 主按钮必须保留 Chrome user gesture：打开 Side Panel 的调用在 click handler 中同步
  发起，随后再发送 launch intent 或 X domain request。

上下文优先级：

```text
active task
  -> exact X bookmarks page
  -> canonical X status page
  -> ordinary/unsupported page
```

### 4.2 Surface protocol

新增版本化、严格、bounded 的 `surface:summary`、`surface:launch` 和
`surface:ackLaunch` request/response contract。

所有对象都禁止未列出的额外字段。request 是完整 strict discriminated union：

```text
SurfaceRequestV1 =
  | {
      protocol: "shuhai-surface",
      version: 1,
      type: "summary",
      requestId: [A-Za-z0-9:_-]{1,128},
      windowId: integer 0..Number.MAX_SAFE_INTEGER
    }
  | {
      protocol: "shuhai-surface",
      version: 1,
      type: "launch",
      requestId: [A-Za-z0-9:_-]{1,128},
      windowId: integer 0..Number.MAX_SAFE_INTEGER,
      target: "x-sync" | "x-single" | "bookmarks-transition"
    }
  | {
      protocol: "shuhai-surface",
      version: 1,
      type: "ackLaunch",
      requestId: [A-Za-z0-9:_-]{1,128},
      windowId: integer 0..Number.MAX_SAFE_INTEGER,
      intentId: [A-Za-z0-9:_-]{1,128}
    }
```

预算固定为：

| 对象             | max bytes | max depth | max nodes | 单字符串 max bytes |
| ---------------- | --------: | --------: | --------: | -----------------: |
| 任一 request     |       512 |         3 |        24 |                128 |
| 任一 response    |      2048 |         5 |        64 |                128 |
| session registry |      4096 |         5 |       128 |                128 |

`intentId` 使用 `surface-<UUID>`，并满足 `[A-Za-z0-9:_-]{1,128}`。持久任务时间
`updatedAt` 与 `lastSavedAt` 使用经过现有 ISO schema 校验、UTF-8 最多 64 bytes 的
字符串；短期 intent 的 `expiresAtMs` 和内部 tombstone 时间使用 non-negative safe
integer epoch milliseconds。所有文本按 UTF-8 byte 预算，不只按 JS 字符数。

`SurfaceSummaryV1` 精确为：

```text
{
  bookmarkCount: integer 0..1_000_000 | null,
  folderCount: integer 0..1_000_000 | null,
  vaultConfigured: boolean | null,
  aiConfigured: boolean | null,
  lastSavedAt: ISO string (1..64 UTF-8 bytes) | null,
  activeTask:
    | {
        kind: "x-sync" | "x-single",
        status:
          | "prepared"
          | "scanning"
          | "paused"
          | "ready_for_review"
          | "writing"
          | "partial",
        updatedAt: ISO string (1..64 UTF-8 bytes)
      }
    | null,
  pendingLaunch:
    | {
        intentId: [A-Za-z0-9:_-]{1,128},
        target: "x-sync" | "x-single" | "bookmarks-transition",
        windowId: integer 0..Number.MAX_SAFE_INTEGER,
        expiresAtMs: integer 0..Number.MAX_SAFE_INTEGER
      }
    | null
}
```

四个轻量 metadata 字段的 `null` 表示当前 surface 没有查询该数据，不表示零项、未配置或
读取失败。046A 的 surface summary 不调用 legacy `getStateSummary()`，不读取完整书签
树、Vault handle、export manifest 或完整 settings。Popup 收到 `null` 时显示
“打开工作区后读取书签概况”或“保存时会检查 Vault 设置”，不能伪造数字和配置状态。
后续 Goal 若要恢复这些字段，必须使用独立 bounded cache，并定义初始化、事件更新、漂移
恢复和 schema 迁移；不得把重读完整树重新接回 Popup。

`complete`、`complete_with_issues`、`failed` 和 `cancelled` 是终态，不得作为 active task。
若同时存在 active X task 与 launch intent，active task 优先；046A 不声称存在尚未实现的
持久 bookmark task。任何底层读取失败都使整个 summary 以固定
`summary_unavailable` code 失败，不能把“读取失败”降级成零项或未配置。

成功 response 必须严格匹配：

```text
summary:
  {
    protocol: "shuhai-surface",
    version: 1,
    requestId,
    ok: true,
    data: SurfaceSummaryV1
  }
launch:
  {
    protocol: "shuhai-surface",
    version: 1,
    requestId,
    ok: true,
    data: {
      intentId,
      target,
      windowId,
      expiresAtMs
    }
  }
ackLaunch:
  {
    protocol: "shuhai-surface",
    version: 1,
    requestId,
    ok: true,
    data: {
      acknowledged: true,
      alreadyAcknowledged: boolean
    }
  }
failure:
  {
    protocol: "shuhai-surface",
    version: 1,
    requestId,
    ok: false,
    errorCode: SurfaceErrorCode,
    message: fixed message selected only by errorCode
  }
```

失败 response 只允许固定 union：

| errorCode             | 固定语义                      |
| --------------------- | ----------------------------- |
| `invalid_request`     | envelope、schema 或预算无效   |
| `forbidden_sender`    | 不是精确受信 Popup/Side Panel |
| `window_unavailable`  | `windowId` 不存在或无法核实   |
| `summary_unavailable` | bounded summary 无法读取      |
| `storage_unavailable` | session registry 无法安全读写 |
| `intent_expired`      | exact intent 已过期           |
| `intent_mismatch`     | window/intent 不匹配或不存在  |
| `operation_failed`    | 其它受界内部失败              |

response 只返回 `errorCode` 与由该 code 唯一决定的固定 message；不返回异常文本、路径、
IDB 错误、tab URL 或内部对象。

`surface:launch`：

- 只额外接受上述 target。
- 后台先用 `chrome.windows.get(windowId)` 核实窗口存在。
- 在固定 session key `shuhai:surface:v1:registry` 的 bounded registry 中按 `windowId`
  保存最长 10 秒的 intent；后发请求只取代同一窗口尚未确认的旧 intent，不影响其它
  窗口。
- registry 最多保留 8 个 pending window intent；超过预算时先清理过期项，仍超限则
  `storage_unavailable` fail closed。
- 不替代既有 `xSync:launch` 或 `xSingle:start` 业务请求；它只解决 Side Panel surface
  路由。
- `surface:summary` 只返回 request `windowId` 对应的 intent；其它窗口永远看到 `null`。
- Side Panel 在读取后必须以相同 `windowId` 和 exact `intentId` 发送
  `surface:ackLaunch`；错误窗口、错误 ID 或过期 ID fail closed。
- 成功 ack 生成最长 30 秒的 tombstone；相同 window/intent 重复 ack 返回
  `alreadyAcknowledged: true`。registry 最多保留 16 个 tombstone，超限时只按过期时间
  淘汰最旧项。
- Side Panel 打开后只在 idle/loading 状态进行最长 2 秒的 bounded summary retry，
  消除“先打开 panel、后写入 intent”的常规 user-gesture 竞态；不建立后台轮询。
- Side Panel 同时监听 `chrome.storage.onChanged` 的精确
  `shuhai:surface:v1:registry` key；仅当 `areaName === "session"` 且当前仍为
  idle/loading 时，触发一次 bounded summary refresh。这样 `xSingle:start` 超过 2 秒后
  成功仍能进入复核，但不会监听其它 storage key、读取 registry 内容或持续轮询。

X 收藏 CTA 的顺序固定为：

```text
sync sidePanel.open()
  -> surface:launch(x-sync) + existing xSync:launch
  -> Side Panel summary retry / ack
  -> lazy XSyncPage consumes existing X launch intent
```

X 单条 CTA 的顺序固定为：

```text
sync sidePanel.open()
  -> existing xSingle:start
  -> success: surface:launch(x-single)
  -> Side Panel summary retry or exact-key change refresh / ack
```

普通页面 CTA 的顺序固定为：

```text
sync sidePanel.open()
  -> surface:launch(bookmarks-transition)
  -> Side Panel summary retry / ack
```

所有 surface 响应不得包含：

- 书签标题、URL、目录树。
- X 正文、作者、media、source item id。
- Vault 路径、文件名或 handle。
- Provider endpoint、model、Key 或 legacy data。
- operation items、raw error、diagnostics 或活动正文。

后台只接受来自精确 extension Popup/Side Panel URL 且无 tab sender 的请求。无论任何
内部读取失败，响应只返回固定 error code，不返回异常文本。Popup 和 Side Panel 都必须
用 runtime schema 解析 response，不能靠 TypeScript assertion。

### 4.3 Side Panel

- `SidePanelApp` 使用 surface summary 选择 `idle`、`x-sync` 或 `bookmarks-transition`。
- X 任务通过动态 import 加载 `XSyncPage`。
- 书签过渡工作区通过动态 import 加载旧 `App`；它不得进入 Popup 依赖图。
- idle 壳不读取完整书签树。
- task loading 使用固定尺寸 skeleton/status，不替换整套布局。
- `XSyncPage` 只增加可选 `onExit` adapter；“返回同步入口”在新 Side Panel 中调用
  `onExit`，旧调用方没有传入时保留既有“准备下一批”行为。
- 返回 idle 不清理、取消或伪造持久任务状态；有 active X task 时退出后重新读取 summary
  仍必须路由回该任务。只有终态或用户显式取消后才能稳定回到 idle。

### 4.4 视觉基线

- 使用 `Graphite + Jade` token。
- 正文 14px，辅助文字至少 12.5px。
- 圆角 6px；不使用 card 套 card、渐变、orb、远程字体或装饰图片。
- 一屏一个 primary CTA。
- focus-visible、键盘语义和 `prefers-reduced-motion` 必须存在。

### 4.5 Bundle 合同

- `popup/main.tsx` 不得 import `App.tsx`、`XSyncPage`、Settings、Health、Collection 或
  Organize 页面。
- Popup initial gzip JS 必须 `<130 kB`，超出即 FAIL。
- Popup 初始依赖图不得包含 SyncStore、Vault writer、AI classifier 或完整 bookmark
  operation implementation。
- production build 不得再出现单个全应用入口超过 500 kB 的 warning。
- 若 lazy 任务 chunk 仍接近阈值，允许按既有 React/Radix/vendor 边界拆分，但不得通过
  提高 warning limit 隐藏问题。

## 5. 允许文件

### 文档

- `docs/PROJECT_STATUS.md`
- `docs/product-roadmap-v4.md`
- `docs/goals/README.md`
- `docs/goals/goal-046a-surface-shell-and-popup.md`
- `docs/proposals/2026-07-17-ui-shell-redesign.md`

### 生产代码

- `packages/extension/vite.config.ts`
- `packages/extension/src/background/service-worker.ts`
- `packages/extension/src/popup/main.tsx`
- `packages/extension/src/popup/PopupApp.tsx`（新增）
- `packages/extension/src/popup/popup-context.ts`（新增）
- `packages/extension/src/sidepanel/main.tsx`
- `packages/extension/src/sidepanel/SidePanelApp.tsx`（新增）
- `packages/extension/src/sidepanel/sidepanel-route.ts`（新增）
- `packages/extension/src/popup/pages/XSyncPage.tsx`（仅允许增加可选退出 adapter）
- `packages/extension/src/shell/Brand.tsx`（新增）
- `packages/extension/src/shell/TaskHeader.tsx`（新增）
- `packages/extension/src/shell/ActionBar.tsx`（新增）
- `packages/extension/src/shell/SurfaceLoading.tsx`（新增）
- `packages/extension/src/shared/surface-contract.ts`（新增）
- `packages/extension/src/design/tokens.css`（新增）
- `packages/extension/src/popup/styles.css`

### 测试

- `packages/extension/tests/surface-contract.test.ts`（新增）
- `packages/extension/tests/popup-shell.test.tsx`（新增）
- `packages/extension/tests/sidepanel-shell.test.tsx`（新增）
- `packages/extension/tests/surface-build-boundary.test.ts`（新增）
- `packages/extension/tests/extension-trust-boundary-service-worker.test.ts`
- `packages/extension/tests/x-sync-page.test.tsx`

`service-worker.ts` 只允许增加 surface summary/launch/ack handler、bounded active-task
projection 和固定错误映射；`XSyncPage.tsx` 只允许增加可选退出 adapter。除上述文件外
一律只读。实现发现必须修改现有 legacy message contract、SyncStore、Vault、X adapter、
书签 mutation 或 manifest 权限时立即 STOP，先修订合同并独立复审。

## 6. 安全与数据边界

- 单元和组件测试只用 fake Chrome、fake IndexedDB 和纯 fixture。
- 不启动或控制日常 Chrome，不读取真实 tab、书签、X、Vault 或 extension storage。
- 不发真实网络请求。
- 不新增权限、host permission、remote asset、analytics 或 telemetry。
- 不读取、枚举或清理 `.task-artifacts`。
- 不执行仓库危险命令清单中的命令，不影响其它 worktree、进程、服务或端口。

## 7. 测试矩阵

### Contract

- strict request/response；unknown field、超预算、错误 enum、forbidden sender 全部失败。
- summary 不含 URL、正文、路径、Key、operation items 或 raw error。
- 后台读取一项失败时 fixed-code fail closed。

### Popup

- active task、X 收藏页、X status、普通页面四种上下文各只有一个 primary CTA。
- context 未解析时固定 loading；错误态有恢复动作。
- open Side Panel 保留同步 user gesture；launch 失败不伪报已启动。
- launch-intent-before-panel、panel-before-intent、过期 intent、重复 ack 和 domain request
  失败均有确定性结果。
- `xSingle:start` 超过 2 秒后成功仍能通过 exact session-key change 进入 X task。
- 两个 Chrome window 的 summary、launch 和 ack 不串线；错误 window ack fail closed。
- 不发送 `state:get`。

### Side Panel

- idle、X task、bookmark transition、loading、fixed error 五种 route。
- X 和 legacy bookmark workspace 仅在对应 route 动态加载。
- X 任务返回 idle，不进入旧 HomePage。
- route 切换不改变持久任务 truth。

### Build

- Popup entry import graph 无旧 `App` 与任务页。
- 测试必须在当前进程创建新 build 输出或消费刚完成 build 的 timestamp/manifest，不能
  读取不明来源的陈旧 `dist`。
- build 输出有独立 popup/sidepanel entry。
- Popup gzip JS `<130 kB`。
- 无单一 UI chunk `>500 kB` warning。

### Visual / accessibility

- Popup 420x600；Side Panel 360/480/720px。
- light/dark、200% 缩放、长中英文标题、0/1/1000+ 数量均无重叠、截断或布局跳动。
- 键盘可到达唯一 primary CTA 和退出动作，focus-visible 清楚且顺序符合 DOM。
- loading 与 task route 使用稳定尺寸；`prefers-reduced-motion` 禁用非必要位移动画。
- 046A 的生产 shell 同时作为经用户授权自动编排后的视觉基线；不再另造一次性静态
  原型。046C 仍会做独立浏览器 E2E 和截图验收，但 046A 本身必须先有静态渲染和
  viewport 证据。
- viewport 证据由隔离本地 fixture harness 渲染，使用临时 profile 和 fake Chrome API；
  截图仅写入当前 worktree 已忽略的 `node_modules/.cache/shuhai-goal-046a/`。不得打开
  日常 profile、真实扩展 storage、真实 X、Vault 或书签，也不得用静态 markup 测试冒充
  几何布局证据。

### 回归

- Goal 043 X launch intent、pause/resume、review/write、return。
- Goal 045A bookmark operation journal。
- Goal 045B sender/storage/permission。
- Goal 045C X single-item 与 AI privacy。

## 8. 门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

另需记录：

- build 文件名、raw/gzip 大小和依赖边界。
- Popup 与 Side Panel 的静态渲染证据。
- `git diff --check`。
- 精确 allowlist 比较。
- 独立 architecture/security review，P0/P1/P2 明确。

## 9. 完成条件

- 本文件从 `DRAFT` 经独立合同 review 转为唯一 `READY`，开工时转
  `IN_PROGRESS`。
- 所有用户结果、bundle 合同、安全边界和测试矩阵有直接证据。
- 完整门禁通过。
- 独立 implementation review 为 `PASS`，P0/P1/P2 均为 0。
- 文档收口，形成独立 commit；不得在本 Goal 顺带实施 046B/046C。

## 10. 完成证据

- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm test`：PASS；shared `1/1`、desktop `25/25`、extension `809/809`。
- `pnpm --filter @shuhai/extension run build`：PASS；Popup entry `7.05 kB`
  raw / `3.05 kB` gzip，Side Panel entry `6.96 kB` raw / `2.71 kB` gzip；
  Popup 初始静态 JS 约 `95.2 kB` gzip，最大 UI chunk `App.js 246.31 kB`，无
  `>500 kB` warning。
- build boundary test 在当前测试进程创建 production dist，确认 Popup 初始依赖图不含
  legacy `App`、`XSyncPage`、`state:get`、SyncStore、Vault writer 或 AI classifier。
- 隔离视觉证据：
  `node_modules/.cache/shuhai-goal-046a/2026-07-24T18-09-46-224Z/report.json`。
  使用已安装 Chrome、全新临时 profile、fake Chrome API 和仅回环 fixture；
  `externalRequestsBlocked=true`，9 张截图覆盖 420px Popup、360/480/720px Side Panel、
  light/dark、DPR 2、nullable summary、长中英文标题与 0/1/1000+ 数量，全部无横向
  overflow。
- `git diff --check`：PASS（仅存在工作区既有 LF/CRLF 提示）。
- 精确 allowlist：25 个变更文件，越界文件 0。
- 独立合同与实现复审：Galileo 最终 `PASS`，P0/P1/P2 均为 0。
