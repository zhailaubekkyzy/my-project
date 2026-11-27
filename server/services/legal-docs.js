// server/services/legal-docs.js - The legal documents (Privacy Policy, Terms of Service, Data Processing
// Addendum) as public web pages: /privacy, /terms, /dpa and /dmca (a pointer to section 14 of the Terms).
//
// The texts live in legal/*.md (owner's documents, word for word). Each file starts with a short header:
//   ---
//   title: Smartflow Privacy Policy
//   version: v1.0
//   date: 2026-11-24
//   ---
// A new version of a document = edit the file and raise `version` (and `date`). The same pages are built
// into dist/ for the app (scripts/build-pages.js), served by the server (server/index.js), and written into
// the landing techsmartflow.com (landing/public/*.html, `npm run build:legal`, committed — the landing has no build).
//
// The markdown here is deliberately small: headings (with an optional {#anchor}), paragraphs, "- " and
// "1. " lists, tables, **bold**, `code`, and e-mail addresses become mailto links.
const fs = require('fs');
const path = require('path');

const LEGAL_DIR = path.join(__dirname, '..', '..', 'legal');

// slug = web address and file name; the order is the order of the links in the footer
const DOCS = [
  { slug: 'privacy', file: 'privacy.md', short: 'Privacy Policy' },
  { slug: 'terms', file: 'terms.md', short: 'Terms of Service' },
  { slug: 'dpa', file: 'dpa.md', short: 'Data Processing Addendum' }
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseFile(text) {
  const meta = {};
  let body = text.replace(/\r\n/g, '\n');
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    body = body.slice(m[0].length);
  }
  return { meta, body };
}

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<a href="mailto:$1">$1</a>');
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,3})\s+(.*?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/);
    if (h) {
      const level = h[1].length;
      const id = h[3] || slugify(h[2]);
      out.push(`<h${level} id="${esc(id)}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (isTableRow(line)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      const head = cells(rows[0]);
      const bodyRows = rows.slice(1).filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push('<div class="table"><table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        bodyRows.map(r => '<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const re = ordered ? /^\d+\. / : /^- /;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|- |\d+\. )/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function readDoc(doc) {
  const { meta, body } = parseFile(fs.readFileSync(path.join(LEGAL_DIR, doc.file), 'utf8'));
  return { ...doc, title: meta.title || doc.short, version: meta.version || 'v1.0', date: meta.date || '', body };
}

// { privacy: 'v1.0', terms: 'v1.0', dpa: 'v1.0' } — what a person accepts (for the consent log)
function versions() {
  const res = {};
  for (const d of DOCS) res[d.slug] = readDoc(d).version;
  return res;
}

const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --ink: #14202b; --muted: #5b6b78; --line: #e3e8ec; --sunken: #f4f7f8; --brand: #0a9c95; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1720; --ink: #e8eef2; --muted: #9aa9b4; --line: #26323c; --sunken: #16212b; --brand: #46c7bf; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 28px; line-height: 1.25; margin: 8px 0 4px; }
h2 { font-size: 20px; margin: 32px 0 8px; scroll-margin-top: 16px; }
p, li { color: var(--ink); }
.meta { color: var(--muted); margin: 0 0 24px; }
a { color: var(--brand); }
code { background: var(--sunken); padding: 1px 5px; border-radius: 4px; font-size: 14px; }
.table { overflow-x: auto; margin: 12px 0; }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { background: var(--sunken); }
header, footer { max-width: 760px; margin: 0 auto; padding: 16px; }
header a { font-weight: 700; text-decoration: none; color: var(--ink); }
footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
footer nav { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 8px; }
`;

function footerHtml() {
  const links = DOCS.map(d => `<a href="/${d.slug}">${esc(d.short)}</a>`).join('') +
    '<a href="/terms#dmca">Copyright (DMCA)</a><a href="https://app.techsmartflow.com">Smartflow app</a>';
  return `<footer><nav>${links}</nav><div>Questions: <a href="mailto:Tomiris@techsmartflow.com">Tomiris@techsmartflow.com</a></div></footer>`;
}

function page(title, description, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/images/icon-192.png">
<style>${STYLE}</style>
</head>
<body>
<header><a href="/">Smartflow</a></header>
<main>
${content}
</main>
${footerHtml()}
</body>
</html>
`;
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function renderDoc(slug) {
  const doc = DOCS.find(d => d.slug === slug);
  if (!doc) return null;
  const d = readDoc(doc);
  // The "# Title" and "**Version …**" lines of the file are replaced by one heading with the version below
  const body = d.body.replace(/^\s+/, '').replace(/^#\s+.*\n+/, '').replace(/^\*\*Version[^\n]*\*\*\n+/, '');
  const content = `<h1>${esc(d.title)}</h1>\n<p class="meta">Version ${esc(d.version.replace(/^v/, ''))} · Effective ${esc(formatDate(d.date))}</p>\n${markdownToHtml(body)}`;
  return page(d.title, `${d.title}, version ${d.version}`, content);
}

// /dmca: section 14 of the Terms (the anchor), with a plain link if the redirect does not run
function renderDmca() {
  return page('Copyright complaints (DMCA) · Smartflow', 'How to send a copyright (DMCA) notice to Smartflow',
    '<h1>Copyright complaints (DMCA)</h1><p>Our DMCA policy is section 14 of the <a href="/terms#dmca">Terms of Service</a>.</p>' +
    '<script>location.replace("/terms#dmca")</script>');
}

// Every page: { slug, html }
function allPages() {
  return [
    ...DOCS.map(d => ({ slug: d.slug, html: renderDoc(d.slug) })),
    { slug: 'dmca', html: renderDmca() }
  ];
}

module.exports = { DOCS, versions, renderDoc, renderDmca, allPages, markdownToHtml };
