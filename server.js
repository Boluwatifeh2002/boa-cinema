import 'dotenv/config';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzip, brotliCompress, constants as zc } from 'node:zlib';
import { promisify } from 'node:util';
const gzipP = promisify(gzip);
const brP = promisify(brotliCompress);
import { createKV } from './kvstore.js';
import { fastStreams } from './fastStreams.js';
import { handleExtras } from './extras.js';
globalThis.__fastStreams = fastStreams;
const kvStore = createKV();
console.log('Settings storage:', kvStore.kind);

// Real Node require, so installed packages (cheerio-without-node-native, crypto-js, axios...) can load
const nodeRequire = createRequire(import.meta.url);

// --- ROBUST COMMONJS & EVAL SHIMS FOR NUVIO SCRAPERS ---
globalThis.moduleObj = { exports: {} };
globalThis.module = globalThis.moduleObj;
globalThis.exports = globalThis.moduleObj.exports;

// Scrapers are remote code downloaded from a GitHub repo, so only these modules are handed out.
// If a log line says "Module not allowed: xyz" and you trust it, add it here and run: npm install xyz
const ALLOWED_MODULES = new Set([
  'cheerio',
  'cheerio-without-node-native',
  'crypto-js',
  'axios',
  'crypto',
  'url',
  'querystring',
  'buffer',
  'util',
  'zlib'
]);

globalThis.customRequire = (mod) => {
  const name = String(mod).replace(/^node:/, '');
  if (!ALLOWED_MODULES.has(name)) {
    throw new Error(`Module not allowed: ${mod} (add it to ALLOWED_MODULES in server.js if you trust it)`);
  }
  try {
    return nodeRequire(name);
  } catch (e) {
    // Old stand-ins, used only if the real package is not installed
    if (name === 'axios') return globalThis.axios || { get: fetch, post: fetch };
    if (name === 'cheerio') return globalThis.cheerio || {};
    throw new Error(`Module not found: ${mod} (${e.code || e.message})`);
  }
};

// Intercept global Function constructor so dynamically evaluated scraper code
// never throws ReferenceError for moduleObj, module, exports or require.
// IMPORTANT: module / exports / moduleObj are only filled in when the caller did NOT pass its own.
// The worker passes its own per-scraper objects and reads results back from them,
// so overwriting them with globals would make every scraper return nothing.
const OriginalFunction = globalThis.Function;
globalThis.Function = function (...args) {
  if (args.length === 0) return new OriginalFunction();
  const body = args[args.length - 1];
  const params = args.slice(0, -1);
  const declared = params.flatMap((p) => String(p).split(',').map((s) => s.trim()));

  let prelude = '';
  if (!declared.includes('moduleObj')) prelude += 'var moduleObj = globalThis.moduleObj;\n';
  if (!declared.includes('module')) prelude += 'var module = globalThis.module;\n';
  if (!declared.includes('exports')) prelude += 'var exports = globalThis.exports;\n';
  // require always points at the allow-listed loader above
  prelude += 'var require = globalThis.customRequire;\n';

  return new OriginalFunction(...params, prelude + body);
};
globalThis.Function.prototype = OriginalFunction.prototype;
// -------------------------------------------------------

// Local file storage fallback for Cloudflare KV (BOT_USERS)
const ADDONS_FILE = path.join(process.cwd(), 'addons.json');

const mockBotUsersKV = {
  async get(key) {
    try {
      if (fs.existsSync(ADDONS_FILE)) {
        const data = fs.readFileSync(ADDONS_FILE, 'utf8');
        const json = JSON.parse(data);
        if (key === 'cfg:plugins' || key === 'cfg:addons') {
          return JSON.stringify(json);
        }
      }
    } catch (e) {
      console.error("Error reading addons.json:", e);
    }
    return null;
  },
  async put(key, value) {
    try {
      if (key === 'cfg:plugins' || key === 'cfg:addons') {
        let parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (Array.isArray(parsed)) {
          parsed = parsed.map(item => ({ cats: [], ...item }));
        } else if (parsed && Array.isArray(parsed.repos)) {
          parsed.repos = parsed.repos.map(item => ({ cats: [], ...item }));
        }
        fs.writeFileSync(ADDONS_FILE, JSON.stringify(parsed, null, 2), 'utf8');
      }
    } catch (e) {
      console.error("Error writing addons.json:", e);
    }
  }
};

