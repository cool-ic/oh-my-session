/**
 * UI strings for en / zh. Prefer t("key") over hard-coded chrome text.
 */
import type { Locale } from "./locale-store.js";

export type { Locale };

type Dict = Record<string, string>;

const en: Dict = {
  // columns
  "col.status": "status",
  "col.source": "source",
  "col.age": "age",
  "col.msgs": "msgs",
  "col.title": "title",
  "col.resume": "resume dir",
  "col.tags": " tags ",
  "col.assign": " assign ",
  "col.detail": " Detail ",
  "col.chat": " Chat ",

  // health chips (fit LC.status = 8 display cols)
  "health.ok": "OK",
  "health.empty": "Empty",
  "health.missing": "Missing",

  // brand tags
  "brand.move": " move ",
  "brand.row": " row ",
  "brand.bulk": " bulk select ",
  "brand.copy": " copy ",
  "brand.search": " search ",
  "brand.quit": " quit ",
  "brand.mv": "mv",
  "brand.row.short": "row",
  "brand.bulk.short": "bulk",
  "hint.tags": " tags",
  "hint.setTag": " assign tag",
  "hint.select": " select",
  "hint.star": " pin",
  "hint.visual": " visual",
  "hint.rename": " rename",
  "hint.delete": " delete",
  "hint.resumeCmd": " resume command",
  "hint.filter": " filter",
  "status.visualOn": "VISUAL · ↑↓ extend · v end · Esc clear · dd mark",
  "status.visualOff": "visual ended · {n} selected",
  "status.multiHint":
    "{n} selected · Space toggle · v visual · dd mark all",

  // language popup
  "lang.title": "Language / 语言",
  "lang.intro": "Choose UI language. You can change later with :lang",
  "lang.en": "English",
  "lang.zh": "简体中文",
  "lang.hint": "  1 English  ·  2 简体中文",
  "lang.footer": "  1 / e  English  ·  2 / c  简体中文  ·  Esc disabled until chosen",
  "lang.footer.change": "  1 / e  English  ·  2 / c  简体中文  ·  Esc cancel",
  "lang.saved.en": "language: English  ·  change anytime: :lang",
  "lang.saved.zh": "语言: 简体中文  ·  随时可用 :lang 切换",
  "lang.cancelled": "language unchanged",

  // footer modes
  "footer.help": " ↑↓ scroll  ·  Esc / q / Enter close",
  "footer.tag": " ↑↓ pick  ·  type in +new  ·  Enter assign  ·  Esc cancel",
  "footer.title": " Esc leave (keep)  ·  Enter save  ·  Ctrl-U clear",
  "footer.search": "  Enter apply · Esc abort · BS empty→exit · Ctrl-U clear",
  "footer.default":
    " Enter chat  ·  Tab focus  ·  t tag  ·  * pin  ·  Space select  ·  :wq",
  "footer.retention.block": "  y fix config  ·  i acknowledge (no more popup)",
  "footer.retention.decide": "  y fix  ·  i ignore  ·  Esc cancel",
  "footer.retention.done": "  Enter / Esc  ·  continue",
  "footer.retention.review":
    "  y fix open  ·  i ignore open  ·  u unignore  ·  Esc close",

  // tags rail
  "tag.all": "all",
  "tag.new": "+ new…",
  "tag.clear": "(clear)",

  // detail meta
  "detail.id": "ID",
  "detail.tag": "Tag",
  "detail.resume": "Resume command (yy copy)",
  "detail.enterChat": "Enter · message list (preview)",
  "detail.noTag": "(none)",

  // chat
  "chat.messages": "Messages",
  "chat.enterFull": "Enter full",
  "chat.agent": "Agent",
  "chat.you": "You",
  "chat.empty": "  No messages",
  "chat.footer":
    " msg list · ↑↓ · Enter full · Esc sessions",

  // status / ex
  "status.emptyCmd": "empty command · :help",
  "status.unknownCmd": "unknown :{cmd}  ·  :help",
  "status.feedbackOk": "opened GitHub in browser  ·  {url}",
  "status.feedbackFail": "could not open browser  ·  {url}",
  "status.langOpened": "choose language  ·  1 English · 2 简体中文",
  "status.quitDiscard": "quit (discarded pending deletes)",
  "status.pendingDel":
    "{n} pending delete(s) · :wq apply · :q! discard",
  "status.quitting": "quitting…",
  "status.nothingSelected": "nothing selected",
  "status.selHelp": ":sel empty|missing|bad|none",
  "status.copied": "copied resume command via {tool}",
  "status.clipboardFail": "clipboard unavailable; resume command: {cmd}",
  "status.selectionCleared": "selection cleared",
  "status.nothingUndo": "nothing to undo",
  "status.noDeletes": "no deletes; quitting…",
  "status.updateAvailable":
    "update {current} → {latest}  ·  {cmd}  ·  oms upgrade",

  // help
  "help.title": "Keyboard shortcuts",
  "help.esc": "Esc / q / Enter  close",
  "help.g.move": "Move",
  "help.g.tags": "Tags (left rail)",
  "help.g.row": "Session row",
  "help.g.chat": "Chat (right pane)",
  "help.g.search": "Search",
  "help.g.bulk": "Bulk select (:)",
  "help.g.quit": "Quit & more (:)",
  "help.g.notes": "Notes",

  // retention
  "ret.title.decision": "⚠  Session auto-deletion risk",
  "ret.title.done": "✓  Retention updated",
  "ret.title.review": "Session retention — status",
  "ret.intro":
    "These agents can delete local session history on their own schedule.",
  "ret.suggested": "Suggested config:",
  "ret.file": "File:",
  "ret.choose": "Choose for the agents listed above:",
  "ret.y": "  y   Fix config now",
  "ret.y.hint": "      Write the suggested keys (other keys kept; .bak first).",
  "ret.i": "  i   I understand — leave their settings alone",
  "ret.i.hint1": "      Never ask again for these agents (user preference).",
  "ret.i.hint2": "      You can change your mind anytime with :retention",
  "ret.block":
    "Please choose y or i  ·  Esc disabled  ·  cannot quit until you decide",
  "ret.noblock": "y fix  ·  i ignore  ·  Esc cancel",
  "ret.acked":
    "{names}: auto-delete risk acknowledged  ·  change mind: :retention",
  "ret.badge": " RETENTION ",
  "help.badge": " HELP ",
  "lang.badge": " LANG ",
  "tag.badge": " TAG ",
  "title.badge": " TITLE ",
};

