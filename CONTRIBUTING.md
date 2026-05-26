# Contributing to ShuHai

## Development Setup

```bash
# Prerequisites: Node.js 20+, pnpm 9+
git clone https://github.com/<owner>/shuhai.git
cd shuhai
pnpm install
pnpm test
```

## Adding a New Bookmark Source (Adapter)

1. Implement `BookmarkSource` interface from `@shuhai/shared`
2. Place in `packages/desktop/src/main/readers/`
3. Register in the pipeline configuration
4. Add tests in `packages/desktop/tests/`

## Adding a New Exporter

1. Implement `Exporter` interface from `@shuhai/shared`
2. Place in `packages/desktop/src/main/exporters/`
3. Add tests

## Adding a New LLM Provider

1. Implement `LLMProvider` interface from `@shuhai/shared`
2. Place in `packages/desktop/src/main/ai/`
3. Add provider option to `AIConfig`

## Code Standards

- TypeScript strict mode
- All exports must have JSDoc comments
- Tests required for new features
- Run `pnpm lint && pnpm typecheck` before committing

## Commit Messages

Use conventional commits:
- `feat:` new feature
- `fix:` bug fix
- `refactor:` code restructuring
- `docs:` documentation only
- `test:` adding/updating tests
- `chore:` tooling, deps, config