// ==========================================
// 🔑 YOUR TOKENS & CONFIG:
// ==========================================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  TMDB_KEY: process.env.TMDB_KEY,
  OWNER_ID: process.env.OWNER_ID
};

// Polyfill Cloudflare's 'caches' API for Node.js environments
if (typeof globalThis.caches === 'undefined') {
  const memoryCache = new Map();
  const cacheStore = {
    match: async (req) => memoryCache.get(typeof req === 'string' ? req : req?.url),
    put: async (req, res) => {
      if (res) memoryCache.set(typeof req === 'string' ? req : req?.url, res.clone());
    },
    delete: async (req) => memoryCache.delete(typeof req === 'string' ? req : req?.url)
  };
  globalThis.caches = {
    default: cacheStore,
    open: async () => cacheStore
  };
}

import worker from './boacinemaupdatedWorker.js';

// ==========================================================================
// ZERO VIDEO PROXYING + SLIM JSON
// Video bytes must never pass through this server: players connect straight to the stream host.
// Set ALLOW_VIDEO_PROXY=1 only if you ever need the old behaviour back.
// ==========================================================================
const ALLOW_VIDEO_PROXY = process.env.ALLOW_VIDEO_PROXY === '1';
const VIDEO_TYPE = /^(video|audio)\/|octet-stream|mp2t|matroska|x-mpegts|x-flv|mpegurl|dash\+xml/i;

// ALL relay / proxy / stream-forwarding is OFF on this server. Nothing media-shaped is ever answered from Render:
//  - /api/relay (and any /proxy, /relay, /hls, /stream... alias) answers 410 Gone, playlists included
//  - any path that looks like a media file (.m3u8 .ts .m4s .mp4 .mkv .webm ...) answers 410 Gone
// The signed relay links the app builds point at the Cloudflare Worker (WBASE), so the privacy relay keeps working there.
// Tiny helper routes (/api/relay-sign, /api/ping, /api/size, /api/probe) stay: they only sign a link or read a few bytes.
const BLOCK_PATH = /^\/(api\/)?(relay|proxy|hls|stream-proxy|streamproxy|dl|download|segment|seg)(\/|$)/i;
const MEDIA_EXT = /\.(m3u8|m3u|mpd|ts|m4s|m4v|mp4|mkv|webm|avi|mov|flv|aac|mp3|m4a|ogg|opus)$/i;
function blockMedia(req, res, reqUrl) {
  const p = reqUrl.pathname;
  if (ALLOW_VIDEO_PROXY || !(BLOCK_PATH.test(p) || MEDIA_EXT.test(p))) return false;
  res.statusCode = req.method === 'OPTIONS' ? 204 : 410;
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  res.setHeader('access-control-allow-headers', 'range, if-range, content-type');
  res.setHeader('cache-control', 'public, max-age=3600');
  if (req.method === 'OPTIONS' || req.method === 'HEAD') { res.end(); return true; }
  res.setHeader('content-type', 'application/json');
  res.end('{"error":"This server does not relay or proxy streams. Use the direct stream url."}');
  return true;
}

