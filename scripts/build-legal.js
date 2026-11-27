// scripts/build-legal.js - Writes the legal documents (legal/*.md) into the landing techsmartflow.com:
// landing/public/privacy.html, terms.html, dpa.html, dmca.html → techsmartflow.com/privacy, /terms, /dpa, /dmca.
// The landing has no build step in Cloudflare, so these files are committed. After editing legal/*.md:
// `npm run build:legal` (also part of `npm run build`); the tests fail if the files are out of date.
const fs = require('fs');
const path = require('path');
const legalDocs = require('../server/services/legal-docs');

const OUT = path.join(__dirname, '..', 'landing', 'public');
for (const { slug, html } of legalDocs.allPages()) fs.writeFileSync(path.join(OUT, `${slug}.html`), html);
console.log(`[build-legal] landing/public: ${legalDocs.allPages().map(p => `${p.slug}.html`).join(', ')}`);
