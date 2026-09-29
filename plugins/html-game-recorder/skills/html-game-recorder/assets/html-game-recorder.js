/* ===========================================================================
 * html-game-recorder.js — HTML ゲームのプレイ動画録画 (html-game-recorder プラグイン)
 *
 * 有効になる条件 (どちらか):
 *   - URL に ?rec=1 / ?rec=true が付いている               … ゲームに組み込んで人が録る場合
 *   - window.HTML_GAME_RECORDER_CONFIG.enabled === true     … Playwright から差し込んで AI が録る場合
 * それ以外では何もしない (DOM も localStorage も触らない) ので、通常プレイへの影響はない。
 *
 * 仕組み:
 *   1. getDisplayMedia で「このタブ」の映像 + タブ音声を取得
 *   2. targetSelector があれば Element Capture (RestrictionTarget) でその要素だけに絞る
 *      → 非対応なら Region Capture (CropTarget) → それも無理なら fallback 設定に従う
 *   3. 取得した映像を「出力解像度の canvas」に毎フレーム描き直す (常に contain フィット)
 *   4. canvas.captureStream() + タブ音声 を MediaRecorder で録画
 *   5. 停止したら MP4 (非対応環境は WebM) としてダウンロード
 *
 * 設定は window.HTML_GAME_RECORDER_CONFIG (このファイルより前に定義する)。
 * 外部 API は window.HtmlGameRecorder。詳細はプラグインの SKILL.md を参照。
 * =========================================================================== */
