#!/usr/bin/env bash
# Capture oh-my-sessions TUI into PNG via tmux + ansi_to_png.py
#
# Usage:
#   ./scripts/screenshot.sh                 # main list → docs/images/tui-main.png
#   ./scripts/screenshot.sh chat            # open chat  → docs/images/tui-chat.png
#   ./scripts/screenshot.sh main out.png    # custom path
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-main}"
OUT="${2:-}"
SESSION="oms-shot-$$"
COLS="${OMS_SHOT_COLS:-140}"
ROWS="${OMS_SHOT_ROWS:-36}"
WAIT="${OMS_SHOT_WAIT:-2.5}"

mkdir -p "$ROOT/docs/images"
case "$MODE" in
  main) OUT="${OUT:-$ROOT/docs/images/tui-main.png}" ;;
  chat) OUT="${OUT:-$ROOT/docs/images/tui-chat.png}" ;;
  *)
    echo "usage: $0 [main|chat] [out.png]" >&2
    exit 2
    ;;
esac

ANSI="$(mktemp /tmp/oms-ansi.XXXXXX.txt)"
cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  rm -f "$ANSI"
}
trap cleanup EXIT

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS"
tmux send-keys -t "$SESSION" "cd '$ROOT' && npm start" Enter
sleep "$WAIT"

# wait until brand paints
for _ in $(seq 1 15); do
  tmux capture-pane -t "$SESSION" -pe -S -50 >"$ANSI" || true
  if grep -qE 'oh-my-sessions|STATUS' "$ANSI" 2>/dev/null; then
    break
  fi
  sleep 0.4
done

if [[ "$MODE" == "chat" ]]; then
  tmux send-keys -t "$SESSION" Enter
  sleep 1.2
fi

tmux capture-pane -t "$SESSION" -pe -S -400 >"$ANSI"
python3 "$ROOT/scripts/ansi_to_png.py" "$ANSI" "$OUT"
echo "wrote $OUT ($(file -b "$OUT" 2>/dev/null || true))"
