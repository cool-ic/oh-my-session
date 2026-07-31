# workflow.md · 过程权威

> 本文件是 `agent_session_history` 的**过程唯一权威**。  
> 与总纲领冲突时，以本文「怎么做」为准；「能不能做」以 `d/constraints.md` 为准。

---

## 0. 会话启动序列（强制）

1. 读 `总纲领.md` §7（目标 / 成功标准 / 索引）  
2. 读本文件全文  
3. 读 `d/constraints.md`  
4. **按需切片**（禁止无差别通读全部 d）：  
   - 改发现 / resume → `d/session-stores.md`  
   - 改 TUI → `d/ui-tui.md` + `d/codemap.md`  
   - 修缺陷 → `d/尚存bug.md`、`d/应该被忽略的bug.md`  
5. 任务未完成且 `compact-summary.md` 有效 → 先恢复进度  

**禁止**跳过约束改用户会话存储。

---

## 1. 工作阶段

### Phase A — 研究（存储与 resume）

- 只读探查：`~/.grok/sessions`、`~/.qoder/projects`、Claude/Codex/Cursor（若存在）  
- 结论写入 `d/session-stores.md`  
- 不执行 delete-session 等破坏性 CLI  

### Phase B — 发现层

- `src/discover/*` → 统一 `SessionRecord`  
- 消息计数：元数据优先，否则 jsonl 轻量计 `user`+`assistant`  
- **续跑目录**：Qoder 必须 `working_dir` 或 jsonl.`cwd`；删了也保留原文  
- `enrichSessions` 写 `health`：`ok` | `empty` | `missing`  

### Phase C — TUI / CLI

- **日常入口：** `npm start`（`tsx src/index.ts`）  
- **实现：** `src/tui/rawApp.ts` 差分绘制（**禁止 Ink 全帧 erase**）  
- **规格：** `d/ui-tui.md`（分栏、列宽、快捷键、术语）  
- 宽屏 ≥100 列：左列表 | 右详情；窄屏上下叠放  
- 列表列：`状态色块 | 来源 | 多久 | 标题`（路径与命令在详情）  
- 默认 `lastActive` 降序  
- 非交互：`--list` / `--json`  

**术语（UI 必须一致）：**

| UI | health | 含义 |
|----|--------|------|
| 可续跑 | ok | 有对话且续跑目录仍在 |
| 空会话 | empty | 0 条消息 |
| 目录没了 | missing | 续跑目录或存储路径本机不存在（原文仍显示） |
| 续跑目录 | cwd | resume 应去的项目路径，≠ 本工具 cwd |

**Resume 展示：**

| 来源 | 命令形态 | 绑定 |
|------|----------|------|
| Qoder | `cd <dir> && qodercli -r <id>` | 硬：换目录常失败 |
| Grok | `grok --resume <id>` | ID 全局；标题/-c 认当前目录 |

### Phase D — 验证门禁

改发现逻辑或 TUI 后**必须**：

```bash
npm run build
npm run list
npm run list:json   # 或 node dist/index.js --json | 检查字段
```

检查项：

- [ ] 能列出本机 Grok 会话  
- [ ] 有 Qoder 数据时能列出，且 `messageCount >= 0`  
- [ ] 每条有 `source`、`lastActive`（尽量非 null）、`messageCount`、`health`  
- [ ] Qoder 续跑目录尽量非空（jsonl 提取）；缺失路径不得装作「正常目录」  
- [ ] 不写用户 `~/.grok` / `~/.qoder` 会话文件  
- [ ] TUI 仍为差分架构（见 `d/尚存bug.md` BUG-001）  
- [ ] 宽终端下列表列对齐（CJK 显示宽）  

### Phase E — 后续（非强制）

- 一键 spawn resume（需确认占用终端与路径 `cd`）  
- Codex / Cursor 完整 discover  
- 只读 FTS（`session_search.sqlite`）  
- 极少消息筛选（条数=2 的噪声会话）  

### 已实现：标记删除 + :wq

- `dd`：标记删除（无确认，列表移除）  
- `u`：撤销标记  
- **仅** `:wq` 退出并调用 `lib/delete-session.ts` 真正删盘  
- `q` / Esc / Ctrl-C 不退出  
- 约束见 `d/constraints.md`  


---

## 2. 执行约束

1. 只读用户会话存储（constraints）。  
2. 发现路径与字段语义**亲历亲为**；禁止子 Agent 在 `$HOME` 批量写文件。  
3. 子 Agent 仅可头脑风暴文案 / 只读探文档。  
4. 改发现或 TUI → Phase D。  
5. 新 source：先改 `session-stores.md`，再代码，再挂本 workflow。  
6. **TUI 红线：** 差分更新；不得引入每键全屏擦写方案（除非书面否决本条并改门禁）。  
7. **对齐红线：** 列表/分栏用 `lib/width` 显示列，禁止 `string.length` 当列宽。  

---

## 3. 状态同步时机

| 文档 | 何时读 | 何时更新 |
|------|--------|----------|
| `d/constraints.md` | 实质工作前 | 边界/权限/env 变化 |
| `d/session-stores.md` | 改发现 / resume 前 | 布局或提取规则变化 |
| `d/ui-tui.md` | 改 TUI 前 | 布局/列/键/术语变化 |
| `d/codemap.md` | 改结构前 | 目录或模块职责变化 |
| `d/尚存bug.md` | 修 bug 前 | 开/关缺陷 |
| `d/应该被忽略的bug.md` | 排查异常前 | 确认误报/不修 |
| `compact-summary.md` | 续跑时 | 中断、交接、阶段完成 |
| 本 `workflow.md` | 每轮开始 | 新义务、新 d 挂靠 |
| `总纲领.md` §7 | 目标变化时 | 成功标准/索引变化 |
| `README.md` | — | 人读用法与界面变化时 |

---

## 4. 每一轮工作后的元进化检查（强制）

- **a.** workflow 是否要改？新 d 是否已登记 §3 与总纲领索引？  
- **b.** 边界是否变 → constraints  
- **c.** 是否新 d？新建必须挂靠  
- **d.** codemap / session-stores / ui-tui 是否过时  
- **e.** compact-summary 是否反映最新进度  

---

## 5. Compact Summary 约定

- 路径：项目根 `compact-summary.md`  
- 要求：短、可扫完；**已完成 / 进行中 / 下一步 / 关键路径**  