(function () {
  'use strict';

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  var CFG = window.HTML_GAME_RECORDER_CONFIG || {};
  var recParam = qs('rec');
  if (!(CFG.enabled === true || recParam === '1' || recParam === 'true')) return;
  if (window.HtmlGameRecorder) return; // 二重読み込み防止

  // ---------------- 設定 ----------------
  // 録画する要素。null なら要素で絞らずタブ (ビューポート) 全体を録る
  var TARGET_SELECTOR = CFG.targetSelector || null;
  // 録画中だけ隠す要素 (レイアウトを崩さないよう visibility:hidden にする)
  var HIDE_SELECTORS = CFG.hideSelectors || [];
  // 要素で絞れなかったときの扱い: 'tab' = タブ全体を録る / 'error' = 録画しない
  var FALLBACK = CFG.fallback || 'tab';
  var SHOW_UI = CFG.ui !== false;
  // 録画の開始/停止キー。null で無効
  var HOTKEY = CFG.hotkey === undefined ? 's' : CFG.hotkey;
  var FPS = CFG.fps || 30;
  var VIDEO_BPS = CFG.videoBitsPerSecond || 6000000;
  var AUDIO_BPS = CFG.audioBitsPerSecond || 128000;
  var FILE_PREFIX = CFG.filePrefix || 'gameplay';
  var LS_KEY = CFG.storageKey || 'html-game-recorder.size';
  // 出力比とゲーム画面の比が違うときに出る余白の色。未指定なら body の背景色
  var PAD_COLOR = CFG.letterboxColor || null;
  var SIZES = CFG.sizes || [
    { value: '1080x1920', w: 1080, h: 1920, label: '1080x1920 (9:16)' },
    { value: '1080x1350', w: 1080, h: 1350, label: '1080x1350 (4:5)' }
  ];
  // 音声の取り方:
  //   'tab'  … getDisplayMedia のタブ音声 (人が Chrome で録る場合。ヘッドレスでは無音になる)
  //   'page' … ページ内の Web Audio / <audio><video> の出力を直接集める (ヘッドレスでも録れる。
  //            ゲームが AudioContext を作る前にこのファイルが読み込まれている必要がある)
  //   'none' … 音声なし
  var AUDIO_MODE = CFG.audio || 'tab';

  // ---------------- ページ音声の収集 (audio: 'page') ----------------
  // AudioNode.connect をフックし、destination (スピーカー) へ繋がれた音を
  // コンテキストごとの MediaStreamDestination にも流す。再生音そのものは変えない。
  var pageAudio = { streams: [], mix: null, mixDest: null, sources: [] };
  function installPageAudioHook() {
    if (typeof AudioNode === 'undefined' || AudioNode.prototype.__hgrecHooked) return;
    var origConnect = AudioNode.prototype.connect;
    var origDisconnect = AudioNode.prototype.disconnect;
    var taps = new Map();
    function tapFor(ctx) {
      var t = taps.get(ctx);
      if (!t) {
        t = ctx.createMediaStreamDestination();
        taps.set(ctx, t);
        addPageStream(t.stream);
      }
      return t;
    }
    AudioNode.prototype.connect = function (dest, output) {
      var r = origConnect.apply(this, arguments);
      try {
        if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
          origConnect.call(this, tapFor(this.context), output || 0);
        }
      } catch (e) {}
      return r;
    };
    AudioNode.prototype.disconnect = function (dest) {
      var r = origDisconnect.apply(this, arguments);
      try {
        if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
          var t = taps.get(this.context);
          if (t) origDisconnect.call(this, t);
        }
      } catch (e) {}
      return r;
    };
    AudioNode.prototype.__hgrecHooked = true;
    // <audio> / <video> 要素の音
    document.addEventListener('play', function (e) {
      var el = e.target;
      if (!el || el.__hgrecCaptured || !el.captureStream) return;
      try { el.__hgrecCaptured = true; addPageStream(el.captureStream()); } catch (err) {}
    }, true);
  }
  function addPageStream(stream) {
    pageAudio.streams.push(stream);
    if (pageAudio.mix) connectToMix(stream);
  }
  function connectToMix(stream) {
    if (!stream.getAudioTracks().length) return;
    try {
      var src = pageAudio.mix.createMediaStreamSource(stream);
      src.connect(pageAudio.mixDest);
      pageAudio.sources.push(src);
    } catch (e) {}
  }
  function openPageMix() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    pageAudio.mix = ctx;
    pageAudio.mixDest = ctx.createMediaStreamDestination();
    pageAudio.streams.forEach(connectToMix);
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return pageAudio.mixDest.stream.getAudioTracks();
  }
  function closePageMix() {
    pageAudio.sources.forEach(function (s) { try { s.disconnect(); } catch (e) {} });
    pageAudio.sources = [];
    if (pageAudio.mix) { try { pageAudio.mix.close(); } catch (e) {} }
    pageAudio.mix = null; pageAudio.mixDest = null;
  }
  if (AUDIO_MODE === 'page') installPageAudioHook();

  // ---------------- 描画矩形 (常に contain フィット。画面を切り落とさない) ----------------
  function computeDrawRect(srcW, srcH, dstW, dstH) {
    if (!srcW || !srcH) return { x: 0, y: 0, w: dstW, h: dstH };
    var scale = Math.min(dstW / srcW, dstH / srcH);
    var w = srcW * scale, h = srcH * scale;
    return { x: (dstW - w) / 2, y: (dstH - h) / 2, w: w, h: h };
  }

  // ---------------- MIME 選定 (MP4 優先、非対応は WebM) ----------------
  var MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try { if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i]; } catch (e) {}
    }
    return '';
  }
  function extFor(mime) { return (mime && mime.indexOf('mp4') >= 0) ? 'mp4' : 'webm'; }
  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function padColor() {
    if (PAD_COLOR) return PAD_COLOR;
    var bg = getComputedStyle(document.body).backgroundColor;
    return (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') ? '#000' : bg;
  }

  // ---------------- 状態 ----------------
  // phase: 'idle' | 'starting' | 'recording' | 'stopping'
  var state = {
    phase: 'idle',
    displayStream: null, canvasStream: null, recorder: null, chunks: [],
    video: null, canvas: null, rafId: 0, vfcHandle: 0,
    startedAt: 0, timerId: 0, mime: '', captureMode: '', activeSize: null,
    recorderError: '', lastError: '', frames: 0, lastFile: null,
    stopWaiters: []
  };

  // ---------------- UI ----------------
  var ui = {};
  function injectStyle() {
    var css = [];
    if (HIDE_SELECTORS.length) {
      css.push('html.hgrec-on ' + HIDE_SELECTORS.join(',html.hgrec-on ') + '{visibility:hidden !important}');
    }
    if (SHOW_UI) css.push(
      '#hgrec-panel{position:fixed;left:8px;bottom:8px;z-index:2147483000;',
      'font:11px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.72);',
      'border:1px solid rgba(255,255,255,.28);border-radius:6px;padding:6px 7px;',
      'display:flex;flex-direction:column;gap:5px;max-width:190px}',
      '#hgrec-panel select,#hgrec-panel button{font:11px system-ui,sans-serif;width:100%}',
      '#hgrec-panel button{padding:4px 6px;cursor:pointer;border:0;border-radius:4px;',
      'background:#e0343c;color:#fff;font-weight:bold}',
      '#hgrec-panel button.rec{background:#666}',
      '#hgrec-status{display:flex;align-items:center;gap:5px;color:#ffd0d0}',
      '#hgrec-dot{width:8px;height:8px;border-radius:50%;background:#e0343c;display:none;',
      'animation:hgrec-blink 1s steps(2,start) infinite}',
      '#hgrec-panel.on #hgrec-dot{display:block}',
      '@keyframes hgrec-blink{50%{opacity:.15}}',
      '#hgrec-note{color:#ffd76a;display:none;word-break:break-word}',
      '#hgrec-note.show{display:block}'
    );
    if (!css.length) return;
    var s = document.createElement('style');
    s.id = 'hgrec-style';
    s.textContent = css.join('');
    document.head.appendChild(s);
  }

  function buildUI() {
    injectStyle();
    if (HOTKEY) {
      // keydown はユーザー操作扱いになり、getDisplayMedia の起動条件を満たす
      window.addEventListener('keydown', function (e) {
        if (e.key.toLowerCase() !== String(HOTKEY).toLowerCase()) return;
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        toggle();
      });
    }
    if (!SHOW_UI) return;

    var panel = document.createElement('div');
    panel.id = 'hgrec-panel';
    var sel = document.createElement('select');
    sel.id = 'hgrec-size';
    SIZES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.value; o.textContent = s.label;
      sel.appendChild(o);
    });
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    if (saved && SIZES.some(function (s) { return s.value === saved; })) sel.value = saved;
    sel.addEventListener('change', function () { try { localStorage.setItem(LS_KEY, sel.value); } catch (e) {} });

    var btn = document.createElement('button');
    btn.id = 'hgrec-btn'; btn.type = 'button'; btn.textContent = '● 録画開始';
    btn.addEventListener('click', toggle);

    var status = document.createElement('div');
    status.id = 'hgrec-status';
    var dot = document.createElement('span'); dot.id = 'hgrec-dot';
    var text = document.createElement('span'); text.id = 'hgrec-text'; text.textContent = '待機中';
    status.appendChild(dot); status.appendChild(text);
    var note = document.createElement('div'); note.id = 'hgrec-note';

    panel.appendChild(sel); panel.appendChild(btn); panel.appendChild(status); panel.appendChild(note);
    document.body.appendChild(panel);
    ui = { panel: panel, sel: sel, btn: btn, text: text, note: note };
    if (!pickMime()) setNote('この環境では MediaRecorder が使えません');
  }

  function setNote(msg) {
    if (!ui.note) return;
    ui.note.textContent = msg || '';
    ui.note.classList.toggle('show', !!msg);
  }
  function setText(msg) { if (ui.text) ui.text.textContent = msg; }
  function syncUI() {
    if (!ui.panel) return;
    var rec = state.phase === 'recording';
    ui.panel.classList.toggle('on', rec);
    ui.btn.textContent = rec ? '■ 停止' : '● 録画開始';
    ui.btn.classList.toggle('rec', rec);
    ui.btn.disabled = state.phase === 'starting' || state.phase === 'stopping';
    ui.sel.disabled = state.phase !== 'idle';
  }

  function findSize(value) {
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i].value === value) return SIZES[i];
    var m = /^(\d+)x(\d+)$/.exec(value || '');
    if (m) return { value: value, w: +m[1], h: +m[2], label: value };
    return null;
  }
  function currentSize() {
    return (ui.sel && findSize(ui.sel.value)) || SIZES[0];
  }

  // ---------------- 録画対象の絞り込み ----------------
  function restrictToTarget(track, el) {
    if (!el) return Promise.resolve('tab');
    if (typeof window.RestrictionTarget !== 'undefined' &&
        window.RestrictionTarget.fromElement && track.restrictTo) {
      return window.RestrictionTarget.fromElement(el)
        .then(function (rt) { return track.restrictTo(rt); })
        .then(function () { return 'element'; })
        .catch(function () { return regionFallback(track, el); });
    }
    return regionFallback(track, el);
  }
  function regionFallback(track, el) {
    if (typeof window.CropTarget !== 'undefined' && window.CropTarget.fromElement && track.cropTo) {
      return window.CropTarget.fromElement(el)
        .then(function (ct) { return track.cropTo(ct); })
        .then(function () { return 'region'; })
        .catch(function () { return 'tab'; });
    }
    return Promise.resolve('tab');
  }

  // ---------------- 描画ループ ----------------
  function startDrawLoop(size) {
    var canvas = document.createElement('canvas');
    canvas.width = size.w; canvas.height = size.h;
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    state.canvas = canvas;
    var v = state.video, pad = padColor();
    state.frames = 0;
    function draw() {
      state.frames++;
      ctx.fillStyle = pad;
      ctx.fillRect(0, 0, size.w, size.h);
      if (v.videoWidth && v.videoHeight) {
        var r = computeDrawRect(v.videoWidth, v.videoHeight, size.w, size.h);
        try { ctx.drawImage(v, r.x, r.y, r.w, r.h); } catch (e) {}
      }
    }
    draw(); // captureStream が空にならないよう 1 枚目を即描く
    if (v.requestVideoFrameCallback) {
      var onFrame = function () {
        draw();
        if (state.phase === 'recording') state.vfcHandle = v.requestVideoFrameCallback(onFrame);
      };
      state.vfcHandle = v.requestVideoFrameCallback(onFrame);
    } else {
      var tick = function () {
        draw();
        if (state.phase === 'recording') state.rafId = requestAnimationFrame(tick);
      };
      state.rafId = requestAnimationFrame(tick);
    }
    return canvas;
  }

  function waitForFrame(v) {
    return new Promise(function (resolve) {
      var tries = 0;
      (function check() {
        if (v.videoWidth && v.videoHeight) return resolve();
        if (++tries > 120) return resolve();
        requestAnimationFrame(check);
      })();
    });
  }

  // ---------------- 開始 ----------------
  // opts.size: '1080x1920' のような文字列 (省略時はパネルの選択 or 先頭)
  function start(opts) {
    opts = opts || {};
    if (state.phase !== 'idle') return Promise.reject(new Error('busy: ' + state.phase));
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setNote('getDisplayMedia 非対応の環境です');
      return Promise.reject(new Error('getDisplayMedia unsupported'));
    }
    var mime = pickMime();
    if (mime === null) {
      setNote('MediaRecorder 非対応の環境です');
      return Promise.reject(new Error('MediaRecorder unsupported'));
    }
    var size = (opts.size && findSize(opts.size)) || currentSize();
    var el = null;
    if (TARGET_SELECTOR) {
      el = document.querySelector(TARGET_SELECTOR);
      if (!el) {
        var msg = '録画対象の要素が見つかりません: ' + TARGET_SELECTOR;
        setNote(msg);
        return Promise.reject(new Error(msg));
      }
    }
    state.phase = 'starting';
    state.lastError = '';
    state.activeSize = size;
    setNote(''); setText('共有ダイアログを確認…'); syncUI();

    return navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: AUDIO_MODE === 'tab' ? { suppressLocalAudioPlayback: false } : false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      monitorTypeSurfaces: 'exclude',
      systemAudio: 'exclude'
    }).then(function (stream) {
      state.displayStream = stream;
      var vTrack = stream.getVideoTracks()[0];
      if (!vTrack) throw new Error('映像トラックが取得できませんでした');
      vTrack.addEventListener('ended', function () { if (state.phase === 'recording') stop(); });
      return restrictToTarget(vTrack, el).then(function (mode) {
        if (el && mode === 'tab' && FALLBACK === 'error') {
          throw new Error('要素だけを切り出せませんでした (fallback: error)');
        }
        state.captureMode = mode;
      });
    }).then(function () {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.srcObject = new MediaStream(state.displayStream.getVideoTracks());
      v.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(v);
      state.video = v;
      return v.play().then(function () { return waitForFrame(v); });
    }).then(function () {
      state.phase = 'recording';
      document.documentElement.classList.add('hgrec-on');
      var out = startDrawLoop(size).captureStream(FPS);
      var audioTracks = AUDIO_MODE === 'tab' ? state.displayStream.getAudioTracks()
        : AUDIO_MODE === 'page' ? openPageMix() : [];
      audioTracks.forEach(function (t) { out.addTrack(t); });
      state.audioTracks = audioTracks.length;
      state.canvasStream = out;
      state.mime = pickMime();
      var ropts = { videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS };
      if (state.mime) ropts.mimeType = state.mime;
      var rec = new MediaRecorder(out, ropts);
      state.recorder = rec;
      state.chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) state.chunks.push(e.data); };
      rec.onstop = finalize;
      rec.onerror = function (e) {
        var name = (e && e.error && e.error.name) || (e && e.name) || 'unknown';
        state.recorderError = name;
        setNote('録画エラー: ' + name + ' (解像度やビットレートを下げてください)');
        if (state.phase === 'recording') stop();
      };
      state.recorderError = '';
      rec.start(1000);
      state.startedAt = Date.now();
      tickTimer();
      state.timerId = setInterval(tickTimer, 250);
      syncUI();
      if (state.captureMode === 'tab' && el) {
        setNote('警告: 要素の切り出しに失敗。タブ全体を録画中のため、録画パネルも映像に入ります');
      } else if (state.captureMode === 'region') {
        setNote('Region Capture で録画中 (要素に重なる UI も映ります)');
      }
      console.log('[html-game-recorder] start ' + size.w + 'x' + size.h + ' mode=' + state.captureMode +
        ' mime=' + (state.mime || '(default)') + ' audio=' + AUDIO_MODE + '(' + state.audioTracks + ')');
      return api.getState();
    }).catch(function (err) {
      cleanup();
      state.phase = 'idle';
      state.lastError = String(err && err.message || err);
      setText('待機中');
      setNote('開始できませんでした: ' + (err && err.name ? err.name + ' ' : '') + state.lastError);
      syncUI();
      throw err;
    });
  }

  function tickTimer() {
    if (state.phase !== 'recording') return;
    var sec = (Date.now() - state.startedAt) / 1000;
    setText('REC ' + sec.toFixed(1) + 's / ' + state.activeSize.w + 'x' + state.activeSize.h);
  }

  // ---------------- 停止 ----------------
  // 書き出し (ダウンロード) が終わったら lastFile を返す Promise
  function stop() {
    if (state.phase !== 'recording') return Promise.reject(new Error('not recording: ' + state.phase));
    state.phase = 'stopping';
    if (state.timerId) { clearInterval(state.timerId); state.timerId = 0; }
    setText('書き出し中…'); syncUI();
    var p = new Promise(function (resolve) { state.stopWaiters.push(resolve); });
    try {
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
      else finalize();
    } catch (e) { finalize(); }
    return p;
  }
  function toggle() {
    if (state.phase === 'recording') stop().catch(function () {});
    else if (state.phase === 'idle') start().catch(function () {});
  }

  function finalize() {
    var chunks = state.chunks;
    state.chunks = [];
    var mime = state.mime || (chunks[0] && chunks[0].type) || 'video/webm';
    var size = state.activeSize;
    var blob = new Blob(chunks, { type: mime });
    cleanup();
    state.phase = 'idle';
    syncUI();
    var result = null;
    if (!blob.size) {
      setText('待機中'); setNote('録画データが空でした');
    } else {
      var name = FILE_PREFIX + '_' + size.w + 'x' + size.h + '_' + timestamp() + '.' + extFor(mime);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 4000);
      result = { name: name, size: blob.size, mime: mime, w: size.w, h: size.h, frames: state.frames };
      state.lastFile = result;
      setText('保存: ' + name);
      console.log('[html-game-recorder] saved ' + name + ' (' + blob.size + ' bytes, ' + mime + ')');
    }
    var waiters = state.stopWaiters;
    state.stopWaiters = [];
    waiters.forEach(function (fn) { fn(result); });
  }

  function cleanup() {
    document.documentElement.classList.remove('hgrec-on');
    if (state.vfcHandle && state.video && state.video.cancelVideoFrameCallback) {
      try { state.video.cancelVideoFrameCallback(state.vfcHandle); } catch (e) {}
    }
    state.vfcHandle = 0;
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
    [state.displayStream, state.canvasStream].forEach(function (s) {
      if (s) s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    });
    state.displayStream = null; state.canvasStream = null; state.recorder = null;
    closePageMix();
    if (state.video) {
      try { state.video.pause(); state.video.srcObject = null; } catch (e) {}
      if (state.video.parentNode) state.video.parentNode.removeChild(state.video);
      state.video = null;
    }
    state.canvas = null;
    if (state.timerId) { clearInterval(state.timerId); state.timerId = 0; }
  }

  // ---------------- 外部 API ----------------
  var api = {
    start: start,
    stop: stop,
    computeDrawRect: computeDrawRect,
    pickMime: pickMime,
    isRecording: function () { return state.phase === 'recording'; },
    getState: function () {
      return {
        phase: state.phase,
        recording: state.phase === 'recording',
        captureMode: state.captureMode,
        audio: AUDIO_MODE,
        audioTracks: state.audioTracks || 0,
        pageAudioSources: pageAudio.streams.length,
        mime: state.mime,
        size: state.activeSize || currentSize(),
        frames: state.frames,
        chunks: state.chunks.length,
        recorderState: state.recorder ? state.recorder.state : '',
        recorderError: state.recorderError,
        lastError: state.lastError,
        lastFile: state.lastFile
      };
    }
  };
  window.HtmlGameRecorder = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
  else buildUI();
})();
