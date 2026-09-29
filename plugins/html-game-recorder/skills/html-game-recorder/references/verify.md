# 検証と加工

## 撮った動画の検証 (報告前に必ず行う)

```bash
F=videos/xxx.mp4
# 解像度・コーデック・長さ
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration -of compact "$F"
# 音声が入っているか (-91 dB 前後は無音)
ffmpeg -hide_banner -i "$F" -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
# 時間ごとの音量 (途中で無音になっていないか)
for t in 0 5 10 15 20; do printf "t=%2ds " $t; ffmpeg -hide_banner -ss $t -t 3 -i "$F" -af volumedetect -f null - 2>&1 | grep -o "max_volume.*"; done
# 静止画を抜いて目視 (指・ゲーム画面の上下端・余白の色・余計な UI が写っていないか)
for t in 1 5 10; do ffmpeg -v error -y -ss $t -i "$F" -frames:v 1 -vf scale=270:-1 frame_$t.png; done
```

見るべき点:
- 指の画像が操作位置に出ている
- ゲーム画面の上端 (HUD) と下端が両方入っている。余白は指定色
- 録画パネル・デバッグ表示・ブラウザの UI が写っていない
- 音声の max_volume が無音 (-91 dB 前後) でない。音の無いゲームなら無音でよい

## 組み込み時の追加確認

1. `?rec` なし: `window.HtmlGameRecorder` が undefined、パネルが無い、コンソールエラーが無い
2. `?rec=1`: パネルが出る。サイズの選択が再読み込み後も残る
3. `?rec=1&hand=1`: 指が要素内でだけ表示される
4. Playwright で録る場合は、パネルのボタンをクリックすれば人と同じ流れで試せる
   (起動フラグ `--use-fake-ui-for-media-stream --auto-accept-this-tab-capture`)。
   ヘッドレスではタブ音声が無音になるので、音声の確認は `audio: 'page'` にするか人が行う

## ffmpeg での加工

```bash
# 入稿容量を抑える再圧縮 (H.264 High / AAC / faststart)
ffmpeg -i in.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow \
  -c:a aac -b:a 128k -movflags +faststart out.mp4

# 9:16 から 4:5 / 1:1 を切り出す (4 番目の値が上端からの位置。HUD が切れるなら小さくする)
ffmpeg -i in_1080x1920.mp4 -vf "crop=1080:1350:0:285" -c:a copy out_4x5.mp4
ffmpeg -i in_1080x1920.mp4 -vf "crop=1080:1080:0:420" -c:a copy out_1x1.mp4

# 区間の切り出し / 早回し
ffmpeg -ss 3 -to 18 -i in.mp4 -c:v libx264 -crf 20 -c:a aac out_cut.mp4
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=PTS/1.25[v];[0:a]atempo=1.25[a]" -map "[v]" -map "[a]" out_fast.mp4

# 静止画 (サムネイル)
ffmpeg -ss 5 -i in.mp4 -frames:v 1 thumb.png

# WebM で録れてしまった場合の MP4 化
ffmpeg -i in.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart out.mp4
```

**原則 9:16 (1080x1920) で撮る**。全体が入っているので、4:5 や 1:1 は後から切り出せる。録画時に切ると戻せない。

## 入稿先ごとの縦動画の目安 (必ず入稿先の最新の公式情報で確認する)

| 入稿先 | 主な比率 | メモ |
|---|---|---|
| Meta フィード | 4:5 (1080x1350) | 9:16 だと上下が切られる |
| Meta Reels / Stories | 9:16 | 上下端に UI が重なる。大事な情報は中央 80% に |
| TikTok / YouTube Shorts | 9:16 | 短尺中心 |
| Google App キャンペーン | 9:16 と 16:9 | 両方あると配信面が広がる |
| Unity Ads / AppLovin / ironSource | 9:16 | 15〜30 秒。容量制限がきつい枠がある |

共通の基本形: MP4 / H.264 (High, yuv420p) / AAC-LC / 30fps / `+faststart`。
