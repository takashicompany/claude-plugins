---
name: create-local
description: 現在のプロジェクトに Claude/Codex 向けの playbook ルールファイルを作成し、エディタで開くスキル。playbook プラグインがプロジェクトローカルルールとして読み込む先のファイルをセットアップしたいときに使う。
---

# playbook create-local

このプロジェクトの `.codex/playbook/playbook.md` と `.claude/playbook/playbook.md` を作成し、`open` コマンドでエディタに開きます。playbook プラグインがプロジェクトローカルルールとして読み込む先のファイルです。

## 動作

1. `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/playbook/` と `${CLAUDE_PROJECT_DIR:-$(pwd)}/.codex/playbook/` ディレクトリを作成（未存在の場合のみ）
2. それぞれの `playbook.md` を作成（既存なら上書きしない）
3. `open` で OS のデフォルトエディタに渡す

既存ファイルの内容は保護されます。

## 実行手順

以下のシェルコマンドを Bash ツールで実行してください:

```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CLAUDE_DIR="$PROJECT_DIR/.claude/playbook"
CODEX_DIR="$PROJECT_DIR/.codex/playbook"
CLAUDE_FILE="$CLAUDE_DIR/playbook.md"
CODEX_FILE="$CODEX_DIR/playbook.md"
mkdir -p "$CLAUDE_DIR" "$CODEX_DIR"
[ -f "$CLAUDE_FILE" ] || touch "$CLAUDE_FILE"
[ -f "$CODEX_FILE" ] || touch "$CODEX_FILE"
open "$CODEX_FILE"
echo "Opened: $CODEX_FILE"
```

実行後、ユーザーに「Codex 用ファイルを開いたので、playbook プラグインで適用したいルールを書いてください。Claude 用ファイルも同時に作成済みです」と一言伝えてください。
