import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = resolve(ROOT, 'public');
const HOST = process.env.DESKBOT_WEB_HOST?.trim() || '127.0.0.1';
const PORT = Number.parseInt(process.env.DESKBOT_WEB_PORT ?? '4322', 10);
const SERVICE_ORIGIN = (process.env.DESKBOT_SERVICE_ORIGIN?.trim() || 'http://127.0.0.1:4311').replace(/\/+$/, '');
const MAX_PROXY_BYTES = 2 * 1024 * 1024;
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
});

function sendText(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_PROXY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function proxyToService(request, response, url) {
  const target = new URL(`${url.pathname}${url.search}`, `${SERVICE_ORIGIN}/`);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readRequestBody(request);
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: {
        accept: request.headers.accept || '*/*',
        ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
      },
      body: body?.length ? body : undefined,
    });
  } catch (error) {
    sendText(response, 502, JSON.stringify({ error: 'deskbot_service_unreachable', message: error.message }), 'application/json; charset=utf-8');
    return;
  }
  const payload = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, {
    'cache-control': 'no-store',
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

async function serveStatic(response, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { sendText(response, 400, 'invalid path'); return; }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = resolve(PUBLIC_ROOT, `.${requested}`);
  const rel = relative(PUBLIC_ROOT, candidate);
  if (rel.startsWith('..') || rel.includes(`..${'\\'}`) || rel.includes(`..${'/'}`)) { sendText(response, 403, 'forbidden'); return; }
  let info;
  try { info = await stat(candidate); } catch { sendText(response, 404, 'not found'); return; }
  if (!info.isFile()) { sendText(response, 404, 'not found'); return; }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': info.size,
    'content-type': MIME_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(candidate).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-origin': '*',
    });
    response.end();
    return;
  }
  if (!['GET', 'HEAD', 'POST'].includes(request.method || '')) { sendText(response, 405, 'method not allowed'); return; }
  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
    proxyToService(request, response, url).catch((error) => sendText(response, error.statusCode || 500, JSON.stringify({ error: 'web_proxy_error', message: error.message }), 'application/json; charset=utf-8'));
    return;
  }
  if (request.method !== 'GET') { sendText(response, 404, 'not found'); return; }
  serveStatic(response, url).catch((error) => sendText(response, 500, `static server error: ${error.message}`));
});

server.listen(PORT, HOST, () => {
  console.log(`DeskBot Web v0.1.0 listening on http://${HOST}:${PORT}`);
  console.log(`DeskBot Service proxy: ${SERVICE_ORIGIN}`);
});

function close() { server.close(() => process.exit(0)); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
