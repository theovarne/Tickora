import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535.');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8',
};
const insideRoot = path => {
  const child = relative(root, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
};

function respond(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return respond(res, 405, 'Method not allowed.');
  }
  let pathname;
  try { pathname = decodeURIComponent((req.url ?? '/').split(/[?#]/, 1)[0]); }
  catch { return respond(res, 400, 'Invalid path.'); }
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('\0')) {
    return respond(res, 400, 'Invalid path.');
  }
  if (pathname.split('/').some(part => part === '..' || part.startsWith('.'))) {
    return respond(res, 403, 'Forbidden.');
  }
  const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!insideRoot(requested)) return respond(res, 403, 'Forbidden.');
  try {
    const file = await realpath(requested);
    if (!insideRoot(file)) return respond(res, 403, 'Forbidden.');
    const info = await stat(file);
    if (!info.isFile()) return respond(res, 404, 'Not found.');
    res.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') respond(res, 404, 'Not found.');
    else if (error.code === 'EACCES' || error.code === 'EPERM') respond(res, 403, 'Forbidden.');
    else { console.error('Request failed:', error.message); respond(res, 500, 'Server error.'); }
  }
});

server.on('error', error => { console.error('Unable to start Tickora:', error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Tickora: http://127.0.0.1:${server.address().port}`));
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => server.closeAllConnections(), 1000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
