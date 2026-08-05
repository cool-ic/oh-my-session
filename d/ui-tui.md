# ui-tui.md · 交互界面规格

> 实现：`src/tui/rawApp.ts` + `src/tui/theme.ts`。  
> 改 TUI 布局/列宽/术语前必读；改完后跑 Phase D 门禁。

---

## 1. 产品问题（用户心智）

界面必须直接回答：

1. **有哪些会话**（来源、多久前、是否值得续）  
2. **要去哪里续跑**（续跑目录原文；没了也要显示）  
3. **复制什么命令**（按来源区分路径是否硬绑定）

---

## 2. 架构红线

- **差分绘制**：滚动时最多重画 2 行列表 + 详情区；禁止 Ink 式整帧 `eraseLines`。  
- **CJK 对齐**：列宽一律用 `lib/width.ts` 的显示列（中文=2），禁止按 `string.length` 补空格。  
- **备用屏**：`?1049h` 进入 / 退出还原。  
- **只读**：`yy` 只复制 resume command，不 spawn 交互 resume（除非 Phase E 明确改）。

---

## 3. 布局

### 3.1 宽屏（`cols >= 100`）— 左右分栏

**默认不显示**统计/筛选墙文（用户要求去掉无区分度的大段字）。  
仅当 `/` 搜索或 `yy` 复制命令后，才出现 **1 行**瞬时 chrome。

```
脑门  oh-my-session  · 快捷键  ·  1/84
════════════════════════════════╤════════════════  ← 脑门/表格（双线）
  状态 来源 多久 条数 标题 目录 │ 详情
────────────────────────────────┼────────────────  ← 表头/数据
  行…（选中暖色底）             │ 要去这里续跑
  …                             │ 复制运行
────────────────────────────────┴────────────────  ← 表格/底栏
  底栏状态（搜索/dd/y 时）
```

分割线：`═` 脑门下；`─` 表头下、底栏上；竖线 `│` + 接头 `╤┼┴` 做左右分栏。

几何约束（显示列）：

```
listW + 1(gutter) + detailW = cols
detailW ∈ [36, 44] 优先约 0.34*cols
listW >= LC_FIXED + 16
gutter 列画 │；表头行接缝用 ┬
```

### 3.2 窄屏 — 上下叠放

列表在上 → 详情卡片在下（同一套列表列规则）。

---

## 4. 列表表格列（固定）

信息尽量进表格，详情补命令与说明。

| 列 | 显示宽 | 间距下限（后） | 内容 |
|----|--------|----------------|------|
| mark | 2 | — | 光标 `▌`；选中 / 可视片选 `#`（不用 `*`，避免与置顶混淆） |
| star | 3 | 1 | 置顶 `*` / 未置顶 `·`（不用 ★/☆，避免等宽字体缺字成方框） |
| 状态 | 8 | **2** | 色块：OK / Empty / Missing |
| 来源 | 6 | **2** | `Grok` / `Qoder` / … |
| 多久 | 5 | **2** | 右对齐：`2s` `30m` `5d` `1mo` |
| 条数 | 5 | **2**（MSGS→TITLE，勿再缩成 1） | 右对齐 messageCount |
| 标题 | flex ~38%，cap 36/40，min 12 | **2** | 会话标题 |
| 续跑目录 | flex 剩余，min 12 | — | `cwd` 原文；失效前缀 `✗` |

固定列间距一律 ≥2（star→STATUS 例外为 1）。`LC_FIXED` + title/path 下限见 `rawApp.ts` `LC` / `FLEX_MIN`。

**排序：** `lastActive` 降序。  

**脑门（row 1）视觉层次（高 → 低）：**

1. **Name mark** — `▌` + 填充 pill（`brandNameBg/Fg`）  
2. **Section tags** — 更暗 chip（`brandTagBg/Fg`）：` move ` ` row ` ` bulk ` …  
3. **Keys** — 亮琥珀（`brandKey`）  
4. **Hints** — 最淡（`brandHint`）：`select` `rename` …  
5. 组间宽松 `  ·  `（`brandSep`），不用厚重 `│`  

```
▌oh-my-session  ·  [ move ] ↑↓  ·  [ row ] Space select · i rename · dd delete  ·  …     [1/N] [sel] [del]
```

