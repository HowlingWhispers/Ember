/**
 * Ember's protected first-party HTTP service.
 * Orbis issues one-time launch tickets; every Ember request checks the linked
 * Orbis session. No independent Discord account or shared browser cookie.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/ember';
const COOKIE = 'ember.sid';
const SESSION_TTL = 8 * 60 * 60_000;
const ALLOWED_FILES = new Map([
  ['/ember/', ['index.html', 'text/html; charset=utf-8']],
  ['/ember/src/bootstrap.js', ['src/bootstrap.js', 'text/javascript; charset=utf-8']],
  ['/ember/src/app.js', ['src/app.js', 'text/javascript; charset=utf-8']],
  ['/ember/src/engine.js', ['src/engine.js', 'text/javascript; charset=utf-8']],
  ['/ember/src/storage.js', ['src/storage.js', 'text/javascript; charset=utf-8']],
  ['/ember/src/coda-sound.js', ['src/coda-sound.js', 'text/javascript; charset=utf-8']],
  ['/ember/assets/sounds/hey-listen.mp3', ['assets/sounds/hey-listen.mp3', 'audio/mpeg']],
  ['/ember/src/styles.css', ['src/styles.css', 'text/css; charset=utf-8']],
]);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const safeSessionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const safeLinkId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * Orbis launches Ember through a cross-origin, top-level HTML form POST.
 * Some browsers/privacy policies omit Origin (or set it to "null") for form
 * navigations. When Origin is present and concrete, it MUST match Orbis.
 *
 * For redacted Origin only, accept a browser-attested, same-site document
 * navigation. Sec-Fetch-* headers cannot be authored by browser JavaScript.
 * The opaque one-use ticket still has to be redeemed against Orbis afterward.
 *
 * Do not relax this for arbitrary requests or a cross-site navigation:
 * that would permit third-party login-CSRF attempts with their own tickets.
 */
function isTrustedLaunchNavigation(request, orbisOrigin) {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    return origin === orbisOrigin;
  }
  if (origin != null && origin !== '' && origin !== 'null') return false;
  return request.headers['sec-fetch-site'] === 'same-site'
    && request.headers['sec-fetch-mode'] === 'navigate'
    && request.headers['sec-fetch-dest'] === 'document';
}

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function respond(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type });
  response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function readCookie(request) {
  const raw = request.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...parts] = part.trim().split('=');
    if (key === COOKIE && parts.length) {
      const value = parts.join('=');
      if (safeSessionId(value)) return value;
    }
  }
  return null;
}

async function readBody(request, limit = 4096) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body, 'utf8') > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  return body;
}

function validContext(value) {
  return value && safeLinkId(value.linkId) && safeLinkId(value.userId)
    && (value.mode === 'world' || value.mode === 'character')
    && value.asset && safeLinkId(value.asset.id) && value.asset.type === value.mode
    && typeof value.asset.name === 'string' && value.asset.name.length <= 300
    && typeof value.asset.summary === 'string' && value.asset.summary.length <= 20000;
}