const zh: Dict = {
  "col.status": "状态",
  "col.source": "来源",
  "col.age": "多久",
  "col.msgs": "条数",
  "col.title": "标题",
  "col.resume": "续跑目录",
  "col.tags": " 标签 ",
  "col.assign": " 分配 ",
  "col.detail": " 详情 ",
  "col.chat": " 聊天 ",

  "health.ok": "正常",
  "health.empty": "空会话",
  "health.missing": "目录没了",

  "brand.move": " 移动 ",
  "brand.row": " 行 ",
  "brand.bulk": " 批量选择 ",
  "brand.copy": " 复制 ",
  "brand.search": " 搜索 ",
  "brand.quit": " 退出 ",
  "brand.mv": "移",
  "brand.row.short": "行",
  "brand.bulk.short": "批选",
  "hint.tags": " 标签",
  "hint.setTag": " 分配标签",
  "hint.select": " 选中",
  "hint.star": " 置顶",
  "hint.visual": " 可视",
  "hint.rename": " 改名",
  "hint.delete": " 删除",
  "hint.resumeCmd": " 续跑命令",
  "hint.filter": " 过滤",
  "status.visualOn": "可视选择 · ↑↓ 扩展 · v 结束 · Esc 清空 · dd 标记删除",
  "status.visualOff": "已结束可视 · 已选 {n} 条",
  "status.multiHint":
    "已选 {n} 条 · Space 切换 · v 可视 · dd 批量标记",

  "lang.title": "Language / 语言",
  "lang.intro": "请选择界面语言。之后可用 :lang 随时切换",
  "lang.en": "English",
  "lang.zh": "简体中文",
  "lang.hint": "  1 English  ·  2 简体中文",
  "lang.footer": "  1 / e  English  ·  2 / c  简体中文  ·  首次启动须选择（禁用 Esc）",
  "lang.footer.change": "  1 / e  English  ·  2 / c  简体中文  ·  Esc 取消",
  "lang.saved.en": "language: English  ·  change anytime: :lang",
  "lang.saved.zh": "语言: 简体中文  ·  随时可用 :lang 切换",
  "lang.cancelled": "语言未更改",

  "footer.help": " ↑↓ 滚动  ·  Esc / q / Enter 关闭",
  "footer.tag": " ↑↓ 选择  ·  在 +new 输入  ·  Enter 确认  ·  Esc 取消",
  "footer.title": " Esc 离开（保留）  ·  Enter 保存  ·  Ctrl-U 清空",
  "footer.search": "  Enter 确认 · Esc 取消 · 空时 BS 退出 · Ctrl-U 清空",
  "footer.default":
    " Enter 聊天  ·  Tab 焦点  ·  t 分配标签  ·  * 置顶  ·  Space 选中  ·  :wq",
  "footer.retention.block": "  y 改配置  ·  i 知情不改（不再弹窗）",
  "footer.retention.decide": "  y 改配置  ·  i 忽略  ·  Esc 取消",
  "footer.retention.done": "  Enter / Esc  ·  继续",
  "footer.retention.review":
    "  y 处理风险  ·  i 忽略风险  ·  u 取消忽略  ·  Esc 关闭",

  "tag.all": "全部",
  "tag.new": "+ 新建…",
  "tag.clear": "(清除)",

  "detail.id": "ID",
  "detail.tag": "标签",
  "detail.resume": "续跑命令（yy 复制）",
  "detail.enterChat": "Enter · 消息列表（预览）",
  "detail.noTag": "(无)",

  "chat.messages": "消息",
  "chat.enterFull": "Enter 全文",
  "chat.agent": "助手",
  "chat.you": "你",
  "chat.empty": "  暂无消息",
  "chat.footer": " 消息列表 · ↑↓ · Enter 全文 · Esc 回列表",

  "status.emptyCmd": "空命令 · :help",
  "status.unknownCmd": "未知 :{cmd}  ·  :help",
  "status.feedbackOk": "已在浏览器打开 GitHub  ·  {url}",
  "status.feedbackFail": "无法打开浏览器  ·  {url}",
  "status.langOpened": "选择语言  ·  1 English · 2 简体中文",
  "status.quitDiscard": "已退出（丢弃待删标记）",
  "status.pendingDel":
    "{n} 条待删除 · :wq 执行 · :q! 丢弃",
  "status.quitting": "退出中…",
  "status.nothingSelected": "未片选",
  "status.selHelp": ":sel empty|missing|bad|none",
  "status.copied": "已复制续跑命令（{tool}）",
  "status.clipboardFail": "剪贴板不可用；续跑命令: {cmd}",
  "status.selectionCleared": "已清空片选",
  "status.nothingUndo": "无可撤销",
  "status.noDeletes": "无删除；退出中…",
  "status.updateAvailable":
    "有新版本 {current} → {latest}  ·  {cmd}  ·  oms upgrade",

  "help.title": "快捷键",
  "help.esc": "Esc / q / Enter  关闭",
  "help.g.move": "移动",
  "help.g.tags": "标签（左侧）",
  "help.g.row": "会话行",
  "help.g.chat": "聊天（右栏）",
  "help.g.search": "搜索",
  "help.g.bulk": "批量片选 (:)",
  "help.g.quit": "退出与其它 (:)",
  "help.g.notes": "说明",

  "ret.title.decision": "⚠  会话可能被自动删除",
  "ret.title.done": "✓  保留期配置已更新",
  "ret.title.review": "会话保留期 — 状态",
  "ret.intro": "以下 Agent 会按自己的时间表删除本机会话历史。",
  "ret.suggested": "建议配置：",
  "ret.file": "文件：",
  "ret.choose": "请对上面列出的 Agent 做出选择：",
  "ret.y": "  y   现在改配置",
  "ret.y.hint": "      写入建议键值（其余键保留；先写 .bak）。",
  "ret.i": "  i   我知道了 — 不改它们的配置",
  "ret.i.hint1": "      这些 Agent 不再弹窗（用户偏好）。",
  "ret.i.hint2": "      随时可用 :retention 反悔",
  "ret.block": "请选择 y 或 i  ·  禁用 Esc  ·  决定前无法退出",
  "ret.noblock": "y 改配置  ·  i 忽略  ·  Esc 取消",
  "ret.acked":
    "{names}: 已知情自动删除风险  ·  反悔请 :retention",
  "ret.badge": " 保留期 ",
  "help.badge": " 帮助 ",
  "lang.badge": " 语言 ",
  "tag.badge": " 标签 ",
  "title.badge": " 标题 ",
};

