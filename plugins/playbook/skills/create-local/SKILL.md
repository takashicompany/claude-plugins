---
name: create-local
description: 現在のプロジェクトに `.claude/playbook/playbook.md` を作成し、エディタで開くスキル。playbook プラグインがプロジェクトローカルルールとして読み込む先のファイルをセットアップしたいときに使う。
---

# playbook create-local

このプロジェクトの `.claude/playbook/playbook.md` を作成し、`open` コマンドでエディタに開きます。playbook プラグインがプロジェクトローカルルールとして読み込む先のファイルです。

## 動作

1. `${CLAUDE_PROJECT_DIR}/.claude/playbook/` ディレクトリを作成（未存在の場合のみ）
2. `playbook.md` を作成（既存なら上書きしない）
3. `open` で OS のデフォルトエディタに渡す

既存ファイルの内容は保護されます。

## 実行手順

以下のシェルコマンドを Bash ツールで実行してください:

```bash
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/playbook"
FILE="$DIR/playbook.md"
mkdir -p "$DIR"
[ -f "$FILE" ] || touch "$FILE"
open "$FILE"
echo "Opened: $FILE"
```

実行後、ユーザーに「ファイルを開いたので、playbook プラグインで適用したいルールを書いてください」と一言伝えてください。
