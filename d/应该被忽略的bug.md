# 应该被忽略的bug.md

> 排查「异常」前先看本文件，避免反复重开已知非问题。

---

## 数据 / 语义

- **Qoder 同 id 多 project slug 目录：** 路径迁移或副本；工具侧按 id 去重即可，非损坏。  
- **Grok `num_messages` ≠ `num_chat_messages`：** 定义不同（updates vs chat）；主显示前者。  
- **Qoder `message_count` 与 jsonl user+assistant 略差：** 以 session.json 为准。  
- **大量「条数=2」仍标可续跑：** empty 仅 `messageCount===0`；短交互/元消息不是 empty。若嫌吵可做「极少消息」筛选（Phase E），非数据 bug。  
- **未记录续跑目录：** 显示「未记录」；不是「目录没了」（missing 要求有路径字符串且磁盘不存在）。  
- **slug 反推路径不可靠：** `-home-f-project-software` 不能当 cwd；必须以 jsonl/meta 为准。  

## Resume

- **Grok 用 ID 可在任意 shell 目录打开：** 设计如此，不是漏了 `cd`。  
- **Grok 按标题 / 无参 resume 只看当前目录：** 官方行为；本工具 list 是全集，resume 命令用 ID。  
- **Qoder 换目录 resume 失败：** 预期硬绑定，不是本工具解析错。  

## UI / 终端

- **截图 PNG 中文方框：** 无 CJK 字体环境；真实终端正常。  
- **极窄终端（&lt;100 列）无左右分栏：** 设计为上下叠放，非回归。  
- **色块在非 truecolor 终端发灰：** 依赖 24-bit 色；可后续加 256 色回退（未做不算 regression）。  
