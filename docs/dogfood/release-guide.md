# ShuHai Dogfood Release 使用说明

## 1. 认清两个目录

开发构建：

```text
packages/extension/dist
```

它会被下一次
`node scripts/host-command/shuhai-command.cjs extension-build` 删除并重建，只适合开发调试，
不要作为长期加载路径。

Dogfood release：

```text
C:\Projects\ShuHai\.worktrees\dogfood-release-<merge-oid-first-12>\dogfood\releases\shuhai-v<version>-<merge-oid-first-12>\extension
```

它来自已合并且 CI 成功的明确 main merge OID。目录一经发布不再修改；每个新版本使用新的
版本化 worktree 和 release 目录。

## 2. 加载

1. 打开 `chrome://extensions`。
2. 启用“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择最终报告给出的唯一 `...\extension` 目录。不要选它的父目录，不要选 zip，也不要
   选 `packages/extension/dist`。
5. 在扩展详情确认：
   - 名称是 `ShuHai`。
   - ID 是 `jdjmpeogiojjhdabdjmpeclcbjcekbje`。
   - 版本与同级 `release.json` 的 `manifestVersion` 一致。

加载后不要移动、重命名、删除或手工编辑 release worktree 和 `extension` 目录。普通开发
build 不会触碰这个路径。

## 3. 校验

在对应的版本化 release worktree 根目录运行：

```text
node scripts/host-command/shuhai-command.cjs dogfood-verify <release-id>
node scripts/host-command/shuhai-command.cjs dogfood-verify-accepted <release-id>
```

基础校验会重新检查 source commit、lockfile、manifest public key、固定 ID、文件集合、
字节数和 SHA-256。终验还要求同级 `acceptance.json` 为隔离 Chromium `PASS`，并与
service worker hash 和 release identity 一致。

命令只接受 release ID，例如：

```text
shuhai-v0.1.0-0123456789ab
```

不要向命令传绝对路径、浏览器路径、profile、URL 或输出目录。

## 4. 升级

新版本不会覆盖旧目录。先完成新 release 的 `verify-accepted`，再决定是否切换。

Chrome 对“移除 unpacked 扩展后再从另一路径加载”的本地 storage 保留行为不作为 ShuHai
承诺。固定 public key 只保证扩展 ID 一致，不保证移除后仍保留设置、任务状态、Vault
directory handle 或站点权限。升级前：

1. 完成或取消正在运行的书签/X 任务。
2. 记录当前 Vault 和 AI Provider 配置；API Key 不要写入文档或截图。
3. 保留旧 release 目录。
4. 切换后检查 Options，并按 Chrome 提示重新授权 Vault/X。

不要把旧 release 内容复制到新 release，也不要为了保留状态覆盖新版本文件。

## 5. 回退

新版本出现问题时：

1. 停止使用新版本，不继续书签 mutation 或 Vault 写入。
2. 在 `chrome://extensions` 移除新加载项。
3. 重新加载旧 release 的原始 `...\extension` 路径。
4. 再次核对固定 ID、版本和设置/权限。

回退只切换完整版本目录，不覆盖文件。扩展被移除后同样不能假设 storage 自动恢复。

## 6. 证据边界

`acceptance.json` 只证明：

- 已存在的 Playwright Chromium 能以全新项目 profile 加载该版本化目录。
- extension ID 和 service worker hash 与 release 一致。
- 隔离 profile 的书签摘要和 X optional permission 前后不变。
- Popup 身份可渲染，没有观察到 console/page error。
- Chromium/extension 启动完成后，页面 context 中已观察到的 HTTP(S) 请求全部被 abort。

它不证明真实 toolbar user gesture、日常 Chrome storage、真实 X、真实 Vault、Obsidian
Reading View、extension 启动早期或 service worker 全部网络尝试、OS 级零网络或两周
dogfood 已完成。真实使用摩擦记录仍使用
[`friction-log-template.md`](./friction-log-template.md)。
