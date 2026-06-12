#!/bin/bash
# Claude Code statusline installer (portable: macOS + Linux)
# Installs statusline.sh and codex-quota-update.sh to ~/.claude/
# and merges statusLine config into ~/.claude/settings.json

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

# Colors (safe for terminals that don't support them)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' NC=''
fi

info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }

# ---- (a) Dependency check ----
missing=0

if ! command -v jq >/dev/null 2>&1; then
  error "jq が見つかりません。"
  echo "  macOS:  brew install jq"
  echo "  Ubuntu: sudo apt install jq"
  missing=1
fi

if ! command -v python3 >/dev/null 2>&1; then
  error "python3 が見つかりません。"
  echo "  macOS:  brew install python3"
  echo "  Ubuntu: sudo apt install python3"
  missing=1
fi

if [ "$missing" -eq 1 ]; then
  error "必要な依存が不足しています。上記をインストールしてから再実行してください。"
  exit 1
fi

info "依存チェック OK (jq, python3)"

# ---- Ensure ~/.claude/ exists ----
mkdir -p "$CLAUDE_DIR"

# ---- (b) Backup existing files ----
backup_if_exists() {
  local file="$1"
  if [ -f "$file" ]; then
    local ts
    ts=$(date +%Y%m%d_%H%M%S)
    local backup="${file}.bak.${ts}"
    cp "$file" "$backup"
    warn "既存ファイルをバックアップ: $backup"
  fi
}

backup_if_exists "$CLAUDE_DIR/statusline.sh"
backup_if_exists "$CLAUDE_DIR/codex-quota-update.sh"

# ---- (c) Copy scripts and set permissions ----
cp "$SCRIPT_DIR/statusline.sh" "$CLAUDE_DIR/statusline.sh"
chmod +x "$CLAUDE_DIR/statusline.sh"
info "配置: $CLAUDE_DIR/statusline.sh"

cp "$SCRIPT_DIR/codex-quota-update.sh" "$CLAUDE_DIR/codex-quota-update.sh"
chmod +x "$CLAUDE_DIR/codex-quota-update.sh"
info "配置: $CLAUDE_DIR/codex-quota-update.sh"

# ---- (d) Merge statusLine into settings.json ----
STATUSLINE_JSON='{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2,
    "refreshInterval": 5
  }
}'

if [ ! -f "$SETTINGS_FILE" ]; then
  # Create new settings.json
  echo "$STATUSLINE_JSON" | jq '.' > "$SETTINGS_FILE"
  info "settings.json を新規作成: $SETTINGS_FILE"
else
  # Check if statusLine already exists
  existing_sl=$(jq '.statusLine // empty' "$SETTINGS_FILE" 2>/dev/null)
  if [ -n "$existing_sl" ] && [ "$existing_sl" != "null" ]; then
    printf "${YELLOW}[WARN]${NC} settings.json に既存の statusLine 設定があります:\n"
    echo "$existing_sl" | jq '.'
    printf "上書きしますか? [y/N]: "
    read -r answer
    if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
      warn "statusLine の設定変更をスキップしました。"
      skip_settings=1
    fi
  fi

  if [ "${skip_settings:-0}" != "1" ]; then
    backup_if_exists "$SETTINGS_FILE"
    # Merge statusLine into existing settings.json
    tmp_settings="${SETTINGS_FILE}.tmp.$$"
    jq '. * {
      "statusLine": {
        "type": "command",
        "command": "~/.claude/statusline.sh",
        "padding": 2,
        "refreshInterval": 5
      }
    }' "$SETTINGS_FILE" > "$tmp_settings"
    mv -f "$tmp_settings" "$SETTINGS_FILE"
    info "settings.json に statusLine 設定をマージ: $SETTINGS_FILE"
  fi
fi

# ---- (e) Check codex CLI ----
if command -v codex >/dev/null 2>&1; then
  info "codex CLI が見つかりました。Codex使用量もステータスラインに表示されます。"
else
  warn "codex CLI が見つかりません。Codex行は表示されません。"
  echo "  codex をインストール・ログインすれば、Codex使用量も表示されます。"
  echo "  https://github.com/openai/codex"
fi

echo ""
info "インストール完了！ Claude Code を再起動するとステータスラインが有効になります。"
