# 验证与验收

## 1. 两个不同结论

- `CANDIDATE`：实现者完成代码并跑过合同内门禁。
- `ACCEPTED`：Reviewer/QA 检查实际 diff、测试证据和必要的真实用户旅程后给出的结论。

实现者不能用“我写了测试”替代独立验收。独立角色不可用时，必须诚实写 `NEED_EVIDENCE`，不能把自测提升成产品通过。

## 2. Review verdict

只使用以下结论：

- `PASS`：范围、行为、门禁和必要证据完整。
- `SOFT_PASS`：核心正确，但存在明确且不阻塞合并的剩余风险。
- `REWORK`：有可行动缺陷，需在当前 Goal 内修复。
- `NEED_EVIDENCE`：代码可能正确，但缺少指定测试或真实旅程。
- `BLOCKED`：外部条件阻止验收，写清恢复事件。

Review 先列问题，按数据损坏、安全、行为回归、缺测、体验排序；worker 自述不是证据。

## 3. QA Delta

每个 Goal 只增加与其风险匹配的验证，不机械重跑一切：

```text
变更的用户行为:
可能损坏的数据:
新增/改变的信任边界:
新增单元测试:
新增集成测试:
需要的 Chrome 旅程:
不在本 Goal 验证的风险:
```

所有业务 Goal 仍须通过：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shuhai/extension run build
```

### 风险匹配

- 文档、静态元数据和窄范围文案可以使用较短合同与证据，但仍须运行完整仓库门禁。
- 用户可见 UI 即使属于轻轨，也必须有视觉或“用户实际看到什么”的证据。
- 触碰 Vault、书签 mutation、权限、message/Port、storage、迁移、供应链或外部网络时，
  自动进入硬轨：精确 allowlist、攻击/故障测试和独立安全 review 都不可省略。
- 风险匹配用于减少无效仪式，不用于降低数据和安全标准。

## 4. 用户真相

每次用户可见验收都要单独回答：

```text
我作为用户实际看到或使用了什么:
最明显的摩擦，或为何没有可行动问题:
代表产物、截图或路径:
测试没有覆盖的用户风险:
```

不得要求 Reviewer 凑出固定数量的问题。没有发现时写清观察范围和剩余风险；有问题时按真实
严重度记录，不用无关细节满足形式配额。

## 5. Chrome 产品验收

涉及用户流程时，验收必须绑定代码真相和渲染真相：

- 当前 commit 与完整 `git status`。
- 加载的扩展构建目录和 Chrome profile 类型。
- popup、窄 Side Panel 或 Options 中实际走过的步骤。
- 长文本、深浅主题、键盘、焦点和错误态（适用时）。
- console/runtime error。
- 截图或 DOM 断言；截图不能单独证明数据语义。

如果测试的是旧 bundle、错误 profile 或缓存页面，不能给产品 PASS。

## 6. 破坏性操作专项

批量删除、移动、URL 更新、Vault 写入和恢复必须：

1. 首次在隔离书签文件夹或测试 Vault 中执行。
2. 同时覆盖全部成功、部分失败、关闭后恢复和冲突拒绝。
3. 显式确认，不把 timeout/403/429/5xx 自动当作可删除死链。
4. 逐项记录结果，批次状态正确表达 `partial`。
5. 验证恢复只逆转本批实际成功项，不覆盖用户之后的手工修改。

真实用户数据只在隔离证据通过后，由用户授权执行。

## 7. 验收记录

大模块在转 `DONE` 前，Goal 或 `docs/reviews/` 记录：

```text
Goal / commit:
实际 changed files:
commands and results:
manual journey:
user truth:
verdict:
remaining risks:
git status:
commit / push / PR truth:
```

命令没有运行、Chrome 旅程无法执行或证据来自实现者本人时，必须明确写出。
