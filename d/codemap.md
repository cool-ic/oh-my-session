# codemap.md · 代码结构现状

> 更新时机：目录/模块职责变化后。

---

## 树

```
oh-my-session/
  总纲领.md
  workflow.md                 # 过程权威
  compact-summary.md          # 会话续跑
  README.md                   # 人读入口
  package.json / tsconfig.json
  scripts/
    ansi_to_png.py            # 可选：tmux ANSI → PNG（无 CJK 字体时汉字糊）
  d/
    constraints.md
    session-stores.md
    ui-tui.md                 # TUI 布局/列/快捷键
    codemap.md                # 本文件
    尚存bug.md
    应该被忽略的bug.md
  src/
    index.ts                  # CLI：TUI | --list | --json | --help
    types.ts                  # SessionRecord / Health / Source
    discover/
      index.ts                # discoverAll + 排序 + AGENT_SESSION_SOURCES
      grok.ts
      qoder.ts                # jsonl cwd 提取 + 去重
      claude.ts
    lib/
      health.ts               # enrichSessions / inspectSession
      format.ts               # --list 表、resumeInfo/resumeHint
      delete-session.ts       # :wq 时真正删盘
      rename-session.ts       # i rename → title-store CSV
      title-store.ts          # ~/.config/oms/session-titles.csv 读写
      star-store.ts           # session-stars.csv；置顶 + 禁 dd
      tag-store.ts            # session-tags.csv；一会话一 tag
      transcript.ts           # Enter 聊天：近→远 user/assistant
      retention.ts            # 保留期体检 + fix config（Grok toml / Qoder+Claude json）
      retention-prefs.ts      # 用户级 ignore 偏好 retention-prefs.csv
      time.ts                 # formatAge 2s|30m|5d|1mo
      width.ts                # CJK 显示宽 / pad / truncate
      paths.ts                # dataDir (~/.config/oms) · QODER/GROK/CLAUDE homes
      fsutil.ts               # 只读 fs
      jsonl-text.ts           # jsonl content → 纯文本
    tui/
      rawApp.ts               # 差分 TUI（主界面）
      theme.ts                # 绿主题 + canvas
  dist/                       # tsc 输出
```

---

## 数据流

```
磁盘会话存储
  → discover/*  → SessionRecord[]
  → enrichSessions (health, cwdMissing, …)
  → npm start: runRawTui
  → --list / --json: formatTable / JSON.stringify
```

---

## 模块职责

| 模块 | 职责 | 不负责 |
|------|------|--------|
| `discover/*` | 只读扫盘、字段映射、Qoder 去重 | 写盘、UI |
| `lib/health` | health 分类 | 提取路径（在 discover） |
| `lib/format` | 纯文本表、resume 文案 | 绘制 |
| `lib/width` | 终端列几何 | 业务 |
| `lib/retention` | 体检 Agent 自动删会话的配置；确认后合并写回 config（Grok `config.toml` / Qoder+Claude `settings.json`） | 决定何时提示（在 rawApp / index） |
| `tui/rawApp` | 分栏、表列、按键、差分重绘 | 发现逻辑 |
| `tui/theme` | 色板 | 布局数字 |
| `index.ts` | 参数、挂载 | 业务细节 |

---

## 依赖

| 类型 | 包 |
|------|-----|
| 运行时 | **无**（纯 Node + readline） |
| dev | `typescript`、`tsx`、`@types/node` |

**已移除：** `ink` / `react`（全帧 erase 闪屏，见 `尚存bug` BUG-001）。

---

## 入口

```bash
npm start              # tsx src/index.ts → TUI
npm run build          # tsc → dist/
npm run list           # --list
npm run list:json      # --json
node dist/index.js …   # 构建后
```

环境变量见 `d/constraints.md`。
