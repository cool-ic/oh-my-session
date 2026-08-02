# oh-my-sessions

List local agent sessions (**Grok Build**, **Qoder**, **Claude Code**, …) and answer:

1. **Which sessions exist** (age, whether resumable)  
2. **Where to resume and which command to run**  
3. **What was said** — Enter opens chat in the right pane (near→far)

---

## Usage

```bash
cd oh-my-sessions
npm install    # first time
npm start      # interactive TUI
```

CLI (after `npm link` or global install):

```bash
oh-my-sessions    # or: oms
```

Gates / scripts:

```bash
npm run build
npm run list
npm run list:json
```

---

## UI

**Layout:** brand bar → table → detail pane (wide: side-by-side).

**Table columns:** STATUS · SOURCE · AGE · MSGS · TITLE · RESUME DIR  

| Badge | Meaning |
|-------|---------|
| **OK** | Has messages; resume dir exists |
| **Empty** | 0 messages |
| **Missing** | Path deleted on disk (text still shown) |

**Keys (vim-ish)**

| Key | Action |
|-----|--------|
| `↑`/`↓` | Move |
| **`Enter`** | Open chat (view only, near→far) in right pane |
| `Tab` | Focus **tags** rail ↔ **sessions** table |
| `t` | Assign tag (pick existing or type new in left rail) |
| `Space` | Toggle multi-select |
| **`*`** | Star / unstar — pin; blocks `dd` |
| **`i`** | Rename → `data/session-titles.csv` |
| `gg`/`G` | Top / bottom |
| `dd` | Mark delete: all selected, or cursor if none |
| `u` | Undo last delete mark |
| `y`/`yy`/`r` | **copy resume command** — show in footer for copy (does not run) |
| `/` | Search |
| Esc | Close chat → sessions; or clear multi-select; else hint quit |
| **`:empty`** / **`:missing`** / **`:bad`** | Bulk-select Empty / Missing / both |
| **`:sel e\|m\|bad\|none`** | Same family; `:sel none` clears selection |
| **`:q`** | Quit if no pending deletes |
| **`:q!`** | Quit discarding pending delete marks |
| **`:wq`** | Apply pending deletes and quit |
| `:help` | List ex commands |
| bare `q` | Does not quit (use `:q`) |

Details: [`d/ui-tui.md`](./d/ui-tui.md).

**Resume commands**

```bash
# Qoder — must be in original project dir
cd /path/to/project && qodercli -r <id>

# Grok — UUID works from any cwd
grok --resume <id>

# Claude Code — UUID works from any cwd (-c is current-dir only)
claude --resume <id>
```

Claude sessions live under `~/.claude/projects/<slug>/*.jsonl` (or `$CLAUDE_CONFIG_DIR`).

---

## Living docs (Agent)

| Doc | Role |
|-----|------|
| [workflow.md](./workflow.md) | Process authority |
| [compact-summary.md](./compact-summary.md) | Session progress |
| [d/constraints.md](./d/constraints.md) | Boundaries |
| [d/session-stores.md](./d/session-stores.md) | Storage & resume |
| [d/ui-tui.md](./d/ui-tui.md) | TUI spec |
| [d/codemap.md](./d/codemap.md) | Code map |
