/* ===========================================================================
 * hand-cursor.js — 録画用の「手カーソル」オーバーレイ (html-game-recorder プラグイン)
 *
 * 有効になる条件 (どちらか):
 *   - URL に ?hand=1 / ?hand=true が付いている
 *   - window.HTML_GAME_HAND_CONFIG.enabled === true   (Playwright から差し込む場合)
 * それ以外では何もしない。
 *
 * マウス操作でも「指で操作している」ように見えるよう、指の画像をポインタに追従させる。
 *   - 人差し指の指先がポインタ座標に一致する
 *   - 押下中は指を曲げた画像に切り替わる (素早いタップでも minTapMs は表示し続ける)
 *   - pointer-events:none なのでゲーム操作を邪魔しない
 *   - area の外にポインタが出たら隠す
 *
 * 重要: 録画を要素で切り出す場合 (HTML_GAME_RECORDER_CONFIG.targetSelector)、
 *   手は必ずその要素の「内側」に置く (root)。外に置くと録画に写らない。
 *   canvas の子要素は描画されないため、canvas は root にできない (親要素を使う)。
 *
 * 設定は window.HTML_GAME_HAND_CONFIG (このファイルより前に定義する)。
 * =========================================================================== */
(function () {
  'use strict';

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  var CFG = window.HTML_GAME_HAND_CONFIG || {};
  var handParam = qs('hand');
  if (!(CFG.enabled === true || handParam === '1' || handParam === 'true')) return;
  if (window.HtmlGameHand) return;

  // 手を入れる要素 (録画対象の要素と同じか、その内側)。省略時は body
  var ROOT_SELECTOR = CFG.root || null;
  // 手を表示する範囲 (この外では隠す)。省略時は root。root も無ければビューポート全体
  var AREA_SELECTOR = CFG.area || ROOT_SELECTOR;
  var IDLE_SRC = CFG.idleSrc || 'assets/hand/hand_idle.png';
  var TAP_SRC = CFG.tapSrc || 'assets/hand/hand_tap.png';
  // 手の大きさ = 表示範囲の高さ × この比率
  var SIZE_RATIO = CFG.sizeRatio || 0.126;
  var Z_INDEX = CFG.zIndex || 2147482000;
  var MIN_TAP_MS = CFG.minTapMs === undefined ? 120 : CFG.minTapMs;
  var HIDE_OS_CURSOR = CFG.hideOsCursor !== false;
  // 画像内の指先位置 (画像サイズに対する比率)。同梱の hand_idle.png / hand_tap.png の実測値。
  // 画像を差し替えたら references/hand-images.md の手順で測り直すこと
  var IDLE_TIP = CFG.idleTip || { x: 75.1 / 512, y: 51.9 / 512 };
  var TAP_TIP = CFG.tapTip || { x: 68.5 / 512, y: 115.6 / 512 };

  var root = null, area = null, wrap = null, idleImg = null, tapImg = null, sizePx = 0;

  function areaRect() {
    if (area) return area.getBoundingClientRect();
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function injectStyle() {
    var css = [
      // position:fixed + clientX/Y で置くので、親の位置指定や余白の影響を受けない
      '#hghand{position:fixed;left:0;top:0;width:0;height:0;',
      'pointer-events:none;z-index:' + Z_INDEX + ';display:none}',
      '#hghand.show{display:block}',
      '#hghand img{position:absolute;left:0;top:0;pointer-events:none;',
      'user-select:none;-webkit-user-drag:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))}',
      '#hghand .hghand-tap{display:none}',
      '#hghand.down .hghand-idle{display:none}',
      '#hghand.down .hghand-tap{display:block}'
    ];
    if (HIDE_OS_CURSOR) {
      var sel = AREA_SELECTOR || 'html';
      css.push(sel + ',' + sel + ' *{cursor:none !important}');
    }
    var s = document.createElement('style');
    s.id = 'hghand-style';
    s.textContent = css.join('');
    document.head.appendChild(s);
  }

  function layout() {
    sizePx = areaRect().height * SIZE_RATIO;
    [[idleImg, IDLE_TIP], [tapImg, TAP_TIP]].forEach(function (pair) {
      var img = pair[0], tip = pair[1];
      img.style.width = sizePx + 'px';
      img.style.height = sizePx + 'px';
      // ラッパーの原点 (= ポインタ座標) に指先が来るようにずらす
      img.style.transform = 'translate(' + (-tip.x * sizePx) + 'px,' + (-tip.y * sizePx) + 'px)';
    });
  }

  function build() {
    root = ROOT_SELECTOR ? document.querySelector(ROOT_SELECTOR) : document.body;
    if (!root) { console.warn('[html-game-hand] root が見つかりません: ' + ROOT_SELECTOR); return; }
    if (root.tagName === 'CANVAS') {
      console.warn('[html-game-hand] canvas の子は描画されないため、親要素を root にします');
      root = root.parentElement;
    }
    area = AREA_SELECTOR ? document.querySelector(AREA_SELECTOR) : null;
    injectStyle();

    wrap = document.createElement('div');
    wrap.id = 'hghand';
    wrap.setAttribute('aria-hidden', 'true');
    idleImg = document.createElement('img');
    idleImg.className = 'hghand-idle'; idleImg.src = IDLE_SRC; idleImg.alt = ''; idleImg.draggable = false;
    tapImg = document.createElement('img');
    tapImg.className = 'hghand-tap'; tapImg.src = TAP_SRC; tapImg.alt = ''; tapImg.draggable = false;
    wrap.appendChild(idleImg);
    wrap.appendChild(tapImg);
    root.appendChild(wrap);

    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('pointermove', onMove, { passive: true, capture: true });
    window.addEventListener('pointerdown', onDown, { passive: true, capture: true });
    window.addEventListener('pointerup', onUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', onUp, { passive: true, capture: true });
  }

  function place(evt) {
    var r = areaRect();
    var x = evt.clientX, y = evt.clientY;
    if (x < r.left || y < r.top || x > r.left + r.width || y > r.top + r.height) {
      wrap.classList.remove('show');
      return;
    }
    if (Math.abs(r.height * SIZE_RATIO - sizePx) > 1) layout();
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    wrap.classList.add('show');
  }

  var downAt = 0, releaseTimer = 0;
  function onMove(evt) { place(evt); }
  function onDown(evt) {
    place(evt);
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
    downAt = Date.now();
    wrap.classList.add('down');
  }
  function onUp() {
    var wait = Math.max(0, MIN_TAP_MS - (Date.now() - downAt));
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
    if (wait <= 0) { wrap.classList.remove('down'); return; }
    releaseTimer = setTimeout(function () { releaseTimer = 0; wrap.classList.remove('down'); }, wait);
  }

  window.HtmlGameHand = {
    getState: function () {
      if (!wrap) return null;
      return {
        visible: wrap.classList.contains('show'),
        down: wrap.classList.contains('down'),
        left: wrap.style.left, top: wrap.style.top, sizePx: sizePx,
        root: root && (root.id ? '#' + root.id : root.tagName.toLowerCase())
      };
    },
    relayout: layout
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
