# 組み込み: 人が Chrome で遊びながら録る

ゲームに録画ライブラリを入れ、URL に `?rec=1` を付けたときだけ録画パネルが出るようにする。
`?rec` が無ければ何もしない (DOM も localStorage も触らない) ので、通常プレイには影響しない。

## 1. ファイルをコピーする

公開ディレクトリの下に置く (例: `public/vendor/html-game-recorder/`)。**コピーしたファイルは直接編集しない**。
ゲームごとの違いは設定 (次の手順) で吸収する。

```bash
DEST=<公開ディレクトリ>/vendor/html-game-recorder
mkdir -p $DEST/hand
cp <スキルのパス>/assets/html-game-recorder.js <スキルのパス>/assets/hand-cursor.js $DEST/
cp <スキルのパス>/assets/hand/hand_idle.png <スキルのパス>/assets/hand/hand_tap.png $DEST/hand/
```

## 2. 録画する範囲を決める

- ゲーム画面を包む要素を 1 つ決める (例: `#game`)。録画パネルやデバッグ UI はその**外**に置く
- その要素に `isolation: isolate` を付ける (Element Capture の必須条件)
- 指の画像はその要素の**内側**に置かれる。外に置くと録画に写らない
- **canvas を直接指定しない**。canvas の子要素は描画されないため、指の画像を入れられない。
  body 直下に canvas だけがあるゲームは、canvas を包む要素を追加する
  - 画面サイズ合わせの処理が親要素の大きさを見ている場合、包む要素を足すと表示がずれることがある。
    包む要素にゲーム画面と同じ大きさを持たせ、追加前後でスクリーンショットを比べる

## 3. HTML に追加する

ゲーム本体のスクリプトより後、`</body>` の直前に置く。

```html
<!-- プレイ動画の録画 (html-game-recorder)。?rec=1 のときだけ録画パネルが出る。?hand=1 で指の画像を表示 -->
<script>
  window.HTML_GAME_RECORDER_CONFIG = {
    targetSelector: '#game',          // 録画する要素
    hideSelectors: ['#debug-fps'],    // 録画中だけ隠す要素 (範囲内の開発用表示など)
    letterboxColor: '#0a0716',        // 余白の色 (ゲームの背景色に合わせる)
    filePrefix: 'mygame'
  };
  window.HTML_GAME_HAND_CONFIG = {
    root: '#game',                    // 指の画像を入れる要素 (録画する要素と同じ)
    idleSrc: 'vendor/html-game-recorder/hand/hand_idle.png',
    tapSrc: 'vendor/html-game-recorder/hand/hand_tap.png'
  };
</script>
<script src="vendor/html-game-recorder/html-game-recorder.js" defer></script>
<script src="vendor/html-game-recorder/hand-cursor.js" defer></script>
```

`audio: 'page'` を使う場合 (タブ音声が使えない環境向け) は、ゲームが `AudioContext` を作る**前**に
読み込まれるよう、`defer` を外してゲーム本体より前に置く。

## 4. 使い方 (録画する人向け)

1. **Chrome** で `?rec=1&hand=1` を付けて開く (撮影モードを作った場合は `&level=N` も)
2. 左下のパネルで出力サイズを選び「● 録画開始」(または S キー)
3. 共有ダイアログで **「このタブ」** を選び、**「タブの音声も共有する」をオン**にする (オフだと無音)
4. 遊ぶ。停止ボタン (または S キー) で MP4 がダウンロードされる

対応ブラウザは実質デスクトップの Chrome / Edge (Element Capture は Chrome 132 以降)。

## 設定一覧

### `HTML_GAME_RECORDER_CONFIG`

| キー | 内容 | 既定 |
|---|---|---|
| `enabled` | true なら `?rec` 無しでも有効 (差し込み用) | false |
| `targetSelector` | 録画する要素。null ならタブ全体 | null |
| `hideSelectors` | 録画中だけ `visibility:hidden` にする要素 | [] |
| `fallback` | 要素だけを切り出せなかったとき `'tab'` (タブ全体を録る) / `'error'` (中止) | `'tab'` |
| `audio` | `'tab'` / `'page'` / `'none'` | `'tab'` |
| `ui` | 録画パネルを出すか | true |
| `hotkey` | 開始/停止キー。null で無効 | `'s'` |
| `sizes` | 出力サイズの候補 `[{value, w, h, label}]`。先頭が既定 | 1080x1920, 1080x1350 |
| `letterboxColor` | 余白の色 | body の背景色 |
| `fps` / `videoBitsPerSecond` / `audioBitsPerSecond` | 録画品質 | 30 / 6Mbps / 128kbps |
| `filePrefix` / `storageKey` | ファイル名の先頭 / サイズ選択を保存するキー | `gameplay` / `html-game-recorder.size` |

外部 API `window.HtmlGameRecorder`: `start({size})` (Promise) / `stop()` (書き出し後に結果を返す Promise) /
`isRecording()` / `getState()` / `computeDrawRect()` / `pickMime()`。

### `HTML_GAME_HAND_CONFIG`

| キー | 内容 | 既定 |
|---|---|---|
| `enabled` | true なら `?hand` 無しでも有効 | false |
| `root` | 指の画像を入れる要素 | body |
| `area` | 指を表示する範囲 (外では隠す) | `root` |
| `idleSrc` / `tapSrc` | 画像のパス | `assets/hand/hand_{idle,tap}.png` |
| `sizeRatio` | 指の大きさ = 表示範囲の高さ × この値 | 0.126 |
| `minTapMs` | 押した絵を最低これだけ出す (ms) | 120 |
| `idleTip` / `tapTip` | 画像内の指先位置 (比率)。画像を差し替えたら測り直す | 同梱画像の実測値 |
| `hideOsCursor` | 範囲内で OS のマウスカーソルを隠す | true |

指の画像は `position: fixed` で置く。録画する要素やその祖先に `transform` があると位置がずれるので、
その場合は `transform` の無い要素を `root` にする。

## 画像を差し替えたときの指先位置の測り方

指先方向の最遠点の近くにある不透明画素の重心を指先とする。

```python
from PIL import Image
import math
def tip(path, dirx, diry, thresh=60, radius=22):
    im = Image.open(path).convert('RGBA'); w, h = im.size
    a = im.split()[3].load()
    pts = [(x, y) for y in range(h) for x in range(w) if a[x, y] > thresh]
    n = math.hypot(dirx, diry); dx, dy = dirx / n, diry / n
    ex = max(pts, key=lambda p: p[0] * dx + p[1] * dy)
    near = [p for p in pts if (p[0]-ex[0])**2 + (p[1]-ex[1])**2 <= radius**2]
    cx = sum(p[0] for p in near) / len(near); cy = sum(p[1] for p in near) / len(near)
    print(path, {'x': round(cx / w, 4), 'y': round(cy / h, 4)})
tip('hand_idle.png', -1, -1)          # 同梱画像: 指が左上を向いている
tip('hand_tap.png', -0.905, -0.426)   # 同梱画像: 指が左やや上を向いている
```
