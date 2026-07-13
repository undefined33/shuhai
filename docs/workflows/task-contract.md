# ShuHai 任务合同

每个可执行 Goal 本身就是任务合同。普通实现不再额外复制一份同义派活文档；派给 worker 时引用 Goal，并补齐下面的运行时事实。

## 1. 必填字段

```text
Task / Goal:
Owner / Role:
Base commit:
Branch / worktree:
绝对 cwd:

允许读取:
- exact files/directories

允许写入:
- exact files

禁止范围:
- packages/desktop
- Goal 未列出的 renderer/shared/manifest/permissions/dependencies 等

允许命令:
- exact command families

外部网络:
- denied / exact hosts and purpose

真实数据:
- mock only / isolated Chrome profile / user-authorized exact operation

风险等级:
- R0/R1/R2/R3/R4

验收与证据:
- tests/build/manual journey

STOP 条件:
- boundary/schema/dependency/environment mismatch
```

worker 必须知道它不是仓库里唯一执行者：不得恢复、覆盖或格式化与任务无关的改动。任务内失败可以在 allowlist 内诊断、修复和复跑，不必逐命令询问。

所有命令还必须通过 [`command-safety.md`](./command-safety.md)。完全文件权限不是 R3/R4 授权，当前执行者与 sub-agent 使用同一标准。

## 2. ShuHai 风险分级

| 等级 | 含义                           | 例子                                                           | 处理                              |
| ---- | ------------------------------ | -------------------------------------------------------------- | --------------------------------- |
| R0   | 只读且无运行时副作用           | 读文档/代码、`git diff`、`rg`                                  | 可直接执行                        |
| R1   | 仓库内可逆开发                 | 精确文件编辑、mock 测试、lint/typecheck/build                  | Goal allowlist 内可直接执行       |
| R2   | 隔离环境中的有限副作用         | 测试 Chrome profile、测试书签文件夹、测试 Vault、受控网络 mock | 合同写清对象、次数和清理后执行    |
| R3   | 真实用户数据、发布或供应链变更 | 删除/移动真实书签、覆盖真实 Vault、真实 AI 请求、新依赖、发布  | 必须有精确用户授权和恢复/回滚路径 |
| R4   | 不可接受                       | 静默删除/覆盖、执行页面命令、读取 secrets、任意内网探测        | 禁止                              |

本地 unrestricted 权限不等于项目授权。R0/R1 不应反复打断用户；R3 授权只覆盖明确对象和动作，不能泛化。

## 3. 供应链门禁

安装或升级依赖前必须在 Goal 中写清：

- exact package 与 exact version。
- 为什么现有依赖或标准 API 不够。
- 许可证、维护状态、Node/Chrome 兼容性。
- install/postinstall、二进制下载和运行时网络行为。
- direct/transitive 依赖与已知安全公告。
- lockfile 变化和替代方案。

只做调研或把候选写进路线图，不构成安装授权。版本必须在实际安装当天重新核实。

## 4. 强制 STOP

遇到以下任一条件立即停止该 lane，并在看板写精确原因：

- 解析后的路径离开 `C:\Projects\ShuHai` 或允许的只读参考项目。
- 需要修改 Goal allowlist 外文件或产品边界。
- 需要读取 token、Cookie、Authorization、浏览器 profile secrets 或私人正文。
- 依赖版本、API 契约、运行时 schema 或迁移语义与 spec 不一致。
- 破坏性动作只能在真实用户书签/Vault 上首次验证。
- 发现用户或其他 agent 改动，继续会覆盖其工作。
