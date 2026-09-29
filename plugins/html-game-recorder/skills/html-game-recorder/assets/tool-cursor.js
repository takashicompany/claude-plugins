/* ===========================================================================
 * tool-cursor.js — ゲームが動かす「道具」オーバーレイ (html-game-recorder プラグイン)
 *
 * 指の画像 (hand-cursor.js) はポインタに付いてくるが、こちらはゲーム側のコードが
 * 位置・向き・状態を指示して動かす。例: タップされた水槽の注ぎ口までシャワーを飛ばし、
 * 着いてから水を出す。読み込んだだけでは何も表示しない (window.HtmlGameTool を定義するだけ)。
 *
 *   const shower = HtmlGameTool.create({
 *     src: 'shower.png',            // 画像 (data URL 可)
 *     anchor: { x: 0.15, y: 0.22 }, // 画像内の基準点 (比率)。位置指定・回転の中心になる
 *     width: 300,                   // 表示幅 (CSS px)
 *     root: '#game'                 // 追加先 (録画対象の内側)。省略時は body
 *   });
 *   await shower.moveTo(x, y, { ms: 450 });  // 基準点を画面座標 (clientX/Y) へ ease-in-out で移動
 *   await shower.rotateTo(-20, { ms: 150 }); // 基準点まわりに回転 (度)
 *   shower.setEffect({ length: 40, width: 12 }); // 基準点から下へ伸びる水流などの帯。null で消す
 *   shower.flash(x, y, { ms: 250 });          // その場に一瞬出して消す (タップの表現など)
 *   shower.show(); shower.hide(); shower.setWidth(px); shower.setSrc(src);
 *
 * 位置は position:fixed + 画面座標で持つので、親要素の位置指定の影響を受けない。
 * =========================================================================== */
(function () {
  'use strict';
  if (window.HtmlGameTool) return;

  var ease = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var zBase = 2147481000;

  function create(opts) {
    opts = opts || {};
    var root = (opts.root && document.querySelector(opts.root)) || document.body;
    if (root.tagName === 'CANVAS') root = root.parentElement; // canvas の子は描画されない
    var anchor = opts.anchor || { x: 0.5, y: 0.5 };
    var width = opts.width || 200;
    var x = opts.x == null ? -9999 : opts.x, y = opts.y == null ? -9999 : opts.y, rot = opts.rotate || 0;

    var el = document.createElement('div');
    el.className = 'hgtool';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;display:none;' +
      'z-index:' + (opts.zIndex || zBase++);
    // 効果 (水流など) は画像より奥に描く
    var fx = document.createElement('div');
    fx.style.cssText = 'position:absolute;left:0;top:0;display:none;border-radius:0 0 50% 50%/0 0 30% 30%;' +
      'background:linear-gradient(to bottom,rgba(183,244,255,.95),rgba(102,217,248,.9));';
    var img = document.createElement('img');
    img.alt = ''; img.draggable = false; img.src = opts.src || '';
    img.style.cssText = 'position:absolute;left:0;top:0;max-width:none;user-select:none;-webkit-user-drag:none;' +
      (opts.shadow === false ? '' : 'filter:drop-shadow(0 6px 10px rgba(0,0,0,.35));');
    el.appendChild(fx); el.appendChild(img);
    root.appendChild(el);

    function apply() {
      var h = width * (img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1);
      var ax = anchor.x * width, ay = anchor.y * h;
      img.style.width = width + 'px';
      img.style.height = h + 'px';
      img.style.transformOrigin = ax + 'px ' + ay + 'px';
      img.style.transform = 'translate(' + (-ax) + 'px,' + (-ay) + 'px) rotate(' + rot + 'deg)';
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
    img.addEventListener('load', apply);
    apply();

    // 値を ms かけて補間する。新しい指示が来たら古い補間は打ち切る
    var anims = {};
    function tween(key, from, to, ms, set) {
      if (anims[key]) anims[key].cancel();
      return new Promise(function (resolve) {
        if (!ms) { set(to); apply(); resolve(); return; }
        var t0 = performance.now(), stopped = false, raf = 0;
        anims[key] = { cancel: function () { stopped = true; cancelAnimationFrame(raf); resolve(); } };
        (function step(now) {
          if (stopped) return;
          var k = Math.min(1, (now - t0) / ms);
          set(from + (to - from) * ease(k)); apply();
          if (k < 1) raf = requestAnimationFrame(step);
          else { anims[key] = null; resolve(); }
        })(t0);
      });
    }

    var api = {
      el: el,
      show: function () { el.style.display = 'block'; apply(); return api; },
      hide: function () { el.style.display = 'none'; return api; },
      isVisible: function () { return el.style.display !== 'none'; },
      setSrc: function (src) { img.src = src; return api; },
      setWidth: function (px) { width = px; apply(); return api; },
      setAnchor: function (a) { anchor = a; apply(); return api; },
      getPosition: function () { return { x: x, y: y, rotate: rot }; },
      moveTo: function (tx, ty, o) {
        var ms = (o && o.ms) || 0;
        if (x < -9000) { x = tx; y = ty; ms = 0; } // 初回は瞬間移動
        var fx0 = x, fy0 = y;
        return Promise.all([
          tween('x', fx0, tx, ms, function (v) { x = v; }),
          tween('y', fy0, ty, ms, function (v) { y = v; })
        ]);
      },
      rotateTo: function (deg, o) {
        return tween('r', rot, deg, (o && o.ms) || 0, function (v) { rot = v; });
      },
      // 基準点から真下へ伸びる帯 (水流など)。{length, width, background} / null で消す
      setEffect: function (e) {
        if (!e) { fx.style.display = 'none'; return api; }
        fx.style.display = 'block';
        fx.style.width = e.width + 'px';
        fx.style.height = e.length + 'px';
        fx.style.transform = 'translate(' + (-e.width / 2) + 'px,0)';
        if (e.background) fx.style.background = e.background;
        return api;
      },
      // その場に一瞬出して消す
      flash: function (fxX, fxY, o) {
        if (anims.x) anims.x.cancel(); if (anims.y) anims.y.cancel();
        x = fxX; y = fxY; api.show();
        clearTimeout(api._flashTimer);
        api._flashTimer = setTimeout(api.hide, (o && o.ms) || 250);
        return api;
      },
      destroy: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
    return api;
  }

  window.HtmlGameTool = { create: create };
})();
