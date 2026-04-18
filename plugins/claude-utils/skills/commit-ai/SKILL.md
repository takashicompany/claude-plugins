---
name: commit-ai
description: AIが作業・変更したファイルをgit commitする。ユーザーが「AIの変更をコミットして」などと言った時に使用。
disable-model-invocation: true
allowed-tools: "Bash, Read, Grep, Glob"
---

# AI Commit スキル

AIが作業・変更したファイルをgit commitします。以下の手順で行ってください。

## 手順

1. `git status` を実行して変更されたファイルを確認する
2. `git diff` と `git diff --staged` を実行して変更内容を把握する
3. `git log --oneline -5` を実行して直近のコミットメッセージのスタイルを確認する
4. 変更内容を分析し、適切なコミットメッセージを日本語で作成する
   - 変更の性質を要約する（新機能追加、既存機能の改善、バグ修正、リファクタリング等）
   - 「何を」ではなく「なぜ」に焦点を当てた簡潔なメッセージにする
5. 変更ファイルを `git add` でステージングする
   - `.env` やクレデンシャルファイルなど、秘密情報を含む可能性のあるファイルはステージングしない
   - `git add -A` や `git add .` は使わず、ファイルを個別に指定する
6. 以下の形式でコミットする:

```
git commit -m "$(cat <<'EOF'
コミットメッセージ

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

7. `git status` でコミットが成功したことを確認する

## 注意事項

- コミットメッセージは日本語で書く
- 秘密情報を含むファイル（.env, credentials.json等）をコミットしない。該当ファイルがある場合はユーザーに警告する
- 変更がない場合は空コミットを作成しない
