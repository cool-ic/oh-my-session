# 尚存bug.md

## 已关闭

### BUG-001 Ink 全帧重绘导致滚动闪屏 — **已关闭**

- **现象：** 上下移动列表时整屏闪烁。  
- **根因：** Ink `log-update` 每次 `eraseLines(all)+rewrite`；帧高 ≥ `rows` 时 `clearTerminal`。  
- **处理：** 弃用 Ink；`rawApp.ts` 差分绘制。  
- **门禁：** workflow §2.6；Phase D。  
- **关闭：** 2026-07-27  

### BUG-002 Qoder 大量会话无续跑目录（显示「—」） — **已关闭**

- **现象：** ~63 条 Qoder 无 cwd。  
- **根因：** 只读 `*-session.json` 的 `working_dir`；多数仅有 jsonl。  
- **处理：** `extractCwdFromJsonl`；meta 缺失时补 jsonl.`cwd`。  
- **关闭：** 2026-07-27  

### BUG-003 列表/分栏列对不齐 — **已关闭（持续规范）**

- **现象：** 中文与色块导致列漂移、分栏错位。  
- **根因：** 按码点长度补空格；ANSI 计入 clip 宽度；分栏几何不固定。  
- **处理：** `lib/width` 显示列；列表 `LC_*` 固定宽；`listW+1+detailW=cols`；`padAnsi`/`clipAnsi`。  
- **规范：** `d/ui-tui.md` + workflow 对齐红线。  
- **关闭：** 2026-07-27（若再漂，按 ui-tui 验收重开）  

## 打开中

（暂无。发现新问题在此追加，含复现与优先级。）
