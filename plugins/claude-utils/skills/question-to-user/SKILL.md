---
name: question-to-user
description: AIがユーザーに質問する。確認事項や判断を仰ぎたい時に使用。「質問して」「聞いて」などの時に使用。
disable-model-invocation: false
allowed-tools: "AskUserQuestion"
argument-hint: "[質問内容]"
---

# Question to User スキル

AskUserQuestion ツールを使って、ユーザーに質問してください。

## 引数が指定されている場合

$ARGUMENTS の内容をそのままユーザーへの質問として AskUserQuestion ツールで質問してください。

## 引数が指定されていない場合

現在の会話のコンテキストから、ユーザーに確認すべきことや判断を仰ぐべきことを考え、適切な質問を AskUserQuestion ツールで行ってください。
