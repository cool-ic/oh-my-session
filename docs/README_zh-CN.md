<div align="center">

# oh-my-sessions

**一个 TUI，管齐你本机所有 Agent 会话。**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20WSL-lightgrey.svg)](#)
[![GitHub stars](https://img.shields.io/github/stars/cool-ic/oh-my-sessions?style=social)](https://github.com/cool-ic/oh-my-sessions)

[English](../README.md) · **简体中文**

<br/>

统一列举、查看、打标、清理 **Grok Build**、**Qoder**、**Claude Code** 等本地会话：续跑命令、健康状态、只读对话回看。

</div>

---

## 演示

主界面（标签栏 · 会话表 · 详情）：

![主界面](./images/tui-main.png)

打开聊天（Enter · 近→远 · Esc 回列表）：

![聊天视图](./images/tui-chat.png)

> 截图由 `./scripts/screenshot.sh` 在本机 `npm start` 后真实采集（tmux → ANSI → PNG）。

---

## 为什么需要？

你往往不只用一个编程 Agent。它们各自把会话丢在不同目录，续跑规则也不同。一周后你会面临：

| 问题 | 没有本工具 | 用 **oh-my-sessions** |
|------|------------|------------------------|
| 还有哪些会话？ | 翻 `~/.grok`、`~/.qoder`、`~/.claude` | 一张按活跃时间排序的表 |
| 还能不能续跑？ | 试了才知道 | **OK / Empty / Missing** 徽章 |
| 该 `cd` 到哪？ | 猜项目路径 | **RESUME DIR** + `y` 复制命令 |
| 当初聊了啥？ | 硬读 JSONL | **Enter** → 右侧聊天（近→远） |
| 怎么整理？ | 没有 | 标签 / 星标 / 重命名（本地 CSV） |

---

## 功能特性

- **多 Agent 发现** — Grok Build、Qoder、Claude Code（Codex / Cursor 预留）
- **健康一览** — `OK` · `Empty` · `Missing`（路径没了也会保留字符串）
- **续跑就绪** — 底栏 / `y` 显示完整命令（Qoder 会带 `cd …`）
- **对话预览** — Enter 打开**只读** transcript，最新在上；Esc 回中间列表
- **Vim 风格 TUI** — ↑↓ · gg/G · `/` 搜索 · Space 片选 · `dd` + `:wq` 删除
- **本地整理** — 重命名（`i`）、星标（`*`）、标签（`t`）— **绝不改写**各 Agent 原生存储
- **默认隐私** — 标题 / 星标 / 标签写在 gitignore 的 `data/*.csv`
- **自动刷新** — 空闲时每 8 秒重扫磁盘
- **可脚本化** — `--list` / `--json` 便于管道与自动化

---

## 快速开始

### 环境要求

- **Node.js ≥ 18**
- 建议真彩终端（VS Code、Windows Terminal、iTerm2 等）

### 安装并运行

```bash
git clone https://github.com/cool-ic/oh-my-sessions.git
cd oh-my-sessions
npm install
npm start
```

### 全局命令（可选）

```bash
npm run build
npm link          # 或: npm install -g .

oh-my-sessions    # 全名
oms               # 短别名
```

### 非交互模式

```bash
npm run list                 # 纯文本表
npm run list:json            # JSON 数组

# link / build 之后:
oh-my-sessions --list
oh-my-sessions --json
oh-my-sessions --source grok,claude
oh-my-sessions --help
```

---

## 支持的 Agent

| 来源 | 存储（只读） | 续跑命令 |
|------|--------------|----------|
| **Grok Build** | `$GROK_HOME/sessions/…` · `updates.jsonl` | `grok --resume <id>`（任意目录） |
| **Qoder** | Qoder 项目 / history jsonl | `cd <项目> && qodercli -r <id>` |
| **Claude Code** | `~/.claude/projects/<slug>/*.jsonl` | `claude --resume <id>`（任意目录） |
| Codex / Cursor | 类型中预留 | — |

路径健康与字段映射见 [`d/session-stores.md`](../d/session-stores.md)。

---

## 界面说明

宽屏（约 ≥ 120 列）：**标签栏 | 会话表 | 详情/聊天**。

| 区域 | 作用 |
|------|------|
| **左 · tags** | 按标签过滤（`all` = 全部）。`t` 给当前会话分配标签 |
| **中 · sessions** | 主列表 — 选择、片选、标记删除 |
| **右 · detail / chat** | 元信息（id、标签、resume 命令）或 Enter 后的 **Chat** |

### 状态徽章

| 徽章 | 含义 |
|------|------|
| **OK** | 有消息；续跑路径存在 |
| **Empty** | 0 条消息（草稿 / 废弃） |
| **Missing** | 续跑路径或存储路径已不存在 — 仍显示原文，带 `✗` |

---

## 快捷键速查

| 键 | 作用 |
|----|------|
| `↑` `↓` · `PgUp` `PgDn` · `Ctrl-f` `Ctrl-b` | 移动 / 翻页 |
| `gg` / `G` · `H` `M` `L` · `z` | 首 / 末 · 屏位 · 居中 |
| **`Enter`** | 打开 **聊天**（近→远，只读） |
| **`Esc`** | 关闭聊天 → 中间会话列表 · 或清空片选 |
| `Tab` | 标签栏 ↔ 会话表（聊天中：离开聊天 → 会话） |
| `t` | 为当前会话分配 / 新建标签 |
| `Space` | 切换片选 |
| `*` | 星标 / 取消 — 置顶；**未取消前禁止 `dd`** |
| `i` | 重命名标题（写入本地 CSV） |
| `/` | 搜索标题 / id / 路径 |
| `s` / `h` / `c` | 循环来源 · 健康 · 清除筛选 |
| `y` `yy` `r` | 底栏显示 **resume 命令**（自行复制；从不执行） |
| `dd` | 标记删除（片选或当前行；星标会话跳过） |
| `u` | 撤销最近一次删除标记 |
| `:empty` `:missing` `:bad` | 按健康状态批量片选 |
| `:wq` | **应用**删除并退出 |
| `:q` / `:q!` | 无待删时退出 · 丢弃标记强制退出 |
| `:help` | 完整快捷键浮层 |

裸 `q` 与 `Ctrl-C` **不会**退出（防止误丢待删标记）。

完整规格：[`d/ui-tui.md`](../d/ui-tui.md) · 应用内 `:help`。

---

## 本地设置（CSV）

偏好**仅存本地** — 不会回写 Grok / Qoder / Claude 的原生库。

| 功能 | 文件 | 说明 |
|------|------|------|
| 重命名（`i`） | `data/session-titles.csv` | `source,id,title,updated_at` |
| 星标（`*`） | `data/session-stars.csv` | 置顶 + 保护不被 `dd` |
| 标签（`t`） | `data/session-tags.csv` | 一会话一个标签 |

这些路径在 **.gitignore** 中。可自行私密备份，不会随仓库公开。

仅运行时内存（不落盘）：搜索筛选、片选、滚动、是否打开聊天。

---

## 工作原理

```
 磁盘会话存储（只读）
        │
        ▼
  discover/{grok,qoder,claude}
        │  SessionRecord[]
        ▼
  health · 标题 CSV · 星标 CSV · 标签 CSV
        │
        ├─► TUI（差分绘制，CJK 显示宽）
        └─► --list / --json
```

- 发现过程**不访问网络** — 只读本地文件系统。
- **删除**仅在 `:wq` 且经过明确 `dd` 标记后执行。
- **聊天**读 jsonl / updates；只显示 user + assistant（不含 tool / thought）。

架构图：[`d/codemap.md`](../d/codemap.md)。

---

## 截图复现

```bash
# 依赖: tmux, Python3, Pillow, 以及 scripts/fonts 中的 CJK 字体
./scripts/screenshot.sh main    # → docs/images/tui-main.png
./scripts/screenshot.sh chat    # → docs/images/tui-chat.png
```

---

## 配置

| 变量 | 作用 |
|------|------|
| `AGENT_SESSION_SOURCES` | 逗号分隔，如 `grok,claude`（默认 `grok,qoder,claude`） |
| `GROK_HOME` | Grok 数据根目录 |
| `CLAUDE_CONFIG_DIR` | Claude 配置目录覆盖 |

---

## 路线图

- [ ] Codex / Cursor 发现（布局稳定后）
- [ ] 可选：把 resume 命令写入系统剪贴板
- [ ] 导出所选会话元数据
- [ ] 主题预设

欢迎提 Issue / PR： [github.com/cool-ic/oh-my-sessions](https://github.com/cool-ic/oh-my-sessions)。

---

## 文档（贡献者 / Agent）

| 文档 | 用途 |
|------|------|
| [d/ui-tui.md](../d/ui-tui.md) | TUI 布局与快捷键 |
| [d/session-stores.md](../d/session-stores.md) | 落盘格式与 resume 语义 |
| [d/constraints.md](../d/constraints.md) | 硬边界 |
| [d/codemap.md](../d/codemap.md) | 模块地图 |
| [workflow.md](../workflow.md) | 过程说明 |

---

## 许可证

[MIT](../LICENSE) © cool-ic

---

<div align="center">

**别再翻 `~/.agent` 目录了。直接 `npm start`。**

</div>
