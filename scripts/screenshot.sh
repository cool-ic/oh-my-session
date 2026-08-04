#!/usr/bin/env bash
# Capture oh-my-session TUI into PNG via tmux + ansi_to_png.py
#
# By default this runs against a generated demo fixture (scripts/demo-fixture.mjs)
# so the README screenshots are reproducible and contain no private session data.
# Set OMS_SHOT_REAL=1 to shoot your own sessions instead.
#
# Env:
#   OMS_SHOT_FONT_SIZE=32   render size (higher = sharper, bigger PNG)
#   OMS_SHOT_COLS=150       terminal width in cells
#   OMS_SHOT_ROWS=28        terminal height in cells
#   OMS_SHOT_REAL=1         use the real agent homes instead of the fixture
#   OMS_SHOT_LOCALE=en|zh   UI language for the shot (writes data/ui-locale)
#
# Usage:
#   ./scripts/screenshot.sh                 # main list → docs/images/tui-main.png
#   ./scripts/screenshot.sh chat            # open chat  → docs/images/tui-chat.png
#   ./scripts/screenshot.sh main out.png    # custom path
#   OMS_SHOT_LOCALE=zh ./scripts/screenshot.sh main docs/images/tui-main-zh.png
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-main}"
OUT="${2:-}"
SESSION="oms-shot-$$"
COLS="${OMS_SHOT_COLS:-150}"
ROWS="${OMS_SHOT_ROWS:-21}"
WAIT="${OMS_SHOT_WAIT:-2.5}"
LOCALE="${OMS_SHOT_LOCALE:-en}"

mkdir -p "$ROOT/docs/images"
# Default out paths: en → tui-main.png; zh → tui-main-zh.png
shot_out() {
  local base="$1"
  if [[ "$LOCALE" == "en" ]]; then echo "$ROOT/docs/images/${base}.png"
  else echo "$ROOT/docs/images/${base}-${LOCALE}.png"
  fi
}
case "$MODE" in
  main) OUT="${OUT:-$(shot_out tui-main)}" ;;
  chat) OUT="${OUT:-$(shot_out tui-chat)}" ;;
  retention) OUT="${OUT:-$(shot_out tui-retention)}" ;;
  *)
    echo "usage: $0 [main|chat|retention] [out.png]" >&2
    exit 2
    ;;
esac

ANSI="$(mktemp /tmp/oms-ansi.XXXXXX.txt)"
FIXTURE=""
cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  rm -f "$ANSI"
  [[ -n "$FIXTURE" ]] && rm -rf "$FIXTURE"
  return 0
}
trap cleanup EXIT

# Demo fixture: fake agent homes + fake project dirs + its own CSV store, so we
# never read or write the user's real sessions, titles or stars.
#
# The root is fixed and short rather than a mktemp path, because these absolute
# paths are visible on screen — in the RESUME DIR column and in the :retention
# overlay's "File:" lines. It is laid out like a home directory
# (<root>/.qoder, <root>/code/<repo>) and removed again on exit.
ENVPREFIX=""
if [[ "${OMS_SHOT_REAL:-0}" != "1" ]]; then
  FIXTURE="${OMS_SHOT_ROOT:-/tmp/demo}"
  REPOS="$FIXTURE/code"
  node "$ROOT/scripts/demo-fixture.mjs" "$FIXTURE" "$REPOS" >/dev/null
  # Override fixture locale (demo-fixture defaults to en)
  printf '%s\n' "$LOCALE" >"$FIXTURE/data/ui-locale"
  ENVPREFIX="OMS_DATA_DIR='$FIXTURE/data' GROK_HOME='$FIXTURE/.grok' QODER_CONFIG_DIR='$FIXTURE/.qoder' CLAUDE_CONFIG_DIR='$FIXTURE/.claude'"
fi

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS"
tmux send-keys -t "$SESSION" "cd '$ROOT' && $ENVPREFIX npm start" Enter
sleep "$WAIT"

# wait until brand paints (main list or retention popup) — en + zh
for _ in $(seq 1 20); do
  tmux capture-pane -t "$SESSION" -pe -S -50 >"$ANSI" || true
  if grep -qiE 'oh-my-session|status|source|状态|来源|auto-deletion|Session retention|自动删除|会话可能' "$ANSI" 2>/dev/null; then
    break
  fi
  sleep 0.4
done

# Fixture agents start "at risk", so the TUI opens a blocking retention popup.
# main/chat need the session list; retention wants the popup itself.
has_retention_popup() {
  grep -qE 'auto-deletion|I understand|RETENTION|自动删除|知情不改|保留期' "$ANSI" 2>/dev/null
}

case "$MODE" in
  main|chat)
    tmux capture-pane -t "$SESSION" -pe -S -80 >"$ANSI" || true
    if has_retention_popup; then
      # Acknowledge risks → list view (do NOT use bare `i` later for rename).
      tmux send-keys -t "$SESSION" 'i'
      sleep 0.8
      # wait for column header (en: status/source · zh: 状态/来源)
      for _ in $(seq 1 12); do
        tmux capture-pane -t "$SESSION" -pe -S -50 >"$ANSI" || true
        if grep -qiE 'status|source|title|状态|来源|标题' "$ANSI" 2>/dev/null; then
          break
        fi
        sleep 0.3
      done
    fi
    if [[ "$MODE" == "chat" ]]; then
      # Prefer a starred / multi-turn session near the top (gg then Enter).
      tmux send-keys -t "$SESSION" 'g' 'g'
      sleep 0.2
      tmux send-keys -t "$SESSION" Enter
      sleep 1.2
    fi
    ;;
  retention)
    tmux capture-pane -t "$SESSION" -pe -S -80 >"$ANSI" || true
    if ! has_retention_popup; then
      # Already safe/ignored — open status panel instead.
      tmux send-keys -t "$SESSION" ':retention' Enter
      sleep 1.0
    fi
    sleep 0.4
    ;;
esac

tmux capture-pane -t "$SESSION" -pe -S -400 >"$ANSI"
python3 "$ROOT/scripts/ansi_to_png.py" "$ANSI" "$OUT"
echo "wrote $OUT ($(file -b "$OUT" 2>/dev/null || true))"