// Compact stream objects: only what the apps use. Bulky metadata (behaviorHints, sources, raw, descriptions...) is dropped.
const SUB_KEYS = ['lang', 'label', 'name', 'url', 'u', 'n', 'from', 'kind'];
function slimSubs(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const x of list.slice(0, 30)) {
    if (typeof x === 'string') { out.push(x); continue; }
    if (!x || typeof x !== 'object') continue;
    const o = {};
    for (const k of SUB_KEYS) if (x[k] !== undefined && x[k] !== null && x[k] !== '') o[k] = x[k];
    if (Object.keys(o).length) out.push(o);
  }
  return out.length ? out : undefined;
}
function slimStream(st) {
  if (!st || typeof st !== 'object') return st;
  const o = {};
  if (st.title !== undefined) o.title = String(st.title).slice(0, 160);
  if (st.url !== undefined) o.url = st.url;
  if (st.quality) o.quality = st.quality;
  if (st.size) o.size = st.size;
  if (st.provider) o.provider = st.provider;
  const subs = slimSubs(st.subtitles);
  if (subs) o.subtitles = subs;
  const subs2 = slimSubs(st.subs);
  if (subs2) o.subs = subs2;
  // small flags the apps still rely on (request headers some hosts need, torrent / not-web-ready markers)
  if (st.headers && typeof st.headers === 'object' && Object.keys(st.headers).length) o.headers = st.headers;
  if (st.torrent) { o.torrent = true; if (st.seeders) o.seeders = st.seeders; }
  if (st.notWebReady) o.notWebReady = true;
  if (st.lt) o.lt = st.lt;                       // language badge (ORIGINAL / EN / ES / LAT / FR / KO / MULTI)
  if (st.lc) o.lc = st.lc;
  if (typeof st.lr === 'number') o.lr = st.lr;   // language rank: 0 original ... 2 mismatched dub
  if (st.cx) o.cx = 1;                           // 1 = not browser-safe (HEVC / AC3 / DTS / MKV / MPD)
  if (Array.isArray(st.cf) && st.cf.length) o.cf = st.cf.slice(0, 5);
  return o;
}
// Render keeps 0 MB of disk for streams: raw infoHash-only torrent objects become plain magnet links (no url and no valid hash: dropped), torrent caching is switched off.
process.env.TORRENT_CACHE = '0'; process.env.TORRENT_DISK_CACHE = '0'; process.env.WEBTORRENT_DISABLED = '1'; process.env.DISABLE_TORRENTS = '1';
function toMagnet(s) {
  if (!s || typeof s !== 'object' || s.url || !s.infoHash) return s;
  const h = String(s.infoHash).trim();
  if (!/^[a-f0-9]{40}$/i.test(h) && !/^[a-z2-7]{32}$/i.test(h)) return s;
  const dn = String(s.title || s.name || 'stream').split('\n')[0].slice(0, 100);
  let m = 'magnet:?xt=urn:btih:' + h + '&dn=' + encodeURIComponent(dn);
  const tr = (Array.isArray(s.sources) ? s.sources : []).map((x) => String(x).replace(/^tracker:/, '')).filter((x) => /^(udp|http|https|wss?):\/\//i.test(x)).slice(0, 8);
  (tr.length ? tr : ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.tracker.cl:1337/announce', 'udp://tracker.torrent.eu.org:451/announce']).forEach((t) => { m += '&tr=' + encodeURIComponent(t); });
  return { ...s, url: m, torrent: true };   // a plain magnet string: the viewer's own torrent app opens it, nothing is fetched or stored here
}
const rawTorrent = (st) => !!st && typeof st === 'object' && !st.url && (st.infoHash !== undefined || st.fileIdx !== undefined || st.torrent === true);
function slimPayload(data) {
  if (Array.isArray(data)) data = data.map(toMagnet).filter((x) => !rawTorrent(x));
  else if (data && typeof data === 'object' && Array.isArray(data.streams)) data = { ...data, streams: data.streams.map(toMagnet).filter((x) => !rawTorrent(x)) };
  if (Array.isArray(data)) return data.map(slimStream);
  if (data && typeof data === 'object' && Array.isArray(data.streams)) return { ...data, streams: data.streams.map(slimStream) };
  return data;
}
const SLIM_PATHS = new Set(['/api/streams', '/api/plugin-streams']);

// ==========================================================================
// COMPRESSION (brotli / gzip) + CACHE HEADERS
// Only text-like responses are compressed; video/audio is never touched.
// ==========================================================================
const COMPRESSIBLE = /json|html|javascript|ecmascript|text\/(plain|css|html|xml|vtt|javascript)|xml|svg|mpegurl|manifest/i;
const MIN_COMPRESS = 860;                 // tiny bodies cost more to compress than to send
const MAX_BUFFER = 4 * 1024 * 1024;       // bigger text bodies are streamed uncompressed (keeps memory low)
const ZCACHE = new Map();                 // compressed copies of repeated bodies (the app page, scripts); capped
const ZCACHE_MAX = 16;

function pickEncoding(req) {
  const a = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (/(^|[\s,])br(\s*;|\s*,|\s*$)/.test(a)) return 'br';
  if (/(^|[\s,])gzip(\s*;|\s*,|\s*$)/.test(a)) return 'gzip';
  return '';
}
async function compressBuf(buf, enc) {
  const key = enc + ':' + createHash('sha1').update(buf).digest('hex');
  const hit = ZCACHE.get(key);
  if (hit) { ZCACHE.delete(key); ZCACHE.set(key, hit); return hit; }
  const out = enc === 'br'
    ? await brP(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : await gzipP(buf, { level: 6 });
  ZCACHE.set(key, out);
  while (ZCACHE.size > ZCACHE_MAX) ZCACHE.delete(ZCACHE.keys().next().value);
  return out;
}
function addVary(h, v) {
  const cur = String(h['vary'] || '');
  if (!cur) h['vary'] = v;
  else if (!cur.toLowerCase().split(',').map((x) => x.trim()).includes(v.toLowerCase()) && cur.trim() !== '*') h['vary'] = cur + ', ' + v;
}

// Cache policy for stream LOOKUPS. Progressive polls (p=1), warm-ups and forced refreshes (r=1) are never cached;
// a finished lookup may be reused for a few minutes (the worker already sets a policy on its own answers, which is kept).
function streamCacheControl(reqUrl, existing, count, isPrivate) {
  const q = reqUrl.searchParams;
  const fresh = q.get('r') && q.get('r') !== '0';
  if (q.get('p') === '1' || q.get('warm') === '1' || fresh) return existing || 'no-store';
  if (existing && !/no-store|no-cache/i.test(existing)) return existing;
  const scope = isPrivate ? 'private' : 'public';
  return count > 0 ? scope + ', max-age=300, stale-while-revalidate=120' : scope + ', max-age=30';
}

// One place that writes a finished (buffered) response: ETag / 304, compression, headers.
async function sendBuf(req, res, status, hdrs, buf, opts = {}) {
  const h = { ...hdrs };
  delete h['content-length'];
  delete h['transfer-encoding'];
  const body = typeof buf === 'string' ? Buffer.from(buf) : buf;
  const noStore = /no-store/i.test(h['cache-control'] || '');
  if (opts.etag && status === 200 && !noStore) {
    const tag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 22) + '"';
    h['etag'] = tag;
    const inm = String(req.headers['if-none-match'] || '');
    if (inm && inm.split(',').some((x) => x.trim().replace(/^W\//, '') === tag)) {
      delete h['content-type'];
      res.writeHead(304, h);
      res.end();
      return;
    }
  }
  let out = body;
  const enc = pickEncoding(req);
  const ctype = h['content-type'] || '';
  if (enc && req.method !== 'HEAD' && status !== 206 && status !== 204 && status !== 304 && !h['content-encoding'] && body.length >= MIN_COMPRESS && COMPRESSIBLE.test(ctype)) {
    try {
      out = await compressBuf(body, enc);
      h['content-encoding'] = enc;
      if (h['etag'] && !/^W\//.test(h['etag'])) h['etag'] = 'W/' + h['etag'];
    } catch { out = body; }
  }
  if (COMPRESSIBLE.test(ctype)) addVary(h, 'Accept-Encoding');
  h['content-length'] = String(out.length);
  res.writeHead(status, h);
  if (req.method === 'HEAD') res.end(); else res.end(out);
}

const PORT = process.env.PORT || 8787;

// ---- accounts: this server never touches D1, it asks the Worker who the caller is ----
const WORKER_BASE = (process.env.WORKER_URL || 'https://silent-block-5183.adesanyaalexandra.workers.dev').replace(/\/+$/, '');
const GATED_PATHS = new Set(['/api/streams', '/api/relay-sign', '/api/torrent-bridge', '/api/live']);   // the Worker code decides; this only passes the verified role
const roleMemo = new Map();
async function roleFromToken(auth) {
  const m = /^Bearer\s+(\S+)/i.exec(String(auth || ''));
  if (!m) return { r: '', ao: false };
  const tok = m[1];
  const hit = roleMemo.get(tok);
  if (hit && hit.t > Date.now()) return hit;
  let r = '', ao = false;
  try {
    const x = await fetch(WORKER_BASE + '/api/acct/me', { headers: { authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(7000) });
    if (x.ok) { const j = await x.json(); r = (j && j.user && j.user.role) || 'user'; ao = !!(j && j.user && j.user.ao); }
  } catch { return hit || { r: '', ao: false }; }   // Worker unreachable: do not cache the miss
  if (roleMemo.size > 500) roleMemo.clear();
  const out = { r, ao, t: Date.now() + (r ? 60000 : 15000) };
  roleMemo.set(tok, out);
  return out;
}

const server = createServer(async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `${protocol}://${host}${req.url}`;

    if (blockMedia(req, res, new URL(req.url, 'http://x'))) return;

    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    // Attach local dev header so the admin panel unlocks in desktop browsers
    const headers = new Headers(req.headers);
    headers.delete('x-boa-addons');
    headers.delete('x-boa-role');   // only this server may set it (after checking the login with the Worker); never trust a client copy
// Admin bypass only on your own PC. Never on Render or any public host.
const onRender = !!process.env.RENDER || process.env.NODE_ENV === 'production';
if (!onRender) {
  headers.set('x-tg-init', 'local-dev');
} else if (headers.get('x-tg-init') === 'local-dev') {
  headers.delete('x-tg-init');
}

    const request = new Request(url, {
      method: req.method,
      headers: headers,
      body: body && body.length ? body : undefined,
    });

    const env = {
      ...process.env,
      BOT_TOKEN: CONFIG.BOT_TOKEN,
      TMDB_KEY: CONFIG.TMDB_KEY,
      OWNER_ID: CONFIG.OWNER_ID,
      ALLOW_LOCAL_DEV: (process.env.RENDER || process.env.NODE_ENV === 'production') ? '' : '1',
      BOT_USERS: kvStore,
      AUTH_UPSTREAM: '1',   // logins are checked against the Worker (which owns the D1 database); this server only passes the verified role on
    };

    // Stream backend route: runs before the worker so nothing can intercept it
    const reqUrl = new URL(url);
    if (reqUrl.pathname === '/api/plugin-streams') {
      const isPublic = !!process.env.RENDER || process.env.NODE_ENV === 'production';
      const key = process.env.STREAM_KEY || '';
      const allowed = !isPublic || (key && req.headers['x-stream-key'] === key);
      if (!allowed) {
        res.setHeader('content-type', 'application/json');
        res.statusCode = 401;
        res.end('{"error":"unauthorized"}');
        return;
      }
      try {
        const out = await globalThis.__fetchPluginStreams(
          env,
          reqUrl.searchParams.get('id') || '',
          reqUrl.searchParams.get('type') || 'movie',
          Number(reqUrl.searchParams.get('s')) || 1,
          Number(reqUrl.searchParams.get('e')) || 1
        );
        const slim = slimPayload(out);
        const count = Array.isArray(slim) ? slim.length : (slim && Array.isArray(slim.streams) ? slim.streams.length : 0);
        await sendBuf(req, res, 200, {
          'content-type': 'application/json',
          'cache-control': streamCacheControl(reqUrl, '', count, isPublic && !!key),
          'vary': 'x-stream-key',
        }, JSON.stringify(slim), { etag: true });
      } catch (e) {
        console.error('plugin-streams failed:', e);
        await sendBuf(req, res, 500, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ error: String((e && e.message) || e) }));
      }
      return;
    }
    if (blockMedia(req, res, reqUrl)) return;   // /api/relay, /proxy, .m3u8/.ts/.mp4... => 410 Gone, before anything else runs
    if (await handleExtras(req, res, env, url)) return;
    const ctx = {
      waitUntil: (promise) => Promise.resolve(promise).catch(console.error),
      passThroughOnException: () => {}
    };

    // Accounts live in the Worker's D1 database, so sign-in and every /api/acct/* call (me, keys, get, sync, delete) go straight to the Worker.
    if (reqUrl.pathname.startsWith('/api/auth') || reqUrl.pathname.startsWith('/api/acct')) {
      const workerBase = WORKER_BASE;
      const targetUrl = `${workerBase}${reqUrl.pathname}${reqUrl.search}`;
      const fwdHeaders = new Headers(req.headers);
      fwdHeaders.delete('host');
      fwdHeaders.delete('connection');
      fwdHeaders.delete('content-length');

      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: fwdHeaders,
        body: req.method !== 'GET' && req.method !== 'HEAD' && body && body.length ? body : undefined,
      });

      const outHeaders = {};
      for (const [k, v] of proxyRes.headers.entries()) {
        // fetch() already decoded the body, so the old encoding / length headers would corrupt it
        if (/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) continue;
        outHeaders[k] = v;
      }
      outHeaders['cache-control'] = 'no-store';
      const buf = Buffer.from(await proxyRes.arrayBuffer());
      await sendBuf(req, res, proxyRes.status, outHeaders, buf);
      return;
    }
    // Stream lookups, relay signing and torrent links need a signed-in account: check the Bearer token with the Worker and pass the role on.
    if (GATED_PATHS.has(reqUrl.pathname) || reqUrl.pathname.startsWith('/api/admin/')) {
      const who = await roleFromToken(req.headers['authorization']);
      if (who.r) request.headers.set('x-boa-role', who.r);
      if (who.ao) request.headers.set('x-boa-addons', '1');
    }
    const response = await worker.fetch(request, env, ctx);
    const ctype = response.headers.get('content-type') || '';

    // Safety net: never pipe raw video/audio bytes, whichever route produced them.
    if (!ALLOW_VIDEO_PROXY && response.body && VIDEO_TYPE.test(ctype)) {
      try { await response.body.cancel(); } catch {}
      res.statusCode = 410;
      res.setHeader('content-type', 'application/json');
      res.setHeader('access-control-allow-origin', '*');
      res.end('{"error":"This server does not proxy video. Use the direct stream url."}');
      return;
    }

    const hdrs = {};
    for (const [key, value] of response.headers.entries()) hdrs[key] = value;

    // Slim stream lists (small JSON only; the body is read, trimmed and re-sent with cache headers).
    if (response.status === 200 && SLIM_PATHS.has(reqUrl.pathname) && /json/i.test(ctype)) {
      let text = await response.text();
      let count = 0;
      try {
        const slim = slimPayload(JSON.parse(text));
        count = Array.isArray(slim) ? slim.length : (slim && Array.isArray(slim.streams) ? slim.streams.length : 0);
        text = JSON.stringify(slim);
      } catch {}
      delete hdrs['content-encoding'];
      hdrs['cache-control'] = streamCacheControl(reqUrl, hdrs['cache-control'], count, false);
      await sendBuf(req, res, 200, hdrs, text, { etag: true });
      return;
    }

    // Other text responses (app page, scripts, JSON, playlists): compress when the client supports it.
    const clen = Number(hdrs['content-length']) || 0;
    if (response.body && COMPRESSIBLE.test(ctype) && !hdrs['content-encoding'] && response.status !== 206 && response.status !== 204 && response.status !== 304 && req.method !== 'HEAD' && clen <= MAX_BUFFER && pickEncoding(req)) {
      const buf = Buffer.from(await response.arrayBuffer());
      await sendBuf(req, res, response.status, hdrs, buf);
      return;
    }

    res.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }

    if (!response.body) {
      res.end();
    } else {
      const reader = response.body.getReader();
      res.on('close', () => { reader.cancel().catch(() => {}); });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.destroyed) break;
        if (!res.write(value)) {
          await new Promise((r) => res.once('drain', r).once('close', r));
        }
      }
      res.end();
    }
  } catch (err) {
    console.error('Server execution error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
