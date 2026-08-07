# Goal 048 v3 implementation report

- Status: `READY_FOR_REVIEW`
- Goal: `048 Host Command Incident Containment v3`
- Generated: `2026-08-07` on the replay checkout
- Branch: `codex/goal-048-host-command-replay`
- Base and HEAD before commit: `6157ed9ca138510b23431e42c41196fb4badcfd4`
- Baseline source: live-verified `origin/main`; the old `13402ca` candidate is reference evidence only

## Implemented user result

The current-main replay provides one bounded Windows host-command entry for local install, dev,
build, lint, typecheck, test, coverage, E2E, Husky, Prettier, and dogfood workflows. Five dogfood
operations now have exact profiles, sealed raw routes, fixed argv, and strict lowercase scalar
policies. `dogfood-create` keeps one Heavy Lane lease while its nested extension builds run through
the sealed dispatcher. No real package tool, release command, or browser has been run by Goal 048.

The replay also preserves current Chrome-extension product boundaries, Goal 041-046E facts,
dependency sections, the shared-first typecheck route, extension script lint coverage, and the
frozen Goal 046E acceptance-fix worktree.

The v3 correction reserves the fixed receipt pending path with exclusive create before any target
setup, holds receipt ownership through the single atomic publication commit point, excludes
receipt transport from the target-cleanup ledger, and makes post-commit teardown non-throwing.
It also makes release ID, manifest/Chrome version, and pnpm provenance schemas use the same strict
authority during create and verify.

## Exact durable manifest

The candidate contains exactly these 30 durable paths:

1. `.gitignore`
2. `.husky/pre-commit`
3. `AGENTS.md`
4. `CLAUDE.md`
5. `CONTRIBUTING.md`
6. `README.md`
7. `docs/PROJECT_STATUS.md`
8. `docs/dogfood/release-guide.md`
9. `docs/goals/README.md`
10. `docs/goals/goal-046e-versioned-dogfood-release.md`
11. `docs/goals/goal-048-host-command-incident-containment.md`
12. `docs/workflows/command-safety.md`
13. `docs/workflows/dangerous-command-denylist.md`
14. `docs/workflows/verification-and-acceptance.md`
15. `package.json`
16. `packages/desktop/package.json`
17. `packages/extension/package.json`
18. `packages/extension/scripts/dogfood-release.ts`
19. `packages/extension/vitest.config.ts`
20. `packages/shared/package.json`
21. `playwright.config.ts`
22. `vitest.config.ts`
23. `scripts/host-command/BoundedHostCommandRunner.cs`
24. `scripts/host-command/Invoke-ShuHaiBoundedCommand.ps1`
25. `scripts/host-command/Test-ShuHaiBoundedCommand.ps1`
26. `scripts/host-command/assert-session.cjs`
27. `scripts/host-command/host-command-registry.json`
28. `scripts/host-command/hostile-child.cjs`
29. `scripts/host-command/shuhai-command.cjs`
30. `.tmp/host-stability-narrow-v1/implementation-report.md`

No durable test artifact is part of this manifest. The fixed suite may only use
`.tmp/host-stability-narrow-v1/test/**` and the bounded overwrite receipt
`.tmp/host-command/current.json`.

## Independent reviews before acceptance

- Contract re-review: `PASS`, with P0/P1/P2/P3 = `0/0/0/0`.
- Replay method review: `PASS`.
- Semantic replay review: `PASS_TO_STATIC`, with P0/P1/P2/P3 = `0/0/0/0`.
- Post-correction semantic delta review: `DELTA_PASS`, with P0/P1/P2/P3 = `0/0/0/0`.
- Harness review: `HARNESS_PASS`, with P0/P1/P2/P3 = `0/0/0/0`.
- Ownership audit: `OWNERSHIP_PASS`; before this report the only missing manifest path was this
  file, allowlist-external delta was `0`, and staged files were `0`.
- v3 contract reviews: receipt and schema contracts both `PASS`; final contract review
  P0/P1/P2/P3 = `0/0/0/0`.
- v3 implementation reviews: `V3_RECEIPT_PASS` and `V3_SCHEMA_HARNESS_PASS`; after closing the two
  harness-strength P3 findings, P0/P1/P2/P3 = `0/0/0/0`.

Review-driven corrections included exact profile/operation/raw inventory checks, exact
lifecycle and lint-staged raw definitions, three-layer scalar probes, case-sensitive lowercase
hex enforcement, and fail-closed parent-chain checks for both synthetic test files and receipt
writes.

## Static evidence before fixed acceptance

- Node syntax: `PASS` for all 3 `.cjs` files.
- JSON parse: `PASS` for root/desktop/extension/shared package manifests and the registry (`5/5`).
- PowerShell AST: `PASS` for both scripts (`2/2`) after the final corrections.
- C# compile: `PASS` (`1/1`); v3 runner SHA-256 is
  `41f9c940e366a7ba30a07369275deb3f50dc11251556e5311a3c7eae340ccbb3`.
- `git diff --check`: `PASS`; Git emitted only line-ending conversion warnings.
- Byte-copy contract: the remaining `7/7` expected SHA-256 values matched.
- Frozen Goal 046E ownership: `3/3` expected SHA-256 values matched, staged `0`.
- Dependency/devDependency sections: unchanged from `6157ed9`; lockfile, CI, extension source,
  acceptance implementation, and acceptance/release tests have no Goal 048 delta.

