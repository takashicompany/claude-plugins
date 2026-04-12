# playbook

プロンプト送信時に、ルールファイルを自動で Claude のコンテキストに注入するプラグインです。

## 仕組み

`UserPromptSubmit` フックを使い、ユーザーがプロンプトを送信するたびに以下のルールファイルを読み込んで注入します:

1. **プラグイン同梱のデフォルトルール** (`rules/default.md`) - 根拠なき回答の禁止、空虚な同意の禁止など
2. **グローバルルール** (`~/.claude/playbook/playbook.md`) - 全プロジェクト共通の追加ルール（任意）
3. **プロジェクトローカルルール** (`$CLAUDE_PROJECT_DIR/.claude/playbook/playbook.md`) - プロジェクト固有の追加ルール（任意）

## カスタマイズ

### グローバルルールの追加

`~/.claude/playbook/playbook.md` を作成すると、全プロジェクトで追加ルールが注入されます。

### プロジェクト固有ルールの追加

プロジェクトの `.claude/playbook/playbook.md` を作成すると、そのプロジェクトでのみ追加ルールが注入されます。