- **`yy` = copy resume command to clipboard**；**`/` = search filter**  
- 右侧计数 pill（`1/N` · 可选 `sel` / `del`）；**不**再显示 `↻8s`  
- 窄终端自动降级  

**自动刷新：** 后台每 8s `reload()` 重扫盘（界面不展示）；rename / `:` / `/` 输入中跳过；按 `source:id` 保光标与片选。

---

## 5. 详情面板（只补表格没有的）

**原则：与表格零重复；不向用户讲课。** 表格已有 STATUS / SOURCE / AGE / MSGS / TITLE / RESUME DIR。

| 区块 | 文案 |
|------|------|
| **ID** | 完整 session id |
| **Resume command (yy copy)** | `resumeInfo().command`（可折行；`yy` = copy resume command to clipboard） |

**禁止**详情里写 Note / 路径语义说教（如 “must cd here first”）——命令本身已含 `cd`（Qoder / Claude）或仅需 ID（Grok）。  
也不展示 Store / Created / Branch 等噪声字段。

框线：`┌─ 详情 ─┐` / `│` / `└─┘`。Rename（`i`）只在表格 TITLE 列。

---

## 6. 术语（与代码 health 映射）

| UI | `health` | 条件 |
|----|----------|------|
| 可续跑 | `ok` | 有消息且续跑目录存在（store 也在） |
| 空会话 | `empty` | `messageCount <= 0`（且非 missing） |
| 目录没了 | `missing` | 续跑目录或会话存储路径本机不存在；**优先于 empty** |

「续跑目录」≠ 本工具进程 cwd；见 `d/session-stores.md`。

---

## 7. Resume 命令展示

由 `lib/format.ts` → `resumeInfo()`：

| source | command | pathMode |
|--------|---------|----------|
| qoder | `cd <dir> && qodercli -r <id>` | **required** |
| grok | `grok --resume <id>` | recommended（ID 全局；标题/-c 认当前目录） |
| claude | `cd <dir> && claude --resume <id>` | **required** |

---

## 8. 快捷键（vim 风格）

| 键 | 作用 |
|----|------|
| `↑↓` | 下 / 上（焦点在列表 / 标签栏 / 聊天详情时各自滚动） |
| **`Enter`** | **打开对话**：右侧栏显示该会话 transcript，**近→远**（最新在上）；焦点切到 detail |
| `gg` / `G` | 列表首 / 末 |
| **`Space`** | **选中**：切换当前行 multi-select（行首 `#`；脑门 `sel:N`） |
| **`v`** | **可视选择**（vim）：从当前行开始，↑↓ 扩展范围；再 `v` 结束（保留选中）；`Esc` 先结束可视再清空 |
| **`*`** | **置顶 / 取消**：CSV 持久化；行上 `*` 标记；**禁止 `dd`**，须先取消置顶 |
| **`i`** | **Rename**：TITLE 内联编辑；**Esc** / **Enter** 写 CSV |
| `dd` | **标记删除**（片选批量 / 当前行）；**跳过已星标**并提示 |
| `u` | 撤销最近一次删除标记（恢复列表；多次 `dd` 可逐条 undo） |
| `yy` | **copy resume command** 到系统剪贴板；macOS 用 `pbcopy`；失败时底栏显示命令；不执行 |
| `/` | **vim 搜索**：底栏 `/pattern`；实时过滤；**Enter** 确认；**Esc** 取消并恢复；**BS 在空 pattern 上退出**（`/` 本身不可“删除”，它是提示符不是缓冲字符） |
| `Tab` | 焦点：detail → sessions → tags → sessions |
| Esc | **关闭聊天**（若已打开）→ 清空片选 → 否则提示 `:q` / `:wq` |
| `:` … Enter | **Ex 命令行**（见下表） |
| bare `q` / Ctrl-C | **不退出**（提示用 `:q` / `:wq`） |

### 8.0 聊天详情（右栏 Chat · 只读）

- **只看对话**：user / assistant 文本；不展示 tool / thought。
- 数据：`lib/transcript.ts`（Grok `updates.jsonl`；Qoder/Claude jsonl）。
- 顺序：**newest first**（近→远）。
- **Enter**：右栏显示对话；↑↓ 滚动。
- **Esc**：**关闭聊天并回到中间 session 列表焦点**（不是 tags）。
- 列表光标换到其他会话时自动退出 Chat → Detail meta。

