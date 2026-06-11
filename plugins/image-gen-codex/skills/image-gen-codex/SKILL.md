---
description: ユーザーが「画像を生成して」「アイコンを作って」「バナー/イラスト/プレースホルダー素材を生成して」等、AI画像生成を求めたときに使う汎用スキル。Codex CLIのビルトイン画像生成（gpt-image-2）を使用する。
allowed-tools: Bash, AskUserQuestion, Read, Write
---

# Image Gen Codex スキル

Codex CLI のビルトイン画像生成機能を使い、ユーザーの指示に応じた画像を生成する汎用スキル。

## 前提条件

- `codex` CLI がインストールされていること
- `codex` にログイン済みであること（API キーまたは ChatGPT アカウント）
- `codex exec`（非対話実行）は ChatGPT アカウント・API キーのどちらでも利用可能

## Step 1: Codex 残量の確認

画像生成はテキスト処理の 3〜5 倍のクォータを消費するため、生成前に残量を確認する。`codex app-server` の JSON-RPC でライブ取得を試み、失敗した場合はセッション JSONL にフォールバックする。

```bash
python3 -c "
import subprocess, json, sys, time, select, os, fcntl, datetime

def try_app_server():
    proc = subprocess.Popen(
        ['codex', 'app-server'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1
    )
    flags = fcntl.fcntl(proc.stdout, fcntl.F_GETFL)
    fcntl.fcntl(proc.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def send(id, method, params={}):
        proc.stdin.write(json.dumps({'jsonrpc':'2.0','id':id,'method':method,'params':params}) + '\n')
        proc.stdin.flush()

    def recv(expected_id, timeout=15):
        buf = ''
        deadline = time.time() + timeout
        while time.time() < deadline:
            ready, _, _ = select.select([proc.stdout], [], [], 1.0)
            if ready:
                try:
                    chunk = proc.stdout.read(8192)
                    if chunk:
                        buf += chunk
                        while '\n' in buf:
                            line, buf = buf.split('\n', 1)
                            if line.strip():
                                msg = json.loads(line.strip())
                                if msg.get('id') == expected_id:
                                    return msg
                except (IOError, BlockingIOError):
                    pass
        return None

    try:
        send(1, 'initialize', {'clientInfo': {'name': 'codex-quota-check', 'version': '1.0.0'}})
        if recv(1) is None:
            return None
        send(2, 'account/rateLimits/read')
        resp = recv(2)
        if resp is None or 'error' in resp:
            return None
        rl = resp['result']['rateLimits']
        pri_used = rl.get('primary', {}).get('usedPercent', -1)
        sec_used = rl.get('secondary', {}).get('usedPercent', -1)
        return pri_used, sec_used, 'live'
    finally:
        proc.kill()
        proc.wait()

def try_jsonl():
    import glob
    sessions = sorted(glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'), recursive=True))
    if not sessions:
        return None
    last_rl = None
    last_ts = None
    with open(sessions[-1]) as f:
        for line in f:
            try:
                ev = json.loads(line.strip())
                payload = ev.get('payload', {})
                if payload.get('type') == 'token_count' and payload.get('rate_limits'):
                    last_rl = payload['rate_limits']
                    last_ts = ev.get('timestamp')
            except:
                pass
    if not last_rl:
        return None
    pri = last_rl.get('primary', {})
    sec = last_rl.get('secondary', {})
    now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
    pri_used = pri.get('used_percent', -1)
    pri_reset = pri.get('resets_at', 0)
    sec_used = sec.get('used_percent', -1)
    if pri_reset > 0 and now_ts > pri_reset:
        pri_used = 0  # window has reset
    return pri_used, sec_used, f'snapshot from {last_ts}'

result = None
try:
    result = try_app_server()
except:
    pass
if result is None:
    try:
        result = try_jsonl()
    except:
        pass

if result is None:
    print('QUOTA_CHECK=unavailable')
else:
    pri_used, sec_used, source = result
    pri_remaining = 100 - pri_used if pri_used >= 0 else -1
    sec_remaining = 100 - sec_used if sec_used >= 0 else -1
    if pri_remaining >= 0 and pri_remaining < 20:
        print(f'QUOTA_CHECK=warning (5h: {pri_remaining}% remaining, weekly: {sec_remaining}% remaining, {source})')
    elif pri_remaining >= 0:
        print(f'QUOTA_CHECK=ok (5h: {pri_remaining}% remaining, weekly: {sec_remaining}% remaining, {source})')
    else:
        print('QUOTA_CHECK=unavailable')
"
```

