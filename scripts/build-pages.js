// scripts/build-pages.js - Build the static frontend for Cloudflare Pages into dist/.
// Cloudflare Pages settings: build command `npm run build:pages`, output directory `dist`.
//
// Environment variables (set in Cloudflare Pages → Settings → Variables):
//   SMARTFLOW_API_URL  Railway backend URL, e.g. https://smartflow-production.up.railway.app
//
// Output:
//   dist/index.html            no-cache, references content-hashed assets
//   dist/assets/<name>.<hash>  css/js used by index.html, cached for a year (immutable)
//   dist/js/, dist/css/, dist/images/  plain copies for files loaded at runtime (revalidated)
//   dist/_headers              cache rules for Cloudflare Pages
const fs = require('fs');
const path = require('path');
const { fileHash } = require('../server/asset-version');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_DIRS = ['css', 'js', 'images'];

const apiUrl = (process.env.SMARTFLOW_API_URL || '').trim().replace(/\/+$/, '');
if (!apiUrl) {
  console.error('[build-pages] SMARTFLOW_API_URL is not set. Set it to your Railway backend URL (https://...up.railway.app).');
  process.exit(1);
}
if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(apiUrl)) {
  console.error(`[build-pages] SMARTFLOW_API_URL must look like https://host (no path), got: ${apiUrl}`);
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });

// Plain copies: files loaded at runtime (images, mascots) keep their usual paths.
for (const dir of PUBLIC_DIRS) {
  fs.cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
}

// Content-hashed copies for everything index.html links to directly.
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/(src|href)="((?:css|js)\/[^"?#]+)\.(css|js)"/g, (match, attr, base, ext) => {
  const rel = `${base}.${ext}`;
  const hashed = `assets/${path.basename(base)}.${fileHash(rel)}.${ext}`;
  fs.copyFileSync(path.join(ROOT, rel), path.join(DIST, hashed));
  return `${attr}="${hashed}"`;
});

// Point the API client at the Railway backend (read by js/api-client.js).
const apiConfig = `  <script>window.SMARTFLOW_API_BASE = ${JSON.stringify(apiUrl)};</script>\n`;
html = html.replace('  <!-- Application Logic', apiConfig + '  <!-- Application Logic');
if (!html.includes('window.SMARTFLOW_API_BASE')) {
  console.error('[build-pages] Could not inject API config into index.html');
  process.exit(1);
}
// Let the browser open the API connection while the page is still loading.
html = html.replace('</title>', `</title>\n  <link rel="preconnect" href="${apiUrl}" crossorigin>`);
fs.writeFileSync(path.join(DIST, 'index.html'), html);

fs.writeFileSync(path.join(DIST, '_headers'), `/assets/*
  Cache-Control: public, max-age=31536000, immutable

/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`);

const files = fs.readdirSync(path.join(DIST, 'assets'));
console.log(`[build-pages] dist/ ready: index.html + ${files.length} hashed assets; API → ${apiUrl}`);
