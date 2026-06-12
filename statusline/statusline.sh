#!/bin/bash
# Claude Code statusline (portable: macOS + Linux)
# Displays: folder(branch) | model | 5h使用:N% →HH:MM | 7d使用:N% →MM/DD HH:MM
#           codex | 5h使用:N% →HH:MM | 7d使用:N% →MM/DD HH:MM

set -u

input=$(cat)

DIR=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
MODEL=$(echo "$input" | jq -r '.model.display_name // .model.id // "?"')
FIVE_PCT=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
FIVE_RESET=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
WEEK_PCT=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
WEEK_RESET=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# Folder + git branch
FOLDER=$(basename "${DIR:-$PWD}")
BRANCH=""
if [ -n "$DIR" ]; then
  BRANCH=$(cd "$DIR" 2>/dev/null && git branch --show-current 2>/dev/null || true)
fi
if [ -n "$BRANCH" ]; then
  FOLDER_PART="${FOLDER}(${BRANCH})"
else
  FOLDER_PART="$FOLDER"
fi

# Rate limit parts
fmt_pct() {
  [ -z "$1" ] && echo "" && return
  printf '%.0f' "$1"
}

fmt_time() {
  # $1: epoch seconds, $2: strftime format (e.g. %H:%M or %m/%d %H:%M)
  # Uses python3 for cross-platform compatibility (no BSD/GNU date differences)
  [ -z "$1" ] && echo "" && return
  python3 -c "
import datetime, sys
try:
    ts = int(sys.argv[1])
    print(datetime.datetime.fromtimestamp(ts).strftime(sys.argv[2]))
except Exception:
    pass
" "$1" "$2" 2>/dev/null
}

build_limit() {
  # $1: label, $2: pct, $3: reset_epoch, $4: date format
  local label="$1" pct="$2" reset="$3" fmt="$4"
  [ -z "$pct" ] && return
  local pct_n
  pct_n=$(fmt_pct "$pct")
  local out="${label}:${pct_n}%"
  local t
  t=$(fmt_time "$reset" "$fmt")
  [ -n "$t" ] && out="$out →$t"
  echo "$out"
}

FIVE_PART=$(build_limit "5h使用" "$FIVE_PCT" "$FIVE_RESET" "%H:%M")
WEEK_PART=$(build_limit "7d使用" "$WEEK_PCT" "$WEEK_RESET" "%m/%d %H:%M")

# --- Codex quota (from cache) ---
CODEX_CACHE="$HOME/.claude/codex-quota-cache.json"
CODEX_UPDATER="$HOME/.claude/codex-quota-update.sh"
CODEX_TTL=300  # 5 minutes

CODEX_PART=""
if [ -f "$CODEX_CACHE" ]; then
  cache_ts=$(jq -r '.timestamp // 0' "$CODEX_CACHE" 2>/dev/null)
  cache_pri=$(jq -r '.primary_used_percent // empty' "$CODEX_CACHE" 2>/dev/null)
  cache_sec=$(jq -r '.secondary_used_percent // empty' "$CODEX_CACHE" 2>/dev/null)
  cache_pri_reset=$(jq -r '.primary_resets_at // empty' "$CODEX_CACHE" 2>/dev/null)
  cache_sec_reset=$(jq -r '.secondary_resets_at // empty' "$CODEX_CACHE" 2>/dev/null)
  now_ts=$(date +%s)
  cache_age=$(( now_ts - cache_ts ))

  # Build display using the same build_limit function as Claude line
  if [ -n "$cache_pri" ] && [ "$cache_pri" != "-1" ] && [ -n "$cache_sec" ] && [ "$cache_sec" != "-1" ]; then
    CODEX_5H=$(build_limit "5h使用" "$cache_pri" "$cache_pri_reset" "%H:%M")
    CODEX_7D=$(build_limit "7d使用" "$cache_sec" "$cache_sec_reset" "%m/%d %H:%M")
    CODEX_PART="codex"
    [ -n "$CODEX_5H" ] && CODEX_PART="$CODEX_PART | $CODEX_5H"
    [ -n "$CODEX_7D" ] && CODEX_PART="$CODEX_PART | $CODEX_7D"
  fi

  # Trigger background refresh if cache is stale
  if [ "$cache_age" -ge "$CODEX_TTL" ] && [ -x "$CODEX_UPDATER" ]; then
    nohup "$CODEX_UPDATER" >/dev/null 2>&1 &
    disown
  fi
else
  # No cache yet — trigger first fetch in background
  if [ -x "$CODEX_UPDATER" ]; then
    nohup "$CODEX_UPDATER" >/dev/null 2>&1 &
    disown
  fi
fi

# Line 1: folder(branch) | model | rate limits
OUT="$FOLDER_PART | $MODEL"
[ -n "$FIVE_PART" ] && OUT="$OUT | $FIVE_PART"
[ -n "$WEEK_PART" ] && OUT="$OUT | $WEEK_PART"

echo "$OUT"

# Line 2: Codex quota (only if data available)
[ -n "$CODEX_PART" ] && echo "$CODEX_PART"