- `QUOTA_CHECK=ok` の場合: そのまま続行する
- `QUOTA_CHECK=warning` の場合: 5時間枠の残りが 20% 未満であることをユーザーに伝え、「画像生成は 1枚あたりおよそ 3〜5% の5時間枠を消費します。続行しますか？」と確認を取る
- `QUOTA_CHECK=unavailable` の場合: 残量確認をスキップし、次のステップに進む（ユーザーには残量確認ができなかった旨を軽く伝える）

## Step 2: 環境確認

以下のコマンドで Codex CLI の存在とバージョンを確認する。

```bash
codex --version
```

- コマンドが見つからない場合: 「Codex CLI が必要です。`npm install -g @openai/codex` でインストールし、`codex login` でログインしてください」と伝えて**中断**する
- バージョンが表示されたら続行する

次に、ログイン状態を確認する。

```bash
codex login status
```

- 未ログインの場合: 「`codex login` を実行してログインしてください」と伝えて**中断**する

## Step 3: 要件ヒアリング

以下の項目が不明確な場合、AskUserQuestion でユーザーに確認する。全て明確なら省略してよい。

| 項目 | 確認内容 | デフォルト |
|------|----------|-----------|
| 生成内容 | 何を描くか（被写体、スタイル、色調など） | --- |
| 出力サイズ | 幅 x 高さ（px） | 指定なし（生成後にリサイズしない） |
| 透過背景 | 背景を透過にするか | 不要 |
| 出力先パス | ファイルの保存先ディレクトリとファイル名 | カレントディレクトリに `generated_image_001.png` |
| 枚数 | 生成する画像の枚数 | 1枚 |

## Step 4: 画像生成の実行

### 4-A: 通常生成（Codex CLI ビルトイン）

透過背景が**不要**な場合、Codex CLI のビルトイン画像生成を使う。

`codex exec` で `$imagegen` キーワードを含むプロンプトを実行する。

```bash
codex exec \
  --skip-git-repo-check \
  --ephemeral \
  -s workspace-write \
  -C "<出力先ディレクトリの絶対パス>" \
  "$imagegen <画像の説明（英語推奨）>。生成した画像を <ファイル名> として保存してください。"
```

**コマンド構成の説明:**

- `--skip-git-repo-check`: Git リポジトリ外でも実行可能にする
- `--ephemeral`: セッションファイルをディスクに残さない
- `-s workspace-write`: 生成した画像をファイルに書き出すため書き込みサンドボックスを使用
- `-C`: 出力先ディレクトリを作業ルートに指定

**`codex exec` でエラーが出る場合のフォールバック:**

何らかの理由で `codex exec` が失敗した場合は、以下の代替手順をユーザーに案内する:

1. ターミナルで `codex` を対話モードで起動してもらう
2. 対話モード内で `$imagegen <画像の説明>` と入力してもらう
3. 生成された画像のパスをユーザーから受け取り、後続の処理を行う

### 4-B: 透過背景が必要な場合（OpenAI Images API フォールバック）

Codex CLI のビルトイン画像生成には透過背景が正しく動作しないバグがある（GitHub Issue #18905, #18636）。さらに、OpenAI の最新ドキュメントによると `gpt-image-2` は `background: "transparent"` を**サポートしていない**。透過背景が必要な場合は以下の代替手段を使う。

**環境変数 `OPENAI_API_KEY` の確認:**

```bash
[ -n "$OPENAI_API_KEY" ] && echo "APIキーあり" || echo "APIキーなし"
```

**API キーがある場合 -- OpenAI Images API を直接呼ぶ:**

`gpt-image-1` は `background: "transparent"` パラメータを受け付ける。ただし、API の対応状況は変わりうるため、エラーが返った場合は後述の背景除去ツールにフォールバックする。

```bash
curl -s https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-1",
    "prompt": "<画像の説明（英語推奨）>",
    "n": 1,
    "size": "1024x1024",
    "background": "transparent",
    "output_format": "png"
  }' | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
if 'data' in data and len(data['data']) > 0:
    img_b64 = data['data'][0].get('b64_json', '')
    if img_b64:
        with open('<出力ファイルパス>', 'wb') as f:
            f.write(base64.b64decode(img_b64))
        print('保存完了: <出力ファイルパス>')
    else:
        print('エラー: b64_json が応答に含まれていません')
        print(json.dumps(data, indent=2))
else:
    print('エラー: 画像生成に失敗しました')
    print(json.dumps(data, indent=2))
"
```

**パラメータ補足:**

