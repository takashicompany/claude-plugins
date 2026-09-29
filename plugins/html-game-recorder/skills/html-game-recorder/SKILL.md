---
name: html-game-recorder
description: HTML ブラウザゲーム (Canvas/DOM) のプレイ動画を、ゲーム画面だけ・音声込みで 1080x1920 (9:16) などの縦動画 MP4 として録画する。AI が Playwright でゲームを操作してヘッドレスで撮る「差し込み」と、ゲームに録画機能を組み込んで人が遊びながら撮る「組み込み」の2通りに対応。操作を見せる指 (手カーソル) の画像も映せる。広告動画・ストア用動画・SNS 用動画・プレイ動画を撮りたい、ゲームに録画機能を入れたい、という依頼のときに使う。
---

# HTML ゲーム録画 (html-game-recorder)

HTML ゲームのプレイ動画を、**ゲーム画面だけ・ゲームの音声込み**で縦動画 MP4 にする。

| 使い方 | 撮る人 | ゲームへの変更 | 詳細 |
|---|---|---|---|
| **差し込み** (既定) | AI (Playwright・ヘッドレス) | **なし**。撮影時に外からスクリプトを差し込む | このファイル |
| **組み込み** | 人 (Chrome で遊びながら) | 録画用ファイルを追加。必要なら撮影モード | `references/embed.md` |

ユーザーが「人が撮れるようにしたい」「ゲームに録画ボタンを付けたい」と言った場合だけ組み込みを行う。
それ以外 (「動画を撮って」「広告動画が欲しい」) は差し込みで AI が撮る。

## 同梱物

```
assets/html-game-recorder.js   録画ライブラリ (両方の使い方で共通)
assets/hand-cursor.js          指の画像をポインタに追従させるライブラリ
assets/hand/hand_{idle,tap}.png 指の画像 (伸ばした指 / 押している指, 512x512)
scripts/record.mjs             差し込みで録画する Playwright スクリプト
references/embed.md            組み込み手順・設定一覧
references/recording-mode.md   ゲーム側の「撮影モード」の作り方 (組み込み時)
references/verify.md           出力の検証・ffmpeg での加工・広告の入稿サイズ
```

## 差し込みで AI が撮る手順

### 1. 前提の確認

- Node.js と Playwright (`npx playwright --version`)。無ければ `npm i -g playwright && npx playwright install chromium`
- ffmpeg / ffprobe (検証に使う。無ければ検証だけ省略して、その旨を報告する)
- ゲームをブラウザで開ける URL。ローカルなら静的サーバーを立てる (例: `python3 -m http.server 8000 --bind 127.0.0.1`)。
  他のプロセスが使っているポートは避け、撮影後に自分で立てたサーバーは止める

### 2. ゲームを理解する

コードを読み、次を把握する。

- 操作方法 (タップ / 長押し / ドラッグ / キー) と、その座標の求め方
- ゲームの状態を JS から読めるか (例: `window.game`)。読めれば、盤面・正解・クリア判定を台本で使える
- レベルの指定方法 (URL パラメータ、グローバル関数など)。無ければ最初の面から遊ぶ
- 見せ場 (クリア演出、失敗、コンボなど)

### 3. 台本 (scenario) を書く

台本は ES モジュールで、既定エクスポートの関数に次のヘルパーが渡される。
座標はすべて **ビューポートの CSS px** (既定のビューポートは出力サイズと同じ 1080x1920)。

| ヘルパー | 内容 |
|---|---|
| `hand.moveTo(x, y, {ms})` | 指を ease-in-out で滑らかに移動 (既定 350ms) |
| `hand.tap(x, y, {move, hold})` | 移動してタップ |
| `hand.press(x, y, ms)` | 移動して長押し |
| `hand.drag([[x,y], ...], {segMs})` | ドラッグ |
| `point(selector, fx, fy)` | 要素内の相対位置 (0〜1) → ビューポート座標 |
| `sleep(ms)` / `page` / `log` / `viewport` | 待機 / Playwright の Page / ログ / ビューポートサイズ |

