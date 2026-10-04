// server/asset-version.js - Cache-busting for frontend assets.
// Appends ?v=<content hash> to local css/js URLs in index.html, so browsers can cache
// those files for a year and still pick up every new deploy immediately.
// Used by the Express server at startup and by scripts/build-pages.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

function fileHash(relPath) {
  const content = fs.readFileSync(path.join(ROOT_DIR, relPath));
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

// Rewrites src="js/x.js" / href="css/y.css" (relative, no query) to include ?v=hash.
function stampAssetUrls(html) {
  return html.replace(/(src|href)="((?:css|js)\/[^"?#]+\.(?:css|js))"/g, (match, attr, rel) => {
    try {
      return `${attr}="${rel}?v=${fileHash(rel)}"`;
    } catch (e) {
      return match;
    }
  });
}

function renderIndexHtml() {
  return stampAssetUrls(fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8'));
}

module.exports = { stampAssetUrls, renderIndexHtml, fileHash };
