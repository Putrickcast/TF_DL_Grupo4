import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.DEMO_PORT ?? 4200);
const RAG_TARGET = process.env.RAG_TARGET ?? 'http://127.0.0.1:8787';
const PUBLIC_ROOT = resolve('dist/TF_DL_Grupo4/browser');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function log(message) {
  const timestamp = new Date().toLocaleTimeString('es-PE', { hour12: false });
  console.log(`[${timestamp}] ${message}`);
}

function send(response, status, headers = {}) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
}

async function proxyApi(request, response) {
  const targetUrl = new URL(request.url, RAG_TARGET);
  const body = ['GET', 'HEAD'].includes(request.method ?? '') ? undefined : request;
  const proxyResponse = await fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body,
    duplex: body ? 'half' : undefined,
  });

  send(response, proxyResponse.status, {
    'Content-Type': proxyResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
  });
  response.end(Buffer.from(await proxyResponse.arrayBuffer()));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const cleanPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(PUBLIC_ROOT, cleanPath);

  if (requestedPath === '/' || !existsSync(filePath)) {
    filePath = join(PUBLIC_ROOT, 'index.html');
  }

  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(PUBLIC_ROOT)) {
    send(response, 403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  const fileStat = await stat(resolvedPath);
  if (fileStat.isDirectory()) {
    filePath = join(resolvedPath, 'index.html');
  }

  const ext = extname(filePath).toLowerCase();
  send(response, 200, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/api/')) {
      await proxyApi(request, response);
      log(`${request.method} ${request.url} -> RAG`);
      return;
    }

    await serveStatic(request, response);
    log(`${request.method} ${request.url} -> static`);
  } catch (error) {
    send(response, 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : 'Internal error');
    log(`${request.method} ${request.url} -> 500`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Demo server running at http://127.0.0.1:${PORT}`);
  log(`Serving ${PUBLIC_ROOT}`);
  log(`Proxy /api -> ${RAG_TARGET}`);
});
