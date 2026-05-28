# ShuHai - Project Guidelines

## Overview

AI-driven bookmark knowledge management tool. Collects bookmarks from Chrome/Twitter/Weibo, classifies with AI (DeepSeek), and exports structured Markdown to Obsidian.

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript, Electron
- **Monorepo**: pnpm workspace
- **Testing**: Vitest
- **Linting**: ESLint 9 (flat config) + Prettier
- **Database**: SQLite (better-sqlite3)
- **AI**: DeepSeek API (primary), pluggable LLM Provider

## Commands

```bash
pnpm install          # Install all dependencies
pnpm test             # Run all tests
pnpm test:coverage    # Run tests with coverage thresholds
pnpm test:e2e         # Run extension E2E tests after building it
pnpm lint             # Lint all packages
pnpm typecheck        # Type-check all packages
pnpm build            # Build all packages
pnpm dev              # Start dev mode
```

## Supply Chain Security

All dependency installations MUST follow these rules:

- Run `/supply-chain-guard <package>` before any `pnpm add`
- Use exact versions (no `^` or `~` prefixes)
- Never install packages released less than 7 days ago
- Verify package name spelling (typosquatting risk)
- Only install from official sources (npmjs.com)
- Single-maintainer packages created < 6 months ago require human approval
- Binary downloads must be scanned via VirusTotal first

## Quality Gates

- **Pre-commit**: husky + lint-staged run ESLint and Prettier on staged files.
- **CI**: GitHub Actions runs lint, typecheck, coverage tests, and build on push/PR.
- **Coverage**: `pnpm test:coverage` uses Vitest coverage thresholds as the current baseline.
- **E2E**: run `pnpm --filter @shuhai/extension run build && pnpm test:e2e` locally.
- **Commit rule**: commits should be made only after `pnpm lint && pnpm typecheck && pnpm test` passes.

## Code Style

- Strict TypeScript (`strict: true`)
- Single quotes, trailing commas, 100 char line width
- No unused variables (prefix with `_` if intentionally unused)
- Use `node:` prefix for Node.js built-in imports
- Use `.js` extension in relative imports (ESM)

## Architecture

- `packages/shared` — Types, interfaces, constants (no runtime deps)
- `packages/desktop` — Electron app (main + renderer processes)
- `docs/specs/` — Feature specifications for implementation
- `scripts/` — Build and orchestration tooling
