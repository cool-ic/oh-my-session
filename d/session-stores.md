# session-stores.md · 各 Agent 会话落盘与 resume

> 探查结论以真实磁盘为准。本文件是索引与提取规则。  
> 更新时机：发现新布局、resume 语义变化、提取字段变化。

---

## 统一数据模型（本工具）

```ts
SessionRecord {
  source: "grok" | "qoder" | "claude" | "codex" | "cursor"
  id: string
  title: string
  cwd: string | null          // 续跑目录（项目路径原文）
  createdAt / lastActive      // ISO
  messageCount: number
  path: string                // 会话存储文件/目录（不是续跑目录）
  health?: "ok" | "empty" | "missing"  // enrichSessions 写入
  extra?: {
    resume?: string           // 提示命令（以 resumeInfo() 为准）
    cwdSource?: string        // 路径从哪来的
    cwdMissing?: boolean
    storeMissing?: boolean
    isEmpty?: boolean
    numChatMessages?: number  // grok
    model / agentName?: ...
    projectSlug?: string      // qoder
  }
}
```

**续跑目录 `cwd` 语义：**

- 开启该 session 时的**项目路径**。  
- 用户要回答的是：「我该 `cd` 到哪里才能 resume？」  
- **路径被删后仍必须保留字符串**，`health=missing` + UI「目录没了」。  
- 不是本工具进程的 cwd。

**health（`lib/health.ts`）：**

| 值 | 条件 | 优先级 |
|----|------|--------|
| `missing` | `cwd` 非空且磁盘不存在，或 `path` 不存在 | 最高 |
| `empty` | `messageCount <= 0` | 次 |
| `ok` | 其余 | — |

---

## Grok Build

### 布局

```
$GROK_HOME/sessions/<url-encoded-cwd>/<session-id>/
  summary.json          # 索引元数据
  updates.jsonl         # 会话权威日志（/resume 依赖）
  chat_history.jsonl
  ...
$GROK_HOME/sessions/session_search.sqlite   # FTS（只读可用）
```

- `GROK_HOME` 默认 `~/.grok`。  
- cwd 编码：URL encode；超长时 slug+hash + 组内 `.cwd` 文件。  
- 本工具 **跨 encoded-cwd 全集扫描**（官方 `grok sessions list` 仅当前目录）。

### 字段映射

| SessionRecord | 来源 |
|---------------|------|
| id | `summary.info.id` |
| cwd | `summary.info.cwd`（cwdSource: `summary.json:info.cwd`） |
| title | `generated_title` / `session_summary` |
| lastActive | `last_active_at` / `updated_at` |
| messageCount | `num_messages`（主）；`num_chat_messages` 进 extra |
| path | session 目录 |

### Resume 语义（与 Qoder 不同）

| 方式 | 行为 |
|------|------|
| `grok --resume <uuid>` | **按 ID 全局打开**，不强制 shell 当前目录 = 原 cwd |
| 非 UUID 标题 | 只匹配**当前目录**下会话 |
| 无参 `--resume` / `-c` | **当前目录**最近一条 |
| 欢迎页 / `sessions list` | 当前目录 |

本工具展示：

- 命令：`grok --resume <id>`（不强制 `cd`）  
- 详情仍显示原项目路径 + 说明「ID 可跨目录；标题/-c 认当前目录」  

官方：`~/.grok/docs/user-guide/17-sessions.md`。

### Rename（TUI `i`）

写 `summary.json`：`generated_title` 与 `session_summary` 同步为新标题（立即写盘）。

### 外源 → Grok handoff

`~/.grok/bundled/skills/shared/resume-session/session_reader.py`  
transcript 当**不可信历史**，只做 handoff 摘要。

---

## Qoder（qodercli）

### 布局

```
~/.qoder/projects/<cwd-slug>/
  <session-id>.jsonl              # 主日志（常含 cwd 字段）
  <session-id>-session.json       # 元数据（部分有）
  <session-id>/                   # compression / subagents / state
```

- `QODER_HOME` 默认 `~/.qoder`。  
- slug 例：`/home/f/gpu` → `-home-f-gpu`（**不可靠反推路径**，勿用 slug 当唯一来源）。