let current: Locale = "en";

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale === "zh" ? "zh" : "en";
}

export function t(
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = current === "zh" ? zh : en;
  let s = table[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Help groups for :help (locale-aware). */
export function helpGroups(): ReadonlyArray<{
  title: string;
  keys: [string, string][];
}> {
  if (current === "zh") {
    return [
      {
        title: t("help.g.move"),
        keys: [
          ["↑ / ↓", "在焦点区域内移动"],
          ["gg / G", "会话列表顶 / 底"],
          ["Tab", "标签栏 ↔ 会话列表"],
        ],
      },
      {
        title: t("help.g.tags"),
        keys: [
          ["Tab", "进入 / 离开标签栏"],
          ["↑↓（标签）", "选择标签过滤（全部 = 不过滤）"],
          ["Enter（标签）", "保持过滤 · 回到会话"],
          ["t", "为当前会话分配标签"],
          ["  · ↑↓", "选已有标签或 (清除)"],
          ["  · +new 输入", "新建标签（a-z 0-9 _ -）"],
          ["  · Enter / Esc", "确认 / 取消"],
        ],
      },
      {
        title: t("help.g.row"),
        keys: [
          ["Enter", "右侧打开聊天（近→远）"],
          ["Space", "选中 / 取消当前行（行首 #）"],
          ["v", "可视选择（↑↓ 扩展范围，再按 v 结束；行首 #）"],
          ["*", "置顶 / 取消（* 列）— 阻止 dd"],
          ["i", "内联改标题（写入本地 CSV）"],
          ["dd", "标记删除（置顶跳过；:wq 执行）"],
          ["u", "撤销最近删除标记"],
          ["yy", "复制续跑命令到剪贴板"],
        ],
      },
      {
        title: t("help.g.chat"),
        keys: [
          ["Enter（会话）", "打开消息列表预览"],
          ["↑ / ↓", "消息列表 / 全文滚动"],
          ["Enter（消息）", "展开该条全文"],
          ["Esc", "全文→列表 · 或 列表→会话"],
        ],
      },
      {
        title: t("help.g.search"),
        keys: [
          ["/", "搜索标题 / id / 路径"],
          ["  · Enter", "确认搜索"],
          ["  · Esc", "取消 · 恢复之前"],
          ["  · 空时 BS", "退出搜索"],
        ],
      },
      {
        title: t("help.g.bulk"),
        keys: [
          [":empty / :emp", "批量选择全部空会话"],
          [":missing / :mis", "批量选择全部目录失效"],
          [":bad", "批量选择空 + 失效"],
          [":sel e|m|bad|none", ":sel 系列"],
        ],
      },
      {
        title: t("help.g.quit"),
        keys: [
          [":q", "无待删时退出"],
          [":q!", "丢弃待删并退出"],
          [":wq / :x", "执行删除并退出"],
          [":retention", "保留期弹窗：改配 / 忽略 / 取消忽略"],
          [":lang", "切换界面语言"],
          [":feedback", "打开 GitHub 仓库（反馈）"],
          [":help / :h / :?", "本帮助"],
        ],
      },
      {
        title: t("help.g.notes"),
        keys: [
          ["标题", "data/session-titles.csv（本机）"],
          ["置顶", "data/session-stars.csv — 置顶且不可 dd"],
          ["标签", "data/session-tags.csv — 每会话一个"],
          ["语言", "data/ui-locale — en / zh"],
          ["刷新", "后台每 8s 重扫（界面不显示）"],
        ],
      },
    ];
  }
  return [
    {
      title: t("help.g.move"),
      keys: [
        ["↑ / ↓", "Move cursor in focused pane"],
        ["gg / G", "Top / bottom of session list"],
        ["Tab", "Focus tags rail ↔ session list"],
      ],
    },
    {
      title: t("help.g.tags"),
      keys: [
        ["Tab", "Enter / leave tags rail"],
        ["↑↓ (in tags)", "Select tag · filter sessions (all = everything)"],
        ["Enter (in tags)", "Keep filter · return to sessions"],
        ["t", "Assign tag for current session"],
        ["  · ↑↓", "Pick existing tag or (clear)"],
        ["  · type in +new", "Create tag and assign (a-z 0-9 _ -)"],
        ["  · Enter / Esc", "Confirm / cancel assign"],
      ],
    },
    {
      title: t("help.g.row"),
      keys: [
        ["Enter", "Open chat in right pane (near→far, newest first)"],
        ["Space", "Toggle select on current row (mark #)"],
        ["v", "Visual select (↑↓ extend; v again to end; mark #)"],
        ["*", "Pin / unpin (* column); blocks dd"],
        ["i", "Rename title (inline; Esc/Enter save to CSV)"],
        ["dd", "Mark delete (skipped if pinned; apply on :wq)"],
        ["u", "Undo last delete mark"],
        ["yy", "Copy resume command to clipboard"],
      ],
    },
    {
      title: t("help.g.chat"),
      keys: [
        ["Enter (session)", "Open message list (preview, near→far)"],
        ["↑ / ↓", "Move in message list · scroll when expanded"],
        ["Enter (list row)", "Expand full text of that message"],
        ["Esc", "Collapse full → list · or list → sessions"],
      ],
    },
    {
      title: t("help.g.search"),
      keys: [
        ["/", "Search title / id / path (vim-style)"],
        ["  · Enter", "Apply search"],
        ["  · Esc", "Abort · restore previous"],
        ["  · BS empty", "Exit search"],
      ],
    },
    {
      title: t("help.g.bulk"),
      keys: [
        [":empty / :emp", "Select all empty sessions"],
        [":missing / :mis", "Select all missing-path sessions"],
        [":bad", "Select empty + missing"],
        [":sel e|m|bad|none", "Same via :sel family"],
      ],
    },
    {
      title: t("help.g.quit"),
      keys: [
        [":q", "Quit if no pending deletes"],
        [":q!", "Quit · discard pending deletes"],
        [":wq / :x", "Apply deletes and quit"],
        [":retention", "Retention popup: fix / ignore / unignore"],
        [":lang", "Change UI language"],
        [":feedback", "Open GitHub repo (feedback / issues)"],
        [":help / :h / :?", "This help"],
      ],
    },
    {
      title: t("help.g.notes"),
      keys: [
        ["Titles", "data/session-titles.csv (local)"],
        ["Stars", "data/session-stars.csv — pin + no dd"],
        ["Tags", "data/session-tags.csv — one tag per session"],
        ["Language", "data/ui-locale — en / zh"],
        ["Refresh", "Background re-scan every 8s (not shown in chrome)"],
      ],
    },
  ];
}
