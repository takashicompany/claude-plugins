# Claude / Codex Plugins

Claude Code と Codex の両方で使うためのローカルプラグイン集です。

## Claude Code で使う

```bash
# マーケットプレイスを追加
/plugin marketplace add takashicompany/claude-plugins

# プラグイン一覧から選んでインストール
/plugin
```

Claude Code 用の marketplace は `.claude-plugin/marketplace.json` です。

## Codex で使う

Codex 用の repo marketplace は `.agents/plugins/marketplace.json` です。

```bash
# このリポジトリを marketplace として追加
codex plugin marketplace add ./.

# Codex CLI 内でプラグイン一覧を開く
/plugins
```

各プラグインには Claude Code 用の `.claude-plugin/plugin.json` と Codex 用の `.codex-plugin/plugin.json` を同居させています。

## プラグイン一覧

| プラグイン | 説明 |
|-----------|------|
| [yesman](https://github.com/takashicompany/yesman) | Claude Codeの承諾プロンプトを条件に応じて自動承認するHookプラグイン |
| [tush-push](https://github.com/takashicompany/tush-push) | Claude Codeの応答完了時・承認待ち時にPushover経由でプッシュ通知を送る |
| playbook | プロンプト送信時にルールファイルを自動で注入するHookプラグイン |
| booth-review | 回答完了時に根拠チェックを強制するHookプラグイン |
| wakariyasui-game | ゲームのスクリーンショットや動画から分かりやすさを採点するプラグイン |
| google-play-assets-unity | Unity MCPを使ってGoogle Play公開用画像素材を生成するスキル |
| google-play-assets-playwright | Playwright MCPを使ってWebゲームのGoogle Play公開用画像素材を生成するスキル |
| claude-utils | AIコミット・コミット前チェック・ユーザーへの質問などの汎用ユーティリティ |
| game-planner | 曖昧なゲームアイデアから仕様書 `plan.md` を作るスキル |
| image-gen-codex | Codex CLIの画像生成機能を使ってAI画像を生成するスキル |
| codex-quota | Codex CLIの残り利用量を確認するスキル |
