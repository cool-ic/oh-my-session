<div align="center">

# oh-my-sessions

**One TUI to rule all your local agent sessions.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20WSL-lightgrey.svg)](#)
[![GitHub stars](https://img.shields.io/github/stars/cool-ic/oh-my-sessions?style=social)](https://github.com/cool-ic/oh-my-sessions)

**English** · [中文速览](./docs/README_zh-CN.md)

<br/>

List, inspect, tag, and clean up sessions from **Grok Build**, **Qoder**, and **Claude Code** — with resume commands, health badges, and a read-only chat transcript.

</div>

---

## Demo

Main UI (tags · sessions · detail):

![Main TUI](./docs/images/tui-main.png)

Chat view after **Enter** (near→far; **Esc** back to sessions):

![Chat TUI](./docs/images/tui-chat.png)

> Captured live with `./scripts/screenshot.sh` (`npm start` inside tmux → ANSI → PNG).

---

## Why?

You use more than one coding agent. Each dumps sessions into a different home directory with different resume rules. After a week you have dozens of half-finished threads and no idea:

| Question | Without this tool | With **oh-my-sessions** |
|----------|-------------------|-------------------------|
| What sessions do I still have? | Dig through `~/.grok`, `~/.qoder`, `~/.claude` | One sorted table |
| Can I resume this? | Trial and error | **OK / Empty / Missing** badges |
| Where do I `cd`? | Guess the project path | **RESUME DIR** column + copy command |
| What did we talk about? | Open raw JSONL | **Enter** → chat pane (near→far) |
| How do I organize? | Nowhere | Tags, stars, renames (local CSV) |

---

## Features

- **Multi-agent discovery** — Grok Build, Qoder, Claude Code (Codex / Cursor reserved)
- **Health at a glance** — `OK` · `Empty` · `Missing` (path gone but still shown)
- **Resume-ready** — footer / `y` shows the exact command (Qoder includes `cd …`)
- **Chat preview** — Enter opens a **view-only** transcript, newest first; Esc back to the list
- **Vim-ish TUI** — ↑↓ · gg/G · `/` search · Space multi-select · `dd` + `:wq` delete
- **Organize locally** — rename (`i`), star (`*`), tag (`t`) — **never rewrites agent stores**
- **Private by default** — titles / stars / tags live in gitignored CSV under `data/`
- **Auto refresh** — re-scans disk every 8s while idle
- **Scriptable** — `--list` / `--json` for pipes and automation

---

## Quick start

### Prerequisites

- **Node.js ≥ 18**
- A terminal with truecolor recommended (VS Code, Windows Terminal, iTerm2, …)

### Install & run

```bash
git clone https://github.com/cool-ic/oh-my-sessions.git
cd oh-my-sessions
npm install
npm start
```

### Global CLI (optional)

```bash
npm run build
npm link          # or: npm install -g .

oh-my-sessions    # full name
oms               # short alias
```

### Non-interactive

```bash
npm run list                 # plain table on stdout
npm run list:json            # JSON array

# After link / build:
oh-my-sessions --list
oh-my-sessions --json
oh-my-sessions --source grok,claude
oh-my-sessions --help
```

---

## Supported agents

| Source | Store (read-only) | Resume command |
|--------|-------------------|----------------|
| **Grok Build** | `$GROK_HOME/sessions/…` · `updates.jsonl` | `grok --resume <id>` (any cwd) |
| **Qoder** | Qoder project / history jsonl | `cd <project> && qodercli -r <id>` |
| **Claude Code** | `~/.claude/projects/<slug>/*.jsonl` | `claude --resume <id>` (any cwd) |
| Codex / Cursor | Reserved in types | — |

Path health and field mapping: [`d/session-stores.md`](./d/session-stores.md).

---

## UI overview

Wide terminals (≥ ~120 cols): **tags | session table | detail/chat**.

| Pane | Role |
|------|------|
| **Left · tags** | Filter by tag (`all` = everything). `t` assigns a tag |
| **Center · sessions** | Main list — select, multi-select, mark delete |
| **Right · detail / chat** | Meta (id, tag, resume cmd) or **Chat** after Enter |

### Status badges

| Badge | Meaning |
|-------|---------|
| **OK** | Has messages; resume path exists on disk |
| **Empty** | Zero messages (scratch / abandoned) |
| **Missing** | Resume path or store path gone — string still shown with `✗` |

---

## Keyboard cheatsheet

| Key | Action |
|-----|--------|
| `↑` `↓` · `PgUp` `PgDn` · `Ctrl-f` `Ctrl-b` | Move / page |
| `gg` / `G` · `H` `M` `L` · `z` | Top / bottom · screen · center |
| **`Enter`** | Open **chat** (near→far, view only) |
| **`Esc`** | Close chat → session list · or clear multi-select |
| `Tab` | Tags rail ↔ sessions (from chat: leave chat → sessions) |
| `t` | Assign / create tag for current session |
| `Space` | Toggle multi-select |
| `*` | Star / unstar — pin top; **blocks `dd`** until unstarred |
| `i` | Rename title (saved to local CSV) |
| `/` | Search title / id / path |
| `s` / `h` / `c` | Cycle source · health · clear filters |
| `y` `yy` `r` | Show **resume command** in footer (copy yourself; never runs it) |
| `dd` | Mark delete (selection or cursor; skipped if starred) |
| `u` | Undo last delete mark |
| `:empty` `:missing` `:bad` | Bulk-select by health |
| `:wq` | **Apply** deletes and quit |
| `:q` / `:q!` | Quit if clean · force quit discard marks |
| `:help` | Full shortcut overlay |

Bare `q` and `Ctrl-C` **do not** quit (avoids losing pending deletes).

Full spec: [`d/ui-tui.md`](./d/ui-tui.md) · in-app `:help`.

---

## Local settings (CSV)

Preferences are **local only** — they never patch Grok / Qoder / Claude stores.

| Feature | File | Notes |
|---------|------|--------|
| Rename (`i`) | `data/session-titles.csv` | `source,id,title,updated_at` |
| Star (`*`) | `data/session-stars.csv` | Pin + protect from `dd` |
| Tag (`t`) | `data/session-tags.csv` | One tag per session |

These paths are **gitignored**. Safe to back up privately; not published with the repo.

Runtime-only (not persisted): search filters, multi-select, scroll, open chat.

---

## How it works

```
 disk stores (read-only)
        │
        ▼
  discover/{grok,qoder,claude}
        │  SessionRecord[]
        ▼
  health · title CSV · star CSV · tag CSV
        │
        ├─► TUI (raw differential paint, CJK-aware width)
        └─► --list / --json
```

- **No network** for discovery — everything is local filesystem.
- **Delete** only happens on `:wq` after explicit `dd` marks.
- **Chat** reads jsonl / updates streams; shows user + assistant only (no tools/thoughts).

Architecture map: [`d/codemap.md`](./d/codemap.md).

---

## Screenshots (reproduce)

```bash
# needs: tmux, Python3 + Pillow, CJK font under scripts/fonts/
./scripts/screenshot.sh main    # → docs/images/tui-main.png
./scripts/screenshot.sh chat    # → docs/images/tui-chat.png
```

---

## Project layout

```
oh-my-sessions/
├── src/
│   ├── index.ts           # CLI entry
│   ├── discover/          # Grok / Qoder / Claude scanners
│   ├── lib/               # health, resume, CSV stores, transcript, width
│   └── tui/               # rawApp + theme
├── data/                  # local CSV (gitignored)
├── docs/
│   ├── README_zh-CN.md    # Chinese README
│   └── images/            # TUI screenshots
├── scripts/
│   ├── screenshot.sh      # tmux → PNG
│   └── ansi_to_png.py
├── d/                     # design / store / UI specs
├── package.json
└── README.md
```

---

## Configuration

| Variable | Effect |
|----------|--------|
| `AGENT_SESSION_SOURCES` | Comma list, e.g. `grok,claude` (default: `grok,qoder,claude`) |
| `GROK_HOME` | Grok data root (if set by the Grok tooling) |
| `CLAUDE_CONFIG_DIR` | Claude config root override |

---

## Roadmap

- [ ] Codex / Cursor discovery when layouts stabilize
- [ ] Optional clipboard write for resume command (platform-native)
- [ ] Export selected sessions metadata
- [ ] Theme presets

Issues and PRs welcome: [github.com/cool-ic/oh-my-sessions](https://github.com/cool-ic/oh-my-sessions).

---

## Docs (for contributors / agents)

| Doc | Role |
|-----|------|
| [docs/README_zh-CN.md](./docs/README_zh-CN.md) | Full Chinese README |
| [d/ui-tui.md](./d/ui-tui.md) | TUI layout & keys |
| [d/session-stores.md](./d/session-stores.md) | On-disk formats & resume semantics |
| [d/constraints.md](./d/constraints.md) | Hard boundaries |
| [d/codemap.md](./d/codemap.md) | Module map |
| [workflow.md](./workflow.md) | Process notes |

---

## License

[MIT](./LICENSE) © cool-ic

---

<div align="center">

**Stop hunting through `~/.agent` folders. Start a session with `npm start`.**

</div>
