#!/bin/bash
# inject-rules.sh - UserPromptSubmit Hook
# プラグインのデフォルトルール、グローバルルール、プロジェクトローカルルールを読み込んで注入する

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT=""

# 1. プラグイン同梱のデフォルトルール（必ず存在）
DEFAULT_RULES="${PLUGIN_ROOT}/rules/default.md"
if [ -f "$DEFAULT_RULES" ]; then
  CONTEXT+="$(cat "$DEFAULT_RULES")"
fi

# 2. グローバルルール（ユーザーが任意で配置）
GLOBAL_RULES="${HOME}/.claude/playbook/playbook.md"
if [ -f "$GLOBAL_RULES" ]; then
  CONTEXT+=$'\n\n'
  CONTEXT+="$(cat "$GLOBAL_RULES")"
fi

# 3. プロジェクトローカルルール（プロジェクトごとに任意で配置）
if [ -n "$CLAUDE_PROJECT_DIR" ]; then
  LOCAL_RULES="${CLAUDE_PROJECT_DIR}/.claude/playbook/playbook.md"
  if [ -f "$LOCAL_RULES" ]; then
    CONTEXT+=$'\n\n'
    CONTEXT+="$(cat "$LOCAL_RULES")"
  fi
fi

# コンテキストがあれば注入
if [ -n "$CONTEXT" ]; then
  jq -n --arg ctx "$CONTEXT" '{
    "hookSpecificOutput": {
      "hookEventName": "UserPromptSubmit",
      "additionalContext": $ctx
    }
  }'
fi

exit 0