### 8.1 Ex 命令（`:` 后输入，Enter 执行；Esc 取消）

| 命令 | 别名 | 作用 |
|------|------|------|
| `:empty` | `:emp` · `:sel empty` · `:sel e` | 片选全部 **Empty** |
| `:missing` | `:mis` · `:sel missing` · `:sel m` | 片选全部 **Missing** |
| `:bad` | `:broken` · `:unhealthy` · `:sel bad` · `:sel !` | 片选全部非 ok |
| `:sel none` | `:sel clear` · `:selc` | 清空片选 |
| `:q` | `:quit` | **无待删标记时退出**（无修改即可走） |
| `:q!` | — | 丢弃全部 `dd` 标记后强制退出（不删盘） |
| `:wq` | `:x` | 应用全部 `dd` 删除并退出 |
| `:retention` | `:ret` | 打开保留期浮层：展示 Agent 自动删会话的配置，`y` 确认后改写 |
| `:lang` | `:language` · `:locale` | 切换界面语言；也可 `:lang en` / `:lang zh` |
| `:feedback` | `:fb` · `:github` · `:issues` | 用系统浏览器打开本仓库 GitHub（反馈 / Issue） |
| `:help` | `:h` · `:?` | 快捷键帮助浮层 |

**语言（首次启动）：** 若 `~/.config/oms/ui-locale` 不存在 → **阻塞弹窗**选 `1` English / `2` 简体中文（禁 Esc）；写入该文件（`en`|`zh`）后继续（再视情况出 retention 弹窗）。之后可用 `:lang` 重开。

**片选语义：** `Space` 只切换勾选，不删。勾选集合跨筛选保留（按 `source:id`）；`dd` 对勾选集合批量标记删除后清空勾选。

**批量片选（:empty / :missing / :bad）：** 在当前搜索范围内匹配；与已有片选**并集**；已 `dd` 待删项不参与。

注意：列表展示的 `health` 互斥（missing 优先于 empty），但批量片选按**独立属性**：
- `:empty` → `messageCount<=0` / `isEmpty`（**含**既空又 missing 的会话）
- `:missing` → 路径失效（**含** dual）
- `:bad` → 空或失效

**删除语义：** `dd` 只标记；`:wq` 调用 `lib/delete-session.ts` 删 Grok 会话目录 / Qoder jsonl+meta+dir 等。详见 constraints。

**Rename 语义（`i`）：** 立即写入 `~/.config/oms/` 下 CSV，不经过 `:wq`，**不**改 Agent 原生存储。

**Retention 语义（TUI 弹窗 / `:retention`）：** 启动时若有 atRisk 且未 ignore 的 agent → **阻塞弹窗**（`y` 改配 · `i` 知情不改并写入 `~/.config/oms/retention-prefs.csv`，此后该 agent 不再弹，footer 提示可 `:retention` 反悔）。`:retention` 可随时打开（决策 / 状态 / `u` unignore）。改配成功另有结果弹窗。详见 constraints §1.3。

用户数据目录默认 **`~/.config/oms/`**（`$OMS_DATA_DIR` 或 `$XDG_CONFIG_HOME/oms` 可覆盖）：

| 文件 | 格式 / 说明 |
|------|-------------|
| `session-titles.csv` | `source,id,title,updated_at`（RFC4180） |
| `session-stars.csv` | 置顶 |
| `session-tags.csv` | 标签 |
| `retention-prefs.csv` | 保留期 ignore 偏好 |
| `ui-locale` | 单行 `en` 或 `zh` |
| `update-check.json` | npm 更新检查缓存 |

discover 后 `applyTitleOverrides()` 用 CSV 覆盖展示标题。

编辑中：TITLE 列内联；**Esc** / **Enter** 保留并写 CSV；空标题退出不改。

---

## 9. 主题

`theme.ts`：暖色低饱和；状态用 `pill.*` 背景色块。  
改色只动 theme，不硬编码到多处（尽量）。

---

## 10. 截图 / 验收

- 人工：`npm start`，宽终端看分栏对齐。  
- 可选：`scripts/ansi_to_png.py` + tmux capture（系统无 CJK 字体时汉字会糊）。  
