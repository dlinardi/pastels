// The entire web gallery UI as one inline document (zero deps, no framework, no
// build step). Served at `/` by the serve command. It talks to three endpoints:
//   GET /api/session  → { project, title, branch, count }
//   GET /api/images   → [{ label, uncertain, w, h, bytes, mediaType, ts, hash, path, url }]
//   GET /events       → SSE; emits `changed` whenever a paste lands, client refetches
// Image bytes come from GET /img/<hash>. Content-addressed, so URLs are stable.

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pastels</title>
<style>
  :root {
    --bg: #0b0d10; --panel: #14181d; --border: #232a31; --text: #e6edf3;
    --dim: #8b949e; --accent: #7ee787; --chip: #79c0ff; --shadow: rgba(0,0,0,.45);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  header {
    position: sticky; top: 0; z-index: 5;
    display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
    padding: 18px 24px; background: rgba(11,13,16,.85);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
  }
  header h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: .2px; }
  header h1 .mark { color: var(--accent); }
  .meta { color: var(--dim); font-size: 13px; }
  .meta b { color: var(--text); font-weight: 600; }
  .live {
    margin-left: auto; display: inline-flex; align-items: center; gap: 7px;
    color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .6px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #555; transition: background .3s; }
  .live.on .dot { background: var(--accent); box-shadow: 0 0 0 0 rgba(126,231,135,.6); animation: pulse 2s infinite; }
  .live.off .dot { background: #f85149; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(126,231,135,.5);} 70%{ box-shadow: 0 0 0 7px rgba(126,231,135,0);} 100%{ box-shadow:0 0 0 0 rgba(126,231,135,0);} }

  main { padding: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    overflow: hidden; cursor: zoom-in; transition: transform .12s ease, border-color .12s ease;
  }
  .card:hover { transform: translateY(-2px); border-color: #30363d; }
  .card .thumb { width: 100%; aspect-ratio: 16 / 10; background: #0d1117; display: block; object-fit: contain; }
  .card .foot { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-top: 1px solid var(--border); }
  .chip {
    font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--chip);
    background: rgba(121,192,255,.1); border: 1px solid rgba(121,192,255,.25);
    padding: 4px 7px; border-radius: 6px; white-space: nowrap;
  }
  .chip.q { color: #d29922; background: rgba(210,153,34,.1); border-color: rgba(210,153,34,.25); }
  .foot .dims { color: var(--dim); font-size: 12px; }
  .foot .age { color: var(--dim); font-size: 12px; margin-left: auto; }
  .card.fresh { animation: flash 1.4s ease; }
  @keyframes flash { 0% { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(126,231,135,.35);} 100%{ border-color: var(--border); box-shadow:none;} }

  .empty { color: var(--dim); text-align: center; padding: 18vh 24px; }
  .empty .big { font-size: 16px; color: var(--text); margin-bottom: 6px; }

  /* lightbox */
  .lb { position: fixed; inset: 0; z-index: 20; display: none; background: rgba(5,6,8,.9); backdrop-filter: blur(4px); }
  .lb.open { display: flex; flex-direction: column; }
  .lb .bar { display: flex; align-items: center; gap: 12px; padding: 14px 20px; color: var(--dim); }
  .lb .bar .dims { font-size: 13px; }
  .lb .bar .spacer { margin-left: auto; }
  .lb button {
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer;
  }
  .lb button:hover { border-color: #30363d; }
  .lb .stage { flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 20px 24px; min-height: 0; }
  .lb .stage img { max-width: 92vw; max-height: 82vh; border-radius: 8px; box-shadow: 0 18px 60px var(--shadow); }
  .lb .nav { position: absolute; top: 50%; transform: translateY(-50%); font-size: 30px; padding: 10px 16px; user-select: none; }
  .lb .nav.prev { left: 10px; } .lb .nav.next { right: 10px; }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 9px 14px; border-radius: 9px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
  <header>
    <h1><span class="mark">see</span> pastels</h1>
    <span class="meta" id="meta"></span>
    <span class="live off" id="live"><span class="dot"></span><span id="livetxt">offline</span></span>
  </header>
  <main><div class="grid" id="grid"></div></main>

  <div class="lb" id="lb">
    <div class="bar">
      <span class="chip" id="lbLabel"></span>
      <span class="dims" id="lbDims"></span>
      <span class="spacer"></span>
      <button id="lbCopy">copy path</button>
      <button id="lbClose">close ✕</button>
    </div>
    <div class="stage">
      <span class="nav prev" id="lbPrev">‹</span>
      <img id="lbImg" alt="" />
      <span class="nav next" id="lbNext">›</span>
    </div>
  </div>
  <div class="toast" id="toast"></div>

<script>
(function () {
  var grid = document.getElementById('grid');
  var metaEl = document.getElementById('meta');
  var live = document.getElementById('live');
  var liveTxt = document.getElementById('livetxt');
  var lb = document.getElementById('lb');
  var lbImg = document.getElementById('lbImg');
  var lbLabel = document.getElementById('lbLabel');
  var lbDims = document.getElementById('lbDims');
  var toast = document.getElementById('toast');
  var images = [];
  var seen = {};      // hash -> true, to flag freshly-arrived cards
  var firstLoad = true;
  var cursor = -1;

  function ago(ts) {
    if (!ts) return '';
    var s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function dims(i) { return i.w && i.h ? i.w + '\\u00d7' + i.h : ''; }

  function toastMsg(m) {
    toast.textContent = m; toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 1400);
  }

  function render() {
    metaEl.innerHTML = '';
    fetch('/api/session').then(function (r) { return r.json(); }).then(function (s) {
      var bits = [];
      if (s.project) bits.push('<b>' + esc(s.project) + '</b>');
      if (s.branch) bits.push(esc(s.branch));
      bits.push(s.count + ' image' + (s.count === 1 ? '' : 's'));
      metaEl.innerHTML = bits.join(' &nbsp;\\u00b7&nbsp; ');
    }).catch(function(){});

    if (!images.length) {
      grid.outerHTML = '<div class="empty" id="grid"><div class="big">No images yet</div>' +
        'Paste an image into Claude Code and it appears here, live.</div>';
      grid = document.getElementById('grid');
      return;
    }
    if (!grid.classList.contains('grid')) {
      var fresh = document.createElement('div'); fresh.className = 'grid'; fresh.id = 'grid';
      grid.replaceWith(fresh); grid = fresh;
    }
    grid.innerHTML = '';
    images.forEach(function (i, idx) {
      var card = document.createElement('div');
      card.className = 'card' + (!firstLoad && !seen[i.hash] ? ' fresh' : '');
      card.innerHTML =
        '<img class="thumb" loading="lazy" src="' + i.url + '" alt="Image ' + i.label + '" />' +
        '<div class="foot">' +
          '<span class="chip' + (i.uncertain ? ' q' : '') + '">#' + i.label + (i.uncertain ? '?' : '') + '</span>' +
          '<span class="dims">' + dims(i) + '</span>' +
          '<span class="age">' + ago(i.ts) + '</span>' +
        '</div>';
      card.onclick = function () { open(idx); };
      grid.appendChild(card);
      seen[i.hash] = true;
    });
    firstLoad = false;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]); }); }

  function load(cb) {
    fetch('/api/images').then(function (r) { return r.json(); }).then(function (list) {
      images = list; render(); if (cb) cb();
    }).catch(function(){});
  }

  // lightbox
  function open(idx) {
    cursor = idx; var i = images[idx]; if (!i) return;
    lbImg.src = i.url; lbLabel.textContent = '[Image #' + i.label + ']' + (i.uncertain ? ' (inferred)' : '');
    lbDims.textContent = dims(i); lb.classList.add('open');
  }
  function close() { lb.classList.remove('open'); cursor = -1; }
  function step(d) { if (cursor < 0) return; var n = cursor + d; if (n >= 0 && n < images.length) open(n); }
  document.getElementById('lbClose').onclick = close;
  document.getElementById('lbPrev').onclick = function () { step(-1); };
  document.getElementById('lbNext').onclick = function () { step(1); };
  document.getElementById('lbCopy').onclick = function () {
    var i = images[cursor]; if (!i) return;
    navigator.clipboard.writeText(i.path).then(function () { toastMsg('copied remote path'); },
      function () { toastMsg(i.path); });
  };
  lb.onclick = function (e) { if (e.target === lb || e.target.className === 'stage') close(); };
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  // live updates
  function connect() {
    try {
      var es = new EventSource('/events');
      es.onopen = function () { live.className = 'live on'; liveTxt.textContent = 'live'; };
      es.onerror = function () { live.className = 'live off'; liveTxt.textContent = 'reconnecting'; };
      es.onmessage = function () { load(); };
    } catch (e) { live.className = 'live off'; liveTxt.textContent = 'offline'; }
  }

  load(); connect();
  setInterval(function () { /* keep ages fresh */ if (images.length) render(); }, 30000);
})();
</script>
</body>
</html>`;
}
