# playbook

プロンプト送信時に、ユーザーが用意したルールファイルを自動で Claude のコンテキストに注入するプラグインです。

## 仕組み

`UserPromptSubmit` フックで `cat` を直接実行し、以下のルールファイルを stdout に流すことで Claude / Codex のコンテキストに注入します:

1. **Claude グローバルルール** (`~/.claude/playbook/playbook.md`) - 全プロジェクト共通のルール
2. **Codex グローバルルール** (`~/.codex/playbook/playbook.md`) - 全プロジェクト共通のルール
3. **Claude プロジェクトローカルルール** (`$CLAUDE_PROJECT_DIR/.claude/playbook/playbook.md`) - プロジェクト固有のルール
4. **Codex プロジェクトローカルルール** (`$PWD/.codex/playbook/playbook.md`) - プロジェクト固有のルール

複数存在する場合は、グローバル → プロジェクトローカルの順で連結されます。どれも存在しない場合は何も注入されません（プラグインは仕組みのみを提供し、ルール本文は同梱しません）。

stdout 出力は Claude Code の transcript 上に "hook output" として可視表示されます。毎ターンの可視ノイズと引き換えに、ルールがコンテキストに確実に乗り続けることを保証する設計です。

## 使い方

### グローバルルール

`~/.claude/playbook/playbook.md` または `~/.codex/playbook/playbook.md` を作成すると、全プロジェクトでルールが注入されます。

### プロジェクト固有ルール

プロジェクトの `.claude/playbook/playbook.md` または `.codex/playbook/playbook.md` を作成すると、そのプロジェクトでのみルールが注入されます。
