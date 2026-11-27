// worker.js - The small Cloudflare Worker in front of the static files (dist/).
//
// One Worker serves two addresses:
//   app.techsmartflow.com   — the app (everything as before: files from dist/, unknown paths → index.html)
//   techsmartflow.com       — the home page of the domain (dist/home.html: what Smartflow is + links to the
//                             legal documents); /privacy, /terms, /dpa, /dmca work on both addresses.
// It only runs for "/" (see run_worker_first in wrangler.jsonc); every other request goes straight to the files.
const ROOT_HOSTS = new Set(['techsmartflow.com', 'www.techsmartflow.com']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (ROOT_HOSTS.has(url.hostname)) {
      if (url.hostname.startsWith('www.')) {
        url.hostname = 'techsmartflow.com';
        return Response.redirect(url.toString(), 301);
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return env.ASSETS.fetch(new Request(new URL('/home', url), request));
      }
    }
    return env.ASSETS.fetch(request);
  }
};
