---
name: codex-quota
description: Codex CLIの残り利用量（レートリミット/クォータ）を確認する。「Codexの残量は？」「あとどれくらい使える？」「画像生成する前に残量チェックして」等、Codex利用量の確認を求められたときに使う。
allowed-tools: Bash, Read
---

# Codex Quota スキル

Codex CLI のレートリミット残量（5時間枠・週間枠）をライブ取得し、ユーザーに報告する。

## 前提条件

- `codex` CLI がインストールされていること（v0.130.0 以降）
- `codex` にログイン済みであること（ChatGPT アカウントまたは API キー）

## Step 1: app-server JSON-RPC によるライブ取得（主手段）

`codex app-server` をサブプロセスとして起動し、JSON-RPC で `account/rateLimits/read` を呼ぶことで、サーバー側のリアルタイムなレートリミット情報を取得する。`~/.codex/auth.json` の認証情報は app-server が内部で自動的に使用するため、スクリプトからトークンを直接読み取る必要はない。

以下の Python スクリプトを Bash で実行する:

```bash
python3 -c "
import subprocess, json, sys, time, select, os, fcntl, datetime

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
        print('ERROR: app-server の初期化に失敗しました（タイムアウト）'); sys.exit(1)

    send(2, 'account/rateLimits/read')
    resp = recv(2)
    if resp is None:
        print('ERROR: レートリミット取得に失敗しました（タイムアウト）'); sys.exit(1)
    if 'error' in resp:
        print(f'ERROR: {resp[\"error\"].get(\"message\", resp[\"error\"])}'); sys.exit(1)

    rl = resp['result']['rateLimits']
    pri = rl.get('primary', {})
    sec = rl.get('secondary', {})
    now = time.time()

    print(f'SOURCE=live')
    print(f'PLAN_TYPE={rl.get(\"planType\", \"unknown\")}')

    print(f'PRIMARY_USED_PERCENT={pri.get(\"usedPercent\", -1)}')
    print(f'PRIMARY_WINDOW_MINUTES={pri.get(\"windowDurationMins\", 0)}')
    pri_reset = pri.get('resetsAt', 0)
    print(f'PRIMARY_RESETS_AT={pri_reset}')
    if pri_reset > 0:
        dt = datetime.datetime.fromtimestamp(pri_reset, tz=datetime.timezone.utc)
        print(f'PRIMARY_RESETS_AT_ISO={dt.isoformat()}')
        print(f'PRIMARY_MINUTES_LEFT={max(0, int((pri_reset - now) / 60))}')

    print(f'SECONDARY_USED_PERCENT={sec.get(\"usedPercent\", -1)}')
    print(f'SECONDARY_WINDOW_MINUTES={sec.get(\"windowDurationMins\", 0)}')
    sec_reset = sec.get('resetsAt', 0)
    print(f'SECONDARY_RESETS_AT={sec_reset}')
    if sec_reset > 0:
        dt = datetime.datetime.fromtimestamp(sec_reset, tz=datetime.timezone.utc)
        print(f'SECONDARY_RESETS_AT_ISO={dt.isoformat()}')
        print(f'SECONDARY_DAYS_LEFT={max(0, round((sec_reset - now) / 86400, 1))}')

    rr = rl.get('rateLimitReachedType')
    print(f'RATE_LIMIT_REACHED={rr if rr else \"none\"}')

    # Per-model breakdown (if available)
    by_id = resp['result'].get('rateLimitsByLimitId', {})
    for lid, ldata in by_id.items():
        if lid == rl.get('limitId'):
            continue
        name = ldata.get('limitName', lid)
        lp = ldata.get('primary', {})
        ls = ldata.get('secondary', {})
        print(f'MODEL_{lid}_NAME={name}')
        print(f'MODEL_{lid}_PRIMARY_USED={lp.get(\"usedPercent\", -1)}')
        print(f'MODEL_{lid}_SECONDARY_USED={ls.get(\"usedPercent\", -1)}')
finally:
    proc.kill()
    proc.wait()
"
```

スクリプトが `SOURCE=live` で始まる出力を返したら、Step 3 に進む。`ERROR:` で始まる出力を返した場合は、Step 2 のフォールバックに進む。

## Step 2: セッション JSONL パースによる取得（フォールバック1）

Step 1 が失敗した場合（`codex app-server` が起動できない、タイムアウト等）に使用する。`~/.codex/sessions/` 配下の最新セッション JSONL から、最後に記録されたレートリミット情報を読み取る。

