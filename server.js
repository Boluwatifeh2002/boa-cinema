import 'dotenv/config';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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

const PORT = process.env.PORT || 8787;

const server = createServer(async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `${protocol}://${host}${req.url}`;

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
      BOT_USERS: kvstore
    };

    // Stream backend route: runs before the worker so nothing can intercept it
    const reqUrl = new URL(url);
    if (reqUrl.pathname === '/api/plugin-streams') {
      const isPublic = !!process.env.RENDER || process.env.NODE_ENV === 'production';
      const key = process.env.STREAM_KEY || '';
      const allowed = !isPublic || (key && req.headers['x-stream-key'] === key);
      res.setHeader('content-type', 'application/json');
      if (!allowed) {
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
        res.statusCode = 200;
        res.end(JSON.stringify(out));
      } catch (e) {
        console.error('plugin-streams failed:', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      }
      return;
    }
    if (await handleExtras(req, res, env, url)) return;
    const ctx = {
      waitUntil: (promise) => Promise.resolve(promise).catch(console.error),
      passThroughOnException: () => {}
    };

    const response = await worker.fetch(request, env, ctx);

    res.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }

    const responseBuffer = Buffer.from(await response.arrayBuffer());
    res.end(responseBuffer);
  } catch (err) {
    console.error('Server execution error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