```js
// scenario.mjs の例
export default async function ({ page, hand, sleep, point }) {
  await page.evaluate(() => window.game.startLevel(3));   // 撮りたい面へ
  await sleep(600);
  const [x, y] = await point('#board', 0.5, 0.7);
  await hand.tap(x, y);
  await page.waitForFunction(() => window.game.cleared, null, { timeout: 30000 });
  await sleep(1500);                                        // クリア演出を映す
}
```

**撮り方のコツ** (広告・宣伝用):
- 冒頭 1〜2 秒で何のゲームか分かる盤面から始める
- 失敗 → 立て直し → 成功 の流れや、クリア演出を必ず入れる
- 指の移動は速すぎると瞬間移動に見える。`moveTo` の既定 (350ms) 程度を保つ
- 1 本 15〜30 秒を目安にし、長い面は見せ場だけを撮る
- 台本の中でレベルを変えられるなら、同じ台本で複数の面を撮り分けられる

### 4. 録画する

```bash
node <このスキルのパス>/scripts/record.mjs \
  --url 'http://127.0.0.1:8000/index.html' \
  --out ./videos \
  --scenario ./scenario.mjs \
  --wait-for 'window.game && window.game.ready' \
  --prefix mygame
```

| オプション | 内容 | 既定 |
|---|---|---|
| `--size` | 出力サイズ | `1080x1920` |
| `--viewport` | ブラウザの表示サイズ。ゲーム画面の比率が出力と違うときに調整 | `--size` と同じ |
| `--duration` | 台本なしのときの録画秒数 | 5 |
| `--target` | この要素だけを録る (Element Capture)。省略時はビューポート全体 | なし |
| `--hide` | 録画中だけ隠す要素 (カンマ区切りのセレクタ) | なし |
| `--no-hand` | 指の画像を出さない | 出す |
| `--hand-size` | 指の大きさ (表示範囲の高さに対する比率) | 0.126 |
| `--letterbox` | 余白の色 | body の背景色 |
| `--audio` | `page` / `tab` / `none` | `page` |
| `--wait-for` | 録画開始前に真になるまで待つ JS 式 | なし |

結果は JSON で表示される (保存先、長さ、解像度、コーデック、フレーム数)。
その後 `references/verify.md` の手順で**音声・フレームを必ず確認**してから報告する。

### 5. 報告

保存先、長さ、解像度、音声の有無 (max_volume)、確認した静止画の内容を伝える。
ファイルは開かずにパスを示す。

## 仕組みと落とし穴 (実測済み)

- 録画は `getDisplayMedia` (このタブ) → 出力解像度の canvas に contain フィットで描き直し →
  `MediaRecorder` で MP4 (H.264 High + AAC-LC)。ゲーム画面は切り落とさず、比率の違いは余白で埋める
- Chromium の起動フラグ `--use-fake-ui-for-media-stream` と `--auto-accept-this-tab-capture` で、
  共有ダイアログなしで録画が始まる (record.mjs が設定済み)
- **ヘッドレスではタブ音声が無音になる** (Playwright 既定の `--mute-audio` を外しても、新しいヘッドレスでも無音)。
  そのため差し込みでは `audio: 'page'` を使う。ページ内の Web Audio と `<audio>/<video>` の出力を直接集める方式で、
  ゲームが `AudioContext` を作る前にフックする必要がある (差し込みは addInitScript なので最初から満たす)
- **GPU フラグが無いとヘッドレスの 1080x1920 録画が破綻する** (数フレームで止まる)。record.mjs は macOS で
  `--use-angle=metal` などを付ける。Linux などで破綻したら `--size 720x1280` に下げる
- 重い場面が長く続くとフレームレートが 30fps を下回ることがある (実測で 60 秒の重い面が平均 24fps)。
  見せ場ごとに短く分けて撮る
- 指の画像は `pointermove` / `pointerdown` を拾って動く。Playwright の `page.mouse` の操作で動くが、
  `page.click()` や `locator.click()` は一瞬で移動するため台本では `hand.*` を使う