**この方式で取得できる値は、最後に Codex を使用した時点のスナップショットであり、現在の値とは異なる可能性がある。** 特に5時間枠は経過時間でリセットされるため、古いセッションのデータは参考にならないことがある。

以下の Python スクリプトを Bash で実行する:

```bash
python3 -c "
import glob, json, os, datetime

sessions = sorted(glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'), recursive=True))
if not sessions:
    print('ERROR: ~/.codex/sessions/ にセッションファイルが見つかりません')
    print('Codex を一度起動してセッションを作成してください')
    exit(1)

latest = sessions[-1]

last_rl = None
last_ts = None
with open(latest) as f:
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
    print('ERROR: 最新セッションにレートリミット情報がありません')
    print('セッションが途中で中断された可能性があります')
    print('別のセッションファイルを確認するか、Codex を一度起動してください')
    exit(1)

pri = last_rl.get('primary', {})
sec = last_rl.get('secondary', {})
now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()

pri_used = pri.get('used_percent', -1)
pri_reset = pri.get('resets_at', 0)
sec_used = sec.get('used_percent', -1)
sec_reset = sec.get('resets_at', 0)

print(f'SOURCE=snapshot')
print(f'DATA_TIMESTAMP={last_ts}')
if last_ts:
    try:
        dt = datetime.datetime.fromisoformat(last_ts) if isinstance(last_ts, str) else datetime.datetime.fromtimestamp(last_ts, tz=datetime.timezone.utc)
        age_minutes = int((now_ts - dt.timestamp()) / 60)
        print(f'DATA_AGE_MINUTES={age_minutes}')
    except:
        pass
print(f'PLAN_TYPE={last_rl.get(\"plan_type\", \"unknown\")}')

print(f'PRIMARY_USED_PERCENT={pri_used}')
print(f'PRIMARY_WINDOW_MINUTES={pri.get(\"window_minutes\", 0)}')
print(f'PRIMARY_RESETS_AT={pri_reset}')
if pri_reset > 0 and now_ts > pri_reset:
    print('PRIMARY_WINDOW_RESET=true')
else:
    print('PRIMARY_WINDOW_RESET=false')
    if pri_reset > 0:
        print(f'PRIMARY_MINUTES_LEFT={int((pri_reset - now_ts) / 60)}')

print(f'SECONDARY_USED_PERCENT={sec_used}')
print(f'SECONDARY_WINDOW_MINUTES={sec.get(\"window_minutes\", 0)}')
print(f'SECONDARY_RESETS_AT={sec_reset}')
if sec_reset > 0 and now_ts > sec_reset:
    print('SECONDARY_WINDOW_RESET=true')
else:
    print('SECONDARY_WINDOW_RESET=false')
    if sec_reset > 0:
        print(f'SECONDARY_DAYS_LEFT={round((sec_reset - now_ts) / 86400, 1)}')

if last_rl.get('rate_limit_reached_type'):
    print(f'RATE_LIMIT_REACHED={last_rl[\"rate_limit_reached_type\"]}')
else:
    print('RATE_LIMIT_REACHED=none')
"
```

スクリプトが `SOURCE=snapshot` で始まる出力を返したら、Step 3 に進む。`ERROR:` で始まる出力を返した場合は、フォールバック2 に進む。

### フォールバック2: 対話モードでの確認案内

Step 1・Step 2 の両方が失敗した場合は、以下の手順をユーザーに案内する:

1. **`/status` コマンドで確認する方法**: ターミナルで `codex` を対話モードで起動し、`/status` と入力すると現在のレートリミット状態が表示される
2. **TUI のステータスバーで確認する方法**: `codex` 対話モードの画面下部に `5h` と `wk` のゲージが表示される（`config.toml` で `status_line` に `"five-hour-limit"` と `"weekly-limit"` が含まれている場合）

## Step 3: 出力の読み方と報告

スクリプトの出力を解釈し、以下の形式でユーザーに報告する。

### 出力フィールドの意味

