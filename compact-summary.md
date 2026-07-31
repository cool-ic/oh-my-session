# Compact Summary

## 状态：MVP 可用 · 文档本轮已充实

### 已完成

- **发现：** Grok + Qoder（+ Claude 尽力）；跨目录全集；`enrichSessions` → health  
- **续跑目录：** Qoder 从 `working_dir` / jsonl.`cwd` 提取；删了仍保留原文  
- **Resume 语义：** Qoder `cd && qodercli -r`（硬）；Grok `grok --resume <id>`（ID 全局）  
- **TUI：** `rawApp.ts` 差分绘制；宽屏左右分栏；列表固定列（状态/来源/多久/标题）；详情「要去这里续跑 / 复制运行」  
- **术语：** 可续跑 / 空会话 / 目录没了  
- **门禁：** `npm run build` + list/json  
- **文档（本轮）：** workflow / 总纲领§7 / constraints / session-stores / ui-tui(新) / codemap / compact / README / bug 列表  

### 删除 / 退出（已实现）

- `dd` 标记删除 → `:wq` 真正删盘并退出  
- 仅 `:wq` 可退出；`u` 撤销标记  

### 进行中 / 下一步（Phase E）

1. 可选：一键 spawn resume  
2. Codex / Cursor discover  
3. FTS；极少消息筛选  

### 入口

```bash
cd /home/f/agent_session_history && npm start
```

### 关键路径

| 用途 | 路径 |
|------|------|
| 过程 | `workflow.md` |
| 存储/resume | `d/session-stores.md` |
| 界面规格 | `d/ui-tui.md` |
| 代码图 | `d/codemap.md` |
| TUI 实现 | `src/tui/rawApp.ts` |
| Resume 文案 | `src/lib/format.ts` → `resumeInfo` |