## Superseded v2 acceptance evidence

Preflight immediately before acceptance confirmed live remote `main`, local `origin/main`, and
HEAD all at `6157ed9ca138510b23431e42c41196fb4badcfd4`; durable manifest `30/30`, missing/extra
`0/0`, staged `0`, task-owned PID/TCP/UDP `0/0/0`, and an available Heavy Lane.

The v2 fixed synthetic suite was run once. It completed in 23.5 seconds with `10/10 PASS`:

1. registry plus public/PowerShell/sealed OID and release policy;
2. bounded green child;
3. stdout/stderr limits and invalid UTF-8 digest accounting;
4. independent idle and wall deadlines;
5. child/grandchild PID and loopback TCP/UDP cleanup;
6. cancellation and parent-exception exactly-once cleanup;
7. four-way Heavy Lane contention and one-lease nested raw dispatch;
8. single bounded atomic overwrite receipt;
9. exact route/profile/operation/raw/lifecycle/document authority gate;
10. exact manifest, staged, test-temp, marker, PID/port, and receipt hygiene.

That v2 run produced the following evidence:

- Receipt: exactly `.tmp/host-command/current.json`, 1106 bytes; no pending or second receipt file.
- Final receipt: `synthetic-green`, `completed`, exit `0`, `JobEmpty=true`, owned PID/TCP/UDP
  `0/0/0`, readers and handle obligations proven, ledger proven, unproven obligations `0`, secondary
  cleanup errors `0`.
- Test directory: `0` remaining items; task-process snapshot empty; Heavy Lane released.
- Durable candidate: exact `30/30`, staged `0`; then-applicable byte-copy hashes `8/8` unchanged.
- Frozen Goal 046E worktree: hashes `3/3` unchanged, staged `0`.

The independent final review then returned `REWORK`, P0/P1/P2/P3=`0/0/3/1`. The preceding
`10/10` is retained only as superseded normal-path evidence and does not authorize commit or PR.
The three blocking findings were:

1. an existing ordinary `current.json.pending` could be truncated without invocation ownership;
2. receipt bootstrap obligations could fail after an optimistic success receipt was already
   published;
3. public release ID and pnpm provenance policies were stricter than the create/verify metadata
   schemas.

## Current v3 candidate evidence

The v3 diff changes only the contract-authorized receipt transport, fixed-suite assertions,
exact pending ignore, and dogfood schemas. Current implementation hashes are:

- `.gitignore`: `3d3e56c48663e1f47c1f5baa13e595d46d2e7c3a8a75a6fbf571500dc3cec2f9`
- `BoundedHostCommandRunner.cs`:
  `41f9c940e366a7ba30a07369275deb3f50dc11251556e5311a3c7eae340ccbb3`
- `Test-ShuHaiBoundedCommand.ps1`:
  `18d2d28a75e6faa22c1c98bd97850677ee0d5e2ab25e998f07b3af35d39570f3`
- `dogfood-release.ts`:
  `3eed49bf5d5bcb0627734c919aadaa35d0a6bbb4d9b6348925a60819db4532d4`

The durable manifest remains exact `30/30`, staged files remain `0`, the seven byte-copy paths and
three frozen Goal 046E hashes match, and `current.json.pending` was absent before acceptance. The
old v2 `10/10` remains explicitly superseded.

## Fixed v3 acceptance evidence

Immediately before acceptance, live remote `main`, local `origin/main`, and HEAD were all
`6157ed9ca138510b23431e42c41196fb4badcfd4`; manifest/staged were `30/30` and `0`, task-owned
PID/TCP/UDP were `0/0/0`, Heavy Lane was available and non-abandoned, foreign dirty ownership
remained `42/29/3`, and frozen Goal 046E hashes remained `3/3`.

The fixed v3 10-case KiB synthetic suite was then run exactly once. It completed in 23.7 seconds
with `10/10 PASS`. In particular, Case 8 proved foreign pending preservation for quick and
heavy-acquired paths, no pre-target start, locked-current atomic publication failure with the old
receipt unchanged, exact owned-pending cleanup, and successful recovery publication.

Independent post-suite checks passed:

- receipt: exactly one normal non-reparse `current.json`, 1105 bytes, SHA-256
  `5fd27257cc5fddd25065a27a071c29a97bb006a8263393d0d2bc58b11d31119d`;
- final result: `synthetic-green/completed`, wrapper and target exit `0`, `JobEmpty=true`, readers,
  handles and ledger proven, unproven obligations `0`, secondary cleanup errors `0`;
- pending absent, test temp `0`, task-owned PID/TCP/UDP `0/0/0`, Heavy Lane clean;
- durable manifest `30/30`, staged `0`, byte-copy `7/7`, frozen Goal 046E `3/3`.

Two fresh final reviewers independently checked the actual v3 diff, current receipt,
current-base inheritance, status-only updates, and foreign ownership:

- `FINAL_SECURITY_PASS`, P0/P1/P2/P3=`0/0/0/1`;
- `FINAL_EVIDENCE_PASS`, P0/P1/P2/P3=`0/0/0/1`.

Their only shared P3 is the pre-existing transient status text at
`docs/workflows/README.md:64`, outside the Goal 048 allowlist. It does not affect runtime or
ownership acceptance. No stage, commit, push, PR, real package tool, dogfood operation, or browser
action has occurred. Unique next gate: exact 30-path stage, contract-authorized no-Husky commit,
then PR/CI/merge.