| フィールド | 意味 |
|---|---|
| `SOURCE` | `live` = app-server からリアルタイム取得、`snapshot` = セッション JSONL からの過去データ |
| `DATA_TIMESTAMP` | （snapshot のみ）データが記録された時刻 |
| `DATA_AGE_MINUTES` | （snapshot のみ）データの経過時間（分） |
| `PLAN_TYPE` | ChatGPT プランの種別（`plus`, `pro`, `prolite` 等） |
| `PRIMARY_USED_PERCENT` | **5時間枠**の消費率（%）。0 が未使用、100 で上限到達 |
| `PRIMARY_WINDOW_MINUTES` | 5時間枠のウィンドウ幅（通常 300 分） |
| `PRIMARY_RESETS_AT` | 5時間枠のリセット Unix タイムスタンプ |
| `PRIMARY_RESETS_AT_ISO` | （live のみ）5時間枠のリセット時刻（ISO 8601） |
| `PRIMARY_MINUTES_LEFT` | 5時間枠リセットまでの残り分数 |
| `PRIMARY_WINDOW_RESET` | （snapshot のみ）`true` なら取得時点以降に5時間枠がリセット済み |
| `SECONDARY_USED_PERCENT` | **週間枠**の消費率（%） |
| `SECONDARY_WINDOW_MINUTES` | 週間枠のウィンドウ幅（通常 10080 分 = 7日間） |
| `SECONDARY_RESETS_AT` | 週間枠のリセット Unix タイムスタンプ |
| `SECONDARY_RESETS_AT_ISO` | （live のみ）週間枠のリセット時刻（ISO 8601） |
| `SECONDARY_DAYS_LEFT` | 週間枠リセットまでの残り日数 |
| `SECONDARY_WINDOW_RESET` | （snapshot のみ）`true` なら取得時点以降に週間枠がリセット済み |
| `RATE_LIMIT_REACHED` | `none` 以外の場合、レートリミットに到達した種別 |
| `MODEL_*` | （live のみ）モデル別の消費率内訳（存在する場合） |

### 報告テンプレート

ユーザーへの報告は以下のように整理する:

```
Codex 残量レポート（<ライブ or スナップショット（記録時刻: DATA_TIMESTAMP）>）
プラン: <PLAN_TYPE>

5時間枠: <残り%>% 残り（<消費%>% 消費済み）
  リセット: <リセット時刻 ISO or 残り分数 or リセット済み>

週間枠: <残り%>% 残り（<消費%>% 消費済み）
  リセット: <リセット時刻 ISO or 残り日数 or リセット済み>
```

**SOURCE に応じた補足事項:**

- `SOURCE=live` の場合: 「リアルタイムのデータです」と付記する
- `SOURCE=snapshot` の場合: 「**最後の Codex セッション時点（DATA_AGE_MINUTES 分前）のスナップショットです。現在の値とは異なる可能性があります。**」と付記する
  - `PRIMARY_WINDOW_RESET=true` の場合: 「5時間枠は記録時点以降にリセット済みのため、現在の消費率はほぼ 0% と推定されます」と注記する
  - `SECONDARY_WINDOW_RESET=true` の場合、週間枠についても同様に注記する

**共通の補足事項:**

- `RATE_LIMIT_REACHED` が `none` 以外の場合: 「**レートリミット到達中**: <種別>」と警告する
- `MODEL_*` フィールドがある場合: モデル別の消費率も報告に含める

### 画像生成コスト警告

呼び出し元が画像生成目的の場合（image-gen-codex スキルから呼ばれた場合や、ユーザーが画像生成に言及した場合）は、以下の注意を追加する:

> Codex CLI の画像生成は通常のテキスト処理の 3〜5 倍のクォータを消費します。1枚の画像生成でおよそ 3〜5% の5時間枠を消費する目安です。

## 注意事項

- `~/.codex/auth.json` やトークン情報には**絶対にアクセスしない**こと。app-server が内部で認証を処理するため、スクリプトからトークンを直接読み取る必要はない
- Step 1 の app-server 方式は `fcntl` モジュール（Unix 系 OS のみ）を使用するため、macOS / Linux で動作する。Windows では Step 2 のフォールバックを使用すること
- Step 1 の app-server は常駐プロセスであり、スクリプトの `finally` ブロックで必ず `proc.kill()` している。万一スクリプトが異常終了した場合は `codex app-server` プロセスが残る可能性があるため、`ps aux | grep 'codex app-server'` で確認できる
- セッション JSONL の `rate_limits` データは Codex CLI が API レスポンスヘッダから取得して記録するもので、非公式ながら CLI v0.130.0 以降で安定して記録されている
- 5時間枠（primary）と週間枠（secondary）の2段構成は ChatGPT Plus/Pro 等のプランに共通する構造だが、プランによって上限値の大きさが異なる（消費率は %表記のため比較可能）
- app-server JSON-RPC のプロトコル詳細は `codex app-server generate-json-schema --out <dir>` で確認可能。`account/rateLimits/read` メソッドの仕様が変更された場合はスキーマを参照して更新すること
