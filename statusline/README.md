# Claude Code ステータスライン

Claude Code のステータスラインに以下を表示するスクリプト一式です。macOS / Linux (Ubuntu, Raspberry Pi OS 等) の両方で動作します。

## 表示内容

```
フォルダ名(ブランチ) | モデル名 | 5h使用:N% →HH:MM | 7d使用:N% →MM/DD HH:MM
codex | 5h使用:N% →HH:MM | 7d使用:N% →MM/DD HH:MM
```

- **1行目**: 作業フォルダ、gitブランチ、使用モデル、Claude APIの5時間/7日間のレートリミット使用率とリセット時刻
- **2行目**: Codex CLIのレートリミット使用率とリセット時刻（codexがインストール済みの場合のみ表示）

## 依存

- **jq** -- JSONパース用
- **python3** -- 日付フォーマット（OS間差異の吸収）、Codex API呼び出し
- **codex CLI** -- (任意) Codex使用量の表示に必要。なくても1行目は正常動作

## インストール

### 方法1: install.sh を使う（推奨）

```bash
git clone https://github.com/takashicompany/claude-plugins.git
cd claude-plugins/statusline
./install.sh
```

install.sh が行うこと:
1. jq, python3 の存在チェック（なければインストール方法を案内して中断）
2. 既存の `~/.claude/statusline.sh` 等があればタイムスタンプ付きバックアップ
3. スクリプト2つを `~/.claude/` にコピー＋実行権限付与
4. `~/.claude/settings.json` に statusLine 設定をマージ（ファイルがなければ新規作成）
5. codex CLI の有無をチェックし、なければ案内表示

### 方法2: 手動コピー（scp等）

スクリプト2つをリモートマシンにコピーします。

```bash
scp statusline.sh codex-quota-update.sh リモートホスト:~/.claude/
ssh リモートホスト 'chmod +x ~/.claude/statusline.sh ~/.claude/codex-quota-update.sh'
```

`~/.claude/settings.json` に以下を追加（ファイルがなければこの内容で新規作成）:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2,
    "refreshInterval": 5
  }
}
```

既に `settings.json` がある場合は、トップレベルに `"statusLine"` キーをマージしてください。

## アンインストール

```bash
rm ~/.claude/statusline.sh ~/.claude/codex-quota-update.sh
rm -f ~/.claude/codex-quota-cache.json
rm -f ~/.claude/codex-quota-update.lock
```

`~/.claude/settings.json` から `"statusLine"` キーを削除:

```bash
jq 'del(.statusLine)' ~/.claude/settings.json > /tmp/settings_tmp.json && mv /tmp/settings_tmp.json ~/.claude/settings.json
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `statusline.sh` | ステータスライン描画本体。Claude Codeが標準入力に渡すJSONをパースして表示文字列を出力 |
| `codex-quota-update.sh` | Codex CLIの `app-server` JSON-RPCでレートリミットを取得し、キャッシュファイルに保存。statusline.sh からバックグラウンド起動される |
| `install.sh` | インストーラ。依存チェック、バックアップ、ファイル配置、settings.jsonマージを自動実行 |