export function createEmberServer({
  env = process.env,
  fetchFn = globalThis.fetch,
  rootDir = APP_ROOT,
} = {}) {
  if (typeof env.EMBER_BRIDGE_SECRET !== 'string' || env.EMBER_BRIDGE_SECRET.length < 32) {
    throw new Error('EMBER_BRIDGE_SECRET must match the 32+-character Orbis server bridge secret.');
  }
  // Use the URL origin, not the raw env string. A harmless trailing slash in
  // ORBIS_WEB_ORIGIN must not break authenticated launch requests.
  const orbisOrigin = new URL(env.ORBIS_WEB_ORIGIN || 'https://lib.thehowlingwhispers.com').origin;
  const orbisApi = (env.ORBIS_INTERNAL_URL || 'http://127.0.0.1:8789').replace(/\/$/, '');
  if (!orbisApi.startsWith('http://127.0.0.1:') && !orbisApi.startsWith('http://localhost:')) {
    throw new Error('ORBiS internal bridge must be loopback HTTP, not a public endpoint.');
  }
  const secureCookie = env.NODE_ENV === 'production';
  const sessions = new Map();

  async function orbis(path, value) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const reply = await fetchFn(`${orbisApi}/api/internal/ember/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.EMBER_BRIDGE_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(value), signal: controller.signal,
      });
      if (!reply.ok) return null;
      const data = await reply.json();
      return validContext(data) ? data : null;
    } finally { clearTimeout(timeout); }
  }
  async function authenticate(request) {
    const sid = readCookie(request);
    if (!sid) return null;
    const key = sha(sid);
    const entry = sessions.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { sessions.delete(key); return null; }
    const context = await orbis('check', { linkId: entry.linkId });
    if (!context || context.userId !== entry.userId || context.asset.id !== entry.assetId || context.mode !== entry.mode) {
      sessions.delete(key);
      return null;
    }
    return context;
  }
  const server = createServer(async (request, response) => {
    securityHeaders(response);
    const method = request.method ?? '';
    const path = (request.url ?? '').split('?')[0];
    try {
      if (path === '/ember/launch' && method === 'POST') {
        if (!isTrustedLaunchNavigation(request, orbisOrigin)) {
          return respond(response, 403, { error: 'Invalid launch origin.' });
        }
        if (!String(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
          return respond(response, 415, { error: 'Expected a form submission.' });
        }
        const ticket = new URLSearchParams(await readBody(request)).get('ticket');
        if (!safeSessionId(ticket)) return respond(response, 400, { error: 'Invalid launch ticket.' });
        const context = await orbis('redeem', { ticket });
        if (!context) return respond(response, 401, '<h1>Launch expired</h1><p>Return to Orbis and launch again.</p>', 'text/html; charset=utf-8');
        const sid = randomBytes(32).toString('base64url');
        sessions.set(sha(sid), { linkId: context.linkId, userId: context.userId, assetId: context.asset.id, mode: context.mode, expiresAt: Date.now() + SESSION_TTL });
        response.writeHead(303, {
          Location: '/ember/',
          'Set-Cookie': `${COOKIE}=${sid}; Path=/ember/; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}; Max-Age=${SESSION_TTL / 1000}`,
        });
        return response.end();
      }

      if (path === '/ember/api/health' && method === 'GET') return respond(response, 200, { ok: true, service: 'ember' });
      // Authentication is mandatory for all app assets and APIs. Never serve
      // the browser shell merely because a cookie *exists*.
      const context = await authenticate(request);
      if (!context) {
        if (method === 'GET' && path === '/ember/') {
          return respond(response, 401, '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Ember</title><h1>Sign in through Orbis</h1><p>Open a World or Character in <a href="https://lib.thehowlingwhispers.com/">Orbis</a>, then choose its Ember button.</p>', 'text/html; charset=utf-8');
        }
        return respond(response, 401, { error: 'An active Orbis login and approved Ember launch are required.' });
      }
      if (method === 'GET' && path === '/ember/api/auth-check') {
        response.writeHead(204); return response.end();
      }
      if (method === 'GET' && path === '/ember/api/session') {
        return respond(response, 200, { userId: context.userId, mode: context.mode, asset: context.asset });
      }
      if (method === 'POST' && path === '/ember/api/logout') {
        const sid = readCookie(request);
        if (sid) sessions.delete(sha(sid));
        response.writeHead(204, { 'Set-Cookie': `${COOKIE}=; Path=/ember/; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}; Max-Age=0` });
        return response.end();
      }
      if (method === 'GET' && ALLOWED_FILES.has(path)) {
        const [file, type] = ALLOWED_FILES.get(path);
        const content = await readFile(join(rootDir, file));
        response.writeHead(200, { 'Content-Type': type });
        return response.end(content);
      }
      return respond(response, 404, { error: 'Not found.' });
    } catch (error) {
      // Fail closed on an unavailable Orbis bridge; never serve cached private assets.
      return respond(response, error?.status ?? 503, { error: 'Orbis authorization is temporarily unavailable.' });
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createEmberServer();
  const port = Number(process.env.EMBER_PORT || 8794);
  server.listen(port, '127.0.0.1', () => console.log(`Ember auth service listening on 127.0.0.1:${port}`));
}
