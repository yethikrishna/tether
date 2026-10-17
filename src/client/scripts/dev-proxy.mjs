/* ============================================================
   Dev-only static server + same-origin API proxy.
   The TETHER API requires Origin == Host on writes, so the
   client must reach it on its own origin; this proxy forwards
   /api/* to the local backend and rewrites Host/Origin.
   Usage: node src/client/scripts/dev-proxy.mjs  (from repo root)
   Env:   PORT (default 8410), TETHER_API (default http://127.0.0.1:4173)
   ============================================================ */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const API = process.env.TETHER_API ?? 'http://127.0.0.1:4173';
const PORT = Number(process.env.PORT ?? 8410);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function drain(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try {
      const headers = { ...req.headers, host: new URL(API).host, origin: API };
      delete headers['accept-encoding'];
      delete headers['content-length'];
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await drain(req) : undefined;
      const r = await fetch(new URL(url.pathname + url.search, API), { method: req.method, headers, body });
      const buf = Buffer.from(await r.arrayBuffer());
      const h = {};
      r.headers.forEach((v, k) => { if (!['content-length', 'transfer-encoding', 'connection'].includes(k)) h[k] = v; });
      res.writeHead(r.status, h);
      res.end(buf);
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'TETHER backend unreachable.' }));
    }
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname));
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => process.stdout.write(`tether dev proxy on http://127.0.0.1:${PORT} -> ${API}\n`));
