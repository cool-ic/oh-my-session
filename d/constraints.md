# constraints.md · 硬边界

> 任何实质工作前必读。更新时机：路径/权限/禁止操作变化。

---

## 1. 权限与副作用

1. **只读**用户 Agent 会话存储：  
   - `~/.grok/sessions/`（或 `$GROK_HOME/sessions/`）  
   - `~/.qoder/projects/`、`~/.qoder/logs/sessions/`  
   - Claude/Codex/Cursor 等配置目录下的会话文件  
2. **禁止**在未走 TUI 流程时随意删会话；禁止调用 `qodercli --delete-session` 等未接入本工具的破坏性 CLI。  
3. **允许（显式产品能力）**：
   - TUI 中 `Space` 片选、`:empty`/`:missing`/`:bad` 批量片选、`dd` **标记**删除（有片选则批量；否则当前行）→ 仅在 **`:wq`** 时由 `lib/delete-session.ts` 删除对应会话存储（Grok 会话目录 / Qoder jsonl+meta+dir / Claude jsonl）。**无确认框**。
   - TUI 中 **`i` rename**：写 **`data/session-titles.csv`**，不改 Agent 原生存储。  
   - TUI 中 **`*` star**：写 **`data/session-stars.csv`**；星标会话置顶且 **`dd` 不可删**，须先取消星标。  
   - TUI 中 **`:retention`**：这是**唯一**允许写 Agent **配置文件**（`~/.qoder/settings.json`、`~/.claude/settings.json`）的路径；会话存储本身仍然只读。约束：**必须**先在浮层里展示要改的键与文件路径并等用户 `y` 确认；read-modify-write 保留其余所有键；写前把原文件复制为 `settings.json.bak`；原文件不是合法 JSON 时**拒绝**写入并提示手改；落盘用 `.tmp` + `rename` 原子替换。启动时只做只读体检（footer / stderr 提示），**不**自动改配。
4. **允许**：改本仓库代码与文档；跑只读对照（`grok sessions list` 等）。  
5. **允许**：读会话元数据；**禁止**把完整 transcript 正文写入本仓库常驻文档或提交 git。  
6. **退出**（vim 语义）：
   - **`:q`** / `:quit`：若 **无** pending `dd` 删除标记 → 直接退出；若有 → 拒绝并提示 `:wq` / `:q!`。
   - **`:q!`**：丢弃 pending 删除标记后强制退出（**不**删盘）。
   - **`:wq`** / `:x`：执行全部 `dd` 标记的删除后退出。
   - bare `q` / Esc / Ctrl-C **不**退出（提示用 `:q` / `:wq`）。  
7. **`u`**：撤销尚未 `:wq` 的删除标记（恢复列表行）。  

---

## 2. 运行环境

- Node.js ≥ 18；npm  
- **不强制**本机已装 `grok` / `qodercli` 才能 list（扫盘即可）  
- 展示 resume 命令时不验证 CLI 是否在 PATH（可后续增强）  

---

## 3. 环境变量

| 变量 | 含义 |
|------|------|
| `GROK_HOME` | Grok 根，默认 `~/.grok` |
| `QODER_CONFIG_DIR` | Qoder 根，默认 `~/.qoder`（官方文档变量，优先级最高） |
| `QODER_HOME` | Qoder 根旧变量，仅作兼容回退 |
| `CLAUDE_CONFIG_DIR` | Claude 根，默认 `~/.claude` |
| `CODEX_HOME` | Codex 根，默认 `~/.codex` |
| `AGENT_SESSION_SOURCES` | 逗号分隔 source 过滤，如 `grok,qoder` |
| `OMS_DATA_DIR` | 本地 CSV（标题/星标/标签）目录，默认 `<repo>/data`；截图 fixture 用它避免污染用户数据 |

---

## 4. 数据语义

| 字段/概念 | 规则 |
|-----------|------|
| `messageCount` | 各 source 尽力取元数据；口径不完全一致时以 source 区分，不假装统一 |
| Grok 条数 | `num_messages` 为主；`num_chat_messages` 可进 extra |
| Qoder 条数 | `message_count`；缺则 jsonl `user`+`assistant` |
| **续跑目录 `cwd`** | 开启会话时的**项目路径**；resume 应去哪。删了也保留原文 |
| `health` | `missing` > `empty` > `ok`（见 session-stores） |
| `path` | 会话存储位置，≠ 续跑目录 |

---

## 5. TUI / CLI

- 日常入口：`npm start`  
- `y` / `r`：= **copy resume command**（底栏展示，不 spawn）  
- **`i`**：rename → `data/session-titles.csv`（见 §1.3）  
- `Space` → 片选切换；`:empty`/`:missing`/`:bad`（或 `:sel …`）→ 批量片选；`dd` → 标记删除（片选批量 / 否则当前行）；`:wq` → **真正删盘** 并退出（见上 §1.3 / §1.6）  
- **禁止**全帧 erase 重绘（workflow §2.6；BUG-001）  
- 列宽/分栏/脑门/快捷键：见 `d/ui-tui.md`  
- 改发现/删除/绘制后：Phase D 门禁  

---

## 6. 文档纪律

- 过程权威：`workflow.md`  
- 新增 d 文档必须：挂 workflow §3 + 总纲领 §7.2 索引  
- compact-summary 保持短、可扫完  