### 续跑目录提取（强制完整）

优先级：

1. `*-session.json` → `working_dir`  
2. 同 id 的 `.jsonl` 中消息行 `cwd`（多数会话靠这个）  
3. 禁止静默丢弃：目录删了也保留原文  

同一 `id` 多 slug 副本：去重，保留 `lastActive` 更新者，并尽量合并出 `cwd`。

### 字段映射

| SessionRecord | 来源 |
|---------------|------|
| messageCount | `message_count`；否则 jsonl 中 `user`+`assistant` 行数 |
| lastActive | `updated_at`（毫秒）或 jsonl mtime |
| title | meta.title；否则首条非 meta user / last-prompt |

### Resume 语义（路径硬绑定）

- **必须在开启时的项目路径下** resume（换目录会失败）。  
- 本工具命令：`cd <续跑目录> && qodercli -r <id>`  
- 其它：`qodercli -c`、`--list-sessions`（对照用，本工具以扫盘为准）

### Rename（TUI `i`）

upsert `<id>-session.json` 的 `title`（无 meta 则创建；discover 优先读 meta.title）。

---

## Claude Code

### 布局

```
$CLAUDE_CONFIG_DIR/projects/<slugified-cwd>/<session-uuid>.jsonl
```

- `CLAUDE_CONFIG_DIR` 默认 `~/.claude`（与官方 / Grok `session_reader.py` 一致）。
- slug：路径字符非 alnum 替为 `-`（例 `/home/f/gpu` → `-home-f-gpu`）。**slug 不可靠反推**，cwd 以 jsonl 内字段为准。
- 每行一条 JSON：`type` ∈ user / assistant / custom-title / ai-title / summary / last-prompt / …

### 字段映射

| SessionRecord | 来源 |
|---------------|------|
| id | 文件名 stem（UUID） |
| cwd | 首条带 `cwd` 的记录（cwdSource: `jsonl:cwd`） |
| title | **优先** custom-title → ai-title → summary → 首条非 meta user 文本 → last-prompt |
| messageCount | `type` ∈ {user, assistant} 且非 isMeta |
| lastActive | 末条 `timestamp`；否则文件 mtime |
| createdAt | 首条 `timestamp` |
| path | `.jsonl` 绝对路径 |
| extra.branch | 末条 `gitBranch` |
| extra.projectSlug | 父目录名 |

user 的 `message.content` 可能是 **string 或 content-block 数组**（须 `contentToText`）。

### Resume 语义

| 方式 | 行为 |
|------|------|
| `claude --resume <uuid>` | **按 ID 跨 project 查找**（本工具默认命令，不强制 `cd`） |
| `claude -c` / `--continue` | **仅当前目录**最近一条 |
| 无参 `--resume` | 交互选择器 |

本工具：`pathMode=recommended`；UI 只展示 `claude --resume <id>`，不写说教 Note。

### 删除

`:wq` 时 unlink 该 `.jsonl`（`lib/delete-session.ts`）。

### Rename（TUI `i`）

向 jsonl **追加**一行 `{"type":"custom-title","customTitle":"…"}`（与官方 `/rename` 一致；读时 custom-title 优先于 ai-title）。

---

## Codex / Cursor

| Source | 典型路径 | 本工具 |
|--------|----------|--------|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | 预留，未深做 |
| Cursor | agent-transcripts 等 | 预留 |

完整 transcript 解析可参考 Grok `session_reader.py`；本工具 list 层只要 id/时间/条数/标题/路径。

---

## 本工具 Resume 统一出口

`lib/format.ts`：

- `resumeInfo(s)` → `{ command, pathMode }`  
- `resumeHint(s)` → 仅 command  
- **UI 不展示 pathMode/note 文案**；Qoder 的路径约束写进 command 的 `cd … &&`  

| pathMode | 含义（内部） |
|----------|------|
| `required` | 必须在续跑目录（Qoder；已 bake 进 command） |
| `recommended` | ID 可别处开（Grok / Claude） |
| `unknown` | 无路径记录 |
