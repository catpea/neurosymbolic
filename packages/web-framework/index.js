/**
 * undercity-http-server
 * Minimal Express-compatible HTTP framework built on Node built-ins.
 *
 * Supports the exact subset used by server.js:
 *   express()                       → createApp()
 *   express.json({ limit })         → JSON body-parser middleware
 *   express.static(root)            → static file middleware
 *   app.use([path], fn)             → middleware registration
 *   app.get/post/put/delete(path, fn) → route registration
 *   app.listen(port, cb)            → start HTTP server
 *   req.params, req.body, req.query
 *   res.json(data), res.status(code) [chainable]
 */

import { createServer }                    from 'http';
import { createReadStream }                from 'fs';
import { stat }                            from 'fs/promises';
import { join, extname, normalize, resolve } from 'path';

// ── MIME map ──────────────────────────────────────────────────────────────────
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.htm':   'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml; charset=utf-8',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.eot':   'application/vnd.ms-fontobject',
  '.map':   'application/json; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
  '.xml':   'text/xml; charset=utf-8',
  '.webp':  'image/webp',
};

// ── Route pattern compiler ────────────────────────────────────────────────────
// Converts '/api/projects/:id/generate' → { regex, keys: ['id'] }
function compilePattern(pattern) {
  const keys = [];
  const parts = pattern.split('/').map(seg => {
    if (seg.startsWith(':')) {
      keys.push(seg.slice(1));
      return '([^/]+)';
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { regex: new RegExp('^' + parts.join('/') + '$'), keys };
}

// ── Request body collector ────────────────────────────────────────────────────
function collectBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) { req.destroy(); reject(new Error('Payload too large')); }
      else chunks.push(chunk);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── Parse size string  e.g. '4mb' → bytes ────────────────────────────────────
function parseSize(s) {
  if (typeof s === 'number') return s;
  const m = String(s).match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/i);
  if (!m) return 1_048_576;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'gb': return n * 1_073_741_824;
    case 'mb': return n * 1_048_576;
    case 'kb': return n * 1_024;
    default:   return n;
  }
}

// ── JSON body-parser middleware ───────────────────────────────────────────────
function jsonMiddleware({ limit = '1mb' } = {}) {
  const maxBytes = parseSize(limit);
  return async (req, _res, next) => {
    const ct = req.headers['content-type'] ?? '';
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && ct.includes('application/json')) {
      const raw = await collectBody(req, maxBytes);
      req.body = raw ? JSON.parse(raw) : {};
    }
    await next();
  };
}

// ── Static file middleware ────────────────────────────────────────────────────
function staticMiddleware(root) {
  const absRoot = resolve(root);
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // Strip the mount-path prefix that the dispatcher stored on the request
    const prefix = req._mountPath ?? '';
    let relUrl = req.url.split('?')[0];
    if (prefix && relUrl.startsWith(prefix)) relUrl = relUrl.slice(prefix.length) || '/';

    // Guard against path traversal
    const safe     = normalize(decodeURIComponent(relUrl)).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = join(absRoot, safe);
    if (!filePath.startsWith(absRoot + '/') && filePath !== absRoot) return next();

    try {
      let fstat  = await stat(filePath);
      let target = filePath;

      if (fstat.isDirectory()) {
        target = join(filePath, 'index.html');
        fstat  = await stat(target);  // throws if index.html absent → next()
      }

      const mime = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', fstat.size);
      res.statusCode = 200;

      if (req.method === 'HEAD') { res.end(); return; }

      const stream = createReadStream(target);
      stream.on('error', () => { if (!res.headersSent) next(); });
      stream.pipe(res);
    } catch {
      next();  // file not found or unreadable → pass through to next layer
    }
  };
}

// ── App factory ───────────────────────────────────────────────────────────────
function createApp() {
  const layers = [];  // { path: string | null, fn }
  const routes = [];  // { method, pattern, compiled, fn }

  function use(pathOrFn, fn) {
    if (typeof pathOrFn === 'function') layers.push({ path: null,    fn: pathOrFn });
    else                                layers.push({ path: pathOrFn, fn });
  }

  function addRoute(method, pattern, fn) {
    routes.push({ method: method.toUpperCase(), pattern, compiled: compilePattern(pattern), fn });
  }

  async function dispatch(req, res) {
    const url      = req.url ?? '/';
    const pathname = url.split('?')[0];
    const method   = (req.method ?? 'GET').toUpperCase();

    // Augment res
    res.status = (code) => { res.statusCode = code; return res; };
    res.json   = (data) => {
      if (res.headersSent) return;
      const body = JSON.stringify(data);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(body);
    };

    // Augment req
    req.params = {};
    req.query  = Object.fromEntries(
      new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
    );

    // Build chain: matching middleware layers (in registration order), then route
    const chain = [];

    for (const layer of layers) {
      if (layer.path === null) {
        chain.push({ fn: layer.fn, mountPath: null });
      } else {
        const mp = layer.path === '/' ? '' : layer.path;
        if (pathname === layer.path || pathname.startsWith(mp + '/')) {
          chain.push({ fn: layer.fn, mountPath: mp });
        }
      }
    }

    // Route matching
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = pathname.match(route.compiled.regex);
      if (m) {
        req.params = {};
        route.compiled.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
        chain.push({ fn: route.fn, mountPath: null });
        break;
      }
    }

    // Execute chain
    let i = 0;
    async function next(err) {
      if (err) {
        if (!res.headersSent) { res.statusCode = 500; res.end(String(err?.message ?? err)); }
        return;
      }
      if (i >= chain.length) {
        if (!res.headersSent) { res.statusCode = 404; res.end('Not Found'); }
        return;
      }
      const { fn, mountPath } = chain[i++];
      req._mountPath = mountPath;
      try   { await fn(req, res, next); }
      catch (e) {
        if (!res.headersSent) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
      }
    }

    await next();
  }

  return {
    use,
    get:    (p, fn) => addRoute('GET',    p, fn),
    post:   (p, fn) => addRoute('POST',   p, fn),
    put:    (p, fn) => addRoute('PUT',    p, fn),
    delete: (p, fn) => addRoute('DELETE', p, fn),
    listen(port, cb) {
      const server = createServer((req, res) => {
        dispatch(req, res).catch(err => {
          if (!res.headersSent) { res.statusCode = 500; res.end('Internal Server Error'); }
          console.error('[http-server]', err);
        });
      });
      server.listen(port, cb);
      return server;
    },
  };
}

// ── Default export — express()-compatible callable with static methods ────────
function express() { return createApp(); }
express.json   = jsonMiddleware;
express.static = staticMiddleware;

export default express;
