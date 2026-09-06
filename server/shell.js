// server/shell.js — lightweight meta shell for shared lanyard cards.
// og:meta tags crawlers (X/Telegram) need for unfurling, plus an iframe to
// the full 6.6MB baked page for real users. Saved to disk as a static file
// during bake so Cloudflare caches it as a static resource across all edges.

function esc(s) {
  return String(s || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildShell(publicUrl, meta, id) {
  const base = (publicUrl || '').replace(/\/$/, '')
  const pageUrl = `${base}/full/${id}`
  const imageUrl = meta?.og_image || meta?.image || ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(meta?.name || 'Monad Lanyard')}</title>
  <meta property="og:title" content="${esc(meta?.name || '')}"/>
  <meta property="og:description" content="${esc(meta?.description || '')}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${base}/s/${id}"/>
  <meta property="og:image" content="${esc(imageUrl)}"/>
  <meta property="og:image:width" content="1080"/>
  <meta property="og:image:height" content="1350"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(meta?.name || '')}"/>
  <meta name="twitter:description" content="${esc(meta?.description || '')}"/>
  <meta name="twitter:image" content="${esc(imageUrl)}"/>
  <link rel="icon" href="/favicon.svg"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0612;color:#f2eefe;font-family:system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
    .frame{width:100%;height:100%;border:none}
    .loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0612;z-index:1;transition:opacity .4s}
    .loader.done{opacity:0;pointer-events:none}
    .spinner{width:32px;height:32px;border:3px solid rgba(255,255,255,.12);border-top-color:#7c5cff;border-radius:50%;animation:spin .7s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    p{margin-top:14px;color:#a89fc9;font-size:14px}
  </style>
</head>
<body>
  <div class="loader" id="ldr">
    <div class="spinner"></div>
    <p>Loading your lanyard…</p>
  </div>
  <iframe class="frame" src="${esc(pageUrl)}" onload="document.getElementById('ldr').classList.add('done')" allow="autoplay"></iframe>
  <script>
    setTimeout(function(){ if(document.getElementById('ldr')&&!document.getElementById('ldr').classList.contains('done'))window.location.href="${esc(pageUrl)}"},5000);
  </script>
</body>
</html>`
}