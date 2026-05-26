# Multi-Agent Collaboration Guide

## Roles

| Role | Model | Responsibility | File Scope |
|------|-------|----------------|------------|
| Architect | Claude Opus 4.7 | Design, specs, PR review, orchestration | `docs/`, `scripts/`, `.github/`, config files |
| Core Dev | ChatGPT 5 / Codex | Main process logic, pipeline, data layer | `packages/desktop/src/main/`, `packages/shared/` |
| QA | GLM (local) | Run tests, E2E verification, reports | Read-only |
| Peripheral | DeepSeek (local) | UI components, docs, scripts, config | `packages/desktop/src/renderer/`, `docs/`, `scripts/` |

## Workflow

1. Architect writes spec in `docs/specs/NNN-<name>.md`
2. Architect creates GitHub Issue and assigns to implementer
3. Implementer works on `feat/<name>` branch
4. Implementer runs `pnpm lint && pnpm typecheck && pnpm test`
5. Implementer creates PR to `dev` branch
6. QA runs full test suite on PR branch
7. Architect reviews and merges

## Spec Conventions

- `MUST` = hard constraint, no deviation allowed
- `SHOULD` = recommendation, deviation requires explanation in PR
- Each spec has a `version` field; PR must reference spec version
- Specs include "Prior Context" linking related completed work

## Branch Strategy

```
main ← PR (release) ← dev ← PR (feature) ← feat/xxx
```

## Quality Gates

All PRs must pass:
- `pnpm typecheck` (zero errors)
- `pnpm lint` (zero errors)
- `pnpm test` (all tests pass)
- GitHub Actions CI (final authority)
