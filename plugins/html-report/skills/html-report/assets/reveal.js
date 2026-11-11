// 「Finder で表示」ボタン。HTML には相対パスだけ書き、実際のパスは開いた場所から計算する。
// 表示条件: file:// で開いたとき、または Yaruzo の /api/local-file/ 経由で開いたとき(ホスト名は問わない。yaru.zo など)。公開先では出さない。
(function () {
  const PREFIX = '/api/local-file';
  function localPath(rel) {
    const u = new URL(rel, location.href);
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname);
    if (/^https?:$/.test(u.protocol) && u.pathname.startsWith(PREFIX + '/'))
      return decodeURIComponent(u.pathname.slice(PREFIX.length));
    return null;
  }
  function reveal(btn) {
    const p = localPath(btn.dataset.reveal);
    if (!p) return;
    const url = 'htmlreveal://' + p.split('/').map(encodeURIComponent).join('/');
    let left = false;
    const onLeave = () => { left = true; };
    window.addEventListener('blur', onLeave, { once: true });
    document.addEventListener('visibilitychange', onLeave, { once: true });
    const a = document.createElement('a'); a.href = url; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => {
      window.removeEventListener('blur', onLeave);
      if (left) return;
      let msg = btn.parentElement.querySelector('.reveal-msg');
      if (!msg) { msg = document.createElement('div'); msg.className = 'reveal-msg'; btn.after(msg); }
      msg.innerHTML = '';
      msg.append('Finder を開けませんでした(受け口アプリが入っていないようです)。パス: ');
      const code = document.createElement('code'); code.textContent = p; msg.append(code);
    }, 1500);
  }
  window.HTMLReveal = { localPath, reveal };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-reveal]').forEach((b) => {
      if (!localPath(b.dataset.reveal)) { b.hidden = true; return; }
      b.addEventListener('click', () => reveal(b));
    });
  });
})();