- `model`: `gpt-image-1` を使用（`gpt-image-2` は透過背景非対応）
- `background`: `"transparent"` で透過背景を指定。受け付けない場合は `"auto"` にフォールバック
- `output_format`: `"png"` を指定（透過を保持するため）
- `size`: 任意の解像度を指定可能（最大辺 3840px、16px の倍数、アスペクト比 3:1 以内）。例: `"1024x1024"`, `"1536x1024"`, `"1024x1536"`, `"auto"`
- レスポンスは `b64_json` 形式で返る

**API で透過が使えなかった場合 / API キーがない場合の背景除去フォールバック:**

通常生成（Step 3-A）で不透過の画像を生成した後、背景を除去するツールで処理する。

```bash
# rembg（Python製の背景除去ツール）が使えるか確認
python3 -m rembg --help >/dev/null 2>&1 && echo "rembg利用可" || echo "rembg未インストール"

# rembg がある場合
python3 -m rembg i <入力ファイル> <出力ファイル>
```

`rembg` がインストールされていない場合、ユーザーに以下を伝える:

> 透過背景付きの画像を AI で直接生成するには環境変数 `OPENAI_API_KEY` に OpenAI の API キーが必要です（`export OPENAI_API_KEY="sk-..."`）。または、`pip install rembg` で背景除去ツールをインストールすれば、生成済み画像から背景を除去できます。どちらも利用できない場合は、不透過のまま生成するか、外部の背景除去サービスを手動でご利用ください。

透過なしで進めてよいかユーザーに確認し、了承があれば Step 4-A で通常生成する。

## Step 5: 後処理（リサイズ / クロップ）

ビルトイン画像生成ではサイズ指定ができないため、ユーザーが特定サイズを要求している場合は生成後にリサイズする。

**macOS の `sips` を使う方法（追加インストール不要）:**

```bash
# リサイズ（アスペクト比を維持して最大幅・高さに収める）
sips -Z <長辺のpx> <入力ファイル> --out <出力ファイル>

# 特定の幅 x 高さに強制リサイズ（アスペクト比を維持しない）
sips -z <高さ> <幅> <入力ファイル> --out <出力ファイル>

# クロップ（中央から切り抜き -- sips では直接できないので、リサイズ後に cropOffset を使う）
sips --resampleWidth <幅> <入力ファイル> --out <一時ファイル>
sips --cropToHeightWidth <高さ> <幅> <一時ファイル> --out <出力ファイル>
rm <一時ファイル>
```

**ImageMagick がある場合（より柔軟）:**

```bash
# リサイズ（アスペクト比維持）
convert <入力ファイル> -resize <幅>x<高さ> <出力ファイル>

# リサイズ + クロップ（中央基準で指定サイズぴったりに）
convert <入力ファイル> -resize <幅>x<高さ>^ -gravity center -extent <幅>x<高さ> <出力ファイル>
```

どちらのツールを使うかは以下で判定する:

```bash
which magick >/dev/null 2>&1 && echo "ImageMagick利用可" || echo "sipsを使用"
```

## Step 6: 結果報告

生成した画像のパスと概要をユーザーに報告する。報告には以下を含める:

- 生成された画像ファイルのパス一覧
- 各画像のサイズ（px）
- 後処理（リサイズ等）を行った場合はその内容
- 透過フォールバックを使用した場合はその旨

## 厳守事項

- **コスト注意**: Codex CLI のビルトイン画像生成はテキスト処理の 3〜5 倍の利用上限を消費する。デフォルトでは**1〜2枚**に留めること。3枚以上の生成はユーザーに「画像生成は Codex の利用上限を通常の 3〜5 倍消費します。N枚生成してよろしいですか？」と明示的に了承を取ってから実行すること
- **ビルトインの制約**: Codex CLI のビルトイン画像生成ではサイズ・品質・マスクの指定ができない（GitHub Issue #18944）。サイズ調整は Step 5 の後処理で対応する
- **透過背景の制約**: ビルトイン生成では透過背景が壊れるバグがある（GitHub Issue #18905, #18636）。さらに `gpt-image-2` は API レベルでも透過非対応。透過が必要な場合は必ず Step 4-B のフォールバック手順（`gpt-image-1` API または `rembg` 背景除去）を使う
- **プロンプト言語**: 画像生成プロンプトは英語で記述することを推奨する（生成品質が向上する）
- **~/tmp フォルダは使用禁止**: 一時ファイルが必要な場合はプロジェクトディレクトリ内に作成し、完了後に削除する
