#!/usr/bin/env node
/* ===========================================================================
 * record.mjs — HTML ゲームを Playwright で開き、録画ライブラリを外から差し込んで録画する
 *
 * ゲーム側のファイルは一切変更しない (addInitScript で差し込む)。
 *
 *   node record.mjs --url http://127.0.0.1:8000/index.html --out ./videos \
 *     [--scenario ./scenario.mjs] [--duration 5] [--size 1080x1920] [--viewport 1080x1920] \
 *     [--target '#game'] [--hide '#debug,#fps'] [--no-hand] [--letterbox '#000'] \
 *     [--prefix mygame] [--wait-for 'window.game && window.game.ready'] [--audio page|tab|none] [--headed]
 *
 * --scenario には次の形のモジュールを渡す (省略時は --duration 秒だけ録る):
 *
 *   export default async function ({ page, hand, sleep, point, log }) {
 *     await hand.moveTo(540, 1200);          // 指を滑らかに移動 (CSS px, ビューポート座標)
 *     await hand.tap(540, 1200);             // 移動してタップ
 *     await hand.press(540, 1200, 800);      // 長押し (ms)
 *     await hand.drag([[100,100],[400,400]]);// ドラッグ
 *     const p = await point('#board', 0.5, 0.5); // 要素内の相対位置 → ビューポート座標
 *     await sleep(1000);
 *   }
 *
 * 録画の開始は台本の直前、停止は台本の直後。出力は --out に保存し、結果を JSON で表示する。
 * =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');

// ---------------- 引数 ----------------
function parseArgs(argv) {
  const a = { hand: true, duration: 5, size: '1080x1920', headed: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    switch (k) {
      case '--url': a.url = v; i++; break;
      case '--out': a.out = v; i++; break;
      case '--scenario': a.scenario = v; i++; break;
      case '--duration': a.duration = Number(v); i++; break;
      case '--size': a.size = v; i++; break;
      case '--viewport': a.viewport = v; i++; break;
      case '--target': a.target = v; i++; break;
      case '--hide': a.hide = v.split(',').map(s => s.trim()).filter(Boolean); i++; break;
      case '--letterbox': a.letterbox = v; i++; break;
      case '--prefix': a.prefix = v; i++; break;
      case '--wait-for': a.waitFor = v; i++; break;
      case '--hand-size': a.handSize = Number(v); i++; break;
      case '--audio': a.audio = v; i++; break;
      case '--no-hand': a.hand = false; break;
      case '--headed': a.headed = true; break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error('unknown option: ' + k);
    }
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url || !args.out) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).join('\n'));
  process.exit(args.help ? 0 : 1);
}
const [W, H] = (args.viewport || args.size).split('x').map(Number);

// ---------------- Playwright の読み込み (カレント → グローバルの順に探す) ----------------
async function loadPlaywright() {
  const tries = [path.join(process.cwd(), 'noop.js')];
  try { tries.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js')); } catch {}
  for (const base of tries) {
    try {
      const p = createRequire(base).resolve('playwright');
      return (await import(pathToFileURL(p).href)).default ?? (await import(pathToFileURL(p).href));
    } catch {}
  }
  throw new Error('playwright が見つかりません。npm i -D playwright か npm i -g playwright を実行してください');
}
const { chromium } = await loadPlaywright();

// ---------------- 差し込むスクリプト ----------------
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(path.join(ASSETS, 'hand', f)).toString('base64');
const recorderCfg = {
  enabled: true, ui: false, hotkey: null,
  // ヘッドレスではタブ音声が無音になるため、ページ内の音を直接集める
  audio: args.audio || 'page',
  targetSelector: args.target || null,
  hideSelectors: args.hide || [],
  letterboxColor: args.letterbox || null,
  filePrefix: args.prefix || 'gameplay',
  sizes: [{ value: args.size, w: +args.size.split('x')[0], h: +args.size.split('x')[1], label: args.size }]
};
const handCfg = {
  enabled: true, root: args.target || null,
  idleSrc: dataUrl('hand_idle.png'), tapSrc: dataUrl('hand_tap.png'),
  ...(args.handSize ? { sizeRatio: args.handSize } : {})
};
// iframe 内には差し込まない
const topOnly = src => `if (window.top === window) {\n${src}\n}`;
const initScripts = [
  topOnly(`window.HTML_GAME_RECORDER_CONFIG = ${JSON.stringify(recorderCfg)};`),
  topOnly(fs.readFileSync(path.join(ASSETS, 'html-game-recorder.js'), 'utf8'))
];
if (args.hand) {
  initScripts.push(topOnly(`window.HTML_GAME_HAND_CONFIG = ${JSON.stringify(handCfg)};`));
  initScripts.push(topOnly(fs.readFileSync(path.join(ASSETS, 'hand-cursor.js'), 'utf8')));
}

// ---------------- 起動 ----------------
const browser = await chromium.launch({
  headless: !args.headed,
  channel: process.env.HGREC_CHANNEL || undefined,
  // Playwright は既定で --mute-audio を付ける。付いたままだとタブ音声が無音になる
  ignoreDefaultArgs: ['--mute-audio'],
  args: [
    '--use-fake-ui-for-media-stream',      // 共有ピッカーを自動承認 (必須)
    '--auto-accept-this-tab-capture',      // preferCurrentTab を無確認で許可
    '--autoplay-policy=no-user-gesture-required',
    // GPU 無しだと 1080x1920 の描画/エンコードが追いつかず録画が壊れる
    '--enable-gpu', '--ignore-gpu-blocklist',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])
  ]
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', e => console.error('[pageerror]', e.message));
for (const s of initScripts) await page.addInitScript(s);

await page.goto(args.url, { waitUntil: 'load' });
if (args.waitFor) await page.waitForFunction(args.waitFor, null, { timeout: 30000 });
await page.waitForTimeout(800);

// ---------------- 台本用ヘルパー ----------------
const sleep = ms => page.waitForTimeout(ms);
let cur = { x: W / 2, y: H * 0.75 };
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const hand = {
  // 人の手らしく ease-in-out で移動する
  async moveTo(x, y, { ms = 350 } = {}) {
    const from = { ...cur }, steps = Math.max(2, Math.round(ms / 16)), t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      const wait = t0 + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
    cur = { x, y };
  },
  async tap(x, y, { move = 350, hold = 90 } = {}) {
    await hand.moveTo(x, y, { ms: move });
    await page.mouse.down(); await sleep(hold); await page.mouse.up();
  },
  async press(x, y, ms, { move = 350 } = {}) {
    await hand.moveTo(x, y, { ms: move });
    await page.mouse.down(); await sleep(ms); await page.mouse.up();
  },
  async drag(points, { move = 350, segMs = 250 } = {}) {
    const [first, ...rest] = points;
    await hand.moveTo(first[0], first[1], { ms: move });
    await page.mouse.down();
    for (const [x, y] of rest) await hand.moveTo(x, y, { ms: segMs });
    await page.mouse.up();
  }
};
// 要素内の相対位置 (0〜1) をビューポート座標にする
async function point(selector, fx = 0.5, fy = 0.5) {
  const r = await page.locator(selector).first().boundingBox();
  if (!r) throw new Error('element not found: ' + selector);
  return [r.x + r.width * fx, r.y + r.height * fy];
}
const log = (...m) => console.log('[scenario]', ...m);

// 手を最初から画面内に出しておく (1フレーム目から指が映るように)
if (args.hand) await page.mouse.move(cur.x, cur.y);

// ---------------- 録画 ----------------
fs.mkdirSync(args.out, { recursive: true });
const startState = await page.evaluate(size => window.HtmlGameRecorder.start({ size }), args.size);
console.log('[record] start', JSON.stringify({ captureMode: startState.captureMode, mime: startState.mime }));
const t0 = Date.now();
if (args.scenario) {
  const mod = await import(pathToFileURL(path.resolve(args.scenario)).href);
  await mod.default({ page, hand, sleep, point, log, viewport: { width: W, height: H } });
} else {
  await sleep(args.duration * 1000);
}
await sleep(300); // 最後の動きが確実に入るよう少し余韻を残す
const [download, file] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.evaluate(() => window.HtmlGameRecorder.stop())
]);
const outPath = path.join(args.out, download.suggestedFilename());
await download.saveAs(outPath);
const endState = await page.evaluate(() => window.HtmlGameRecorder.getState());
await browser.close();

// ---------------- 結果 ----------------
const result = {
  file: outPath, bytes: file && file.size, mime: file && file.mime,
  captureMode: startState.captureMode, frames: endState.lastFile && endState.lastFile.frames,
  wallSeconds: +((Date.now() - t0) / 1000).toFixed(1)
};
try {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', outPath], { encoding: 'utf8' });
  const j = JSON.parse(probe);
  result.duration = +Number(j.format.duration).toFixed(2);
  result.streams = j.streams.map(s => s.codec_type + ':' + s.codec_name + (s.width ? ` ${s.width}x${s.height}` : ''));
} catch { result.note = 'ffprobe が無いため動画の中身は未確認'; }
console.log(JSON.stringify(result, null, 2));
