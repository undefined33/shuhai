# ShuHai 书海

> AI-driven bookmark knowledge management tool
> AI 驱动的书签知识库管理工具

ShuHai collects your scattered bookmarks from Chrome, Twitter, and Weibo, uses AI (DeepSeek) to intelligently classify and summarize them, then exports structured Markdown to your Obsidian vault — turning chaotic bookmarks into an organized knowledge base.

书海将你散落在 Chrome、推特、微博中的书签统一采集，用 AI（DeepSeek）智能分类和摘要，再以结构化 Markdown 导出到 Obsidian，把混乱的收藏变成有序的知识库。

## Features

- **Chrome Bookmarks** — Reads local Chrome bookmark files directly, no extension needed
- **AI Classification** — DeepSeek-powered intelligent categorization, tagging, and summarization
- **URL Health Check** — Detects dead links, redirects, and unreachable pages
- **Obsidian Export** — Generates Markdown with YAML frontmatter, Dataview-compatible
- **Rule Engine** — Domain/keyword-based classification that works without AI
- **Incremental Sync** — Only processes new/changed bookmarks
- **Privacy First** — All data stays local; AI calls are optional

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+
git clone https://github.com/undefined33/shuhai.git
cd shuhai
pnpm install
pnpm test
```

## Architecture

```
ShuHai/
├── packages/
│   ├── shared/          # Types, interfaces, constants
│   └── desktop/         # Electron app (main + renderer)
├── docs/specs/          # Feature specifications
└── scripts/             # Build and orchestration
```

### Data Pipeline

```
Chrome Bookmarks JSON
       ↓ read & parse
RawBookmark[]
       ↓ normalize URLs, deduplicate
       ↓ rule-based classification (domain/keyword)
       ↓ AI classification (DeepSeek, optional)
ProcessedBookmark[]
       ↓ generate Markdown + frontmatter
Obsidian Vault (.md files)
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 20+, TypeScript |
| Desktop | Electron |
| Monorepo | pnpm workspace |
| Database | SQLite (better-sqlite3) |
| AI | DeepSeek API (primary), pluggable LLM Provider |
| Testing | Vitest |
| Linting | ESLint 9 + Prettier |

## Roadmap

- [x] Project skeleton & type definitions
- [ ] Chrome bookmark file reader
- [ ] URL normalization & deduplication
- [ ] Rule-based classification engine
- [ ] Markdown/Obsidian exporter
- [ ] AI classification (DeepSeek integration)
- [ ] URL health checker
- [ ] Electron GUI + system tray
- [ ] Chrome extension for Twitter/Weibo (Phase 2)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
