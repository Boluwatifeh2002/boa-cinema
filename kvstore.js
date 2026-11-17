// kvstore.js
// One place for admin settings (notice, plugins, addons, picks...).
// If CF_ACCOUNT_ID + CF_KV_NAMESPACE_ID + CF_API_TOKEN are set, this talks to the SAME
// Cloudflare KV namespace your Worker uses, so local, Render and Cloudflare all share data.
// Otherwise it falls back to a local file (kv-local.json).
import fs from 'node:fs';
import path from 'node:path';

const READ_CACHE_MS = 5000;
const rawCache = new Map();

function convert(text, opts) {
  if (text == null) return null;
  const type = typeof opts === 'string' ? opts : opts && opts.type;
  if (type === 'json') {
    try { return JSON.parse(text); } catch { return null; }
  }
  return text;
}

function remoteKV(acct, ns, token) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${ns}`;
  const auth = { Authorization: `Bearer ${token}` };
  const valueUrl = (key) => `${base}/values/${encodeURIComponent(key)}`;

  return {
    kind: 'Cloudflare KV (shared with the Worker)',

    async get(key, opts) {
      const hit = rawCache.get(key);
      if (hit && Date.now() - hit.t < READ_CACHE_MS) return convert(hit.v, opts);
      const r = await fetch(valueUrl(key), { headers: auth });
      if (r.status === 404) {
        rawCache.set(key, { v: null, t: Date.now() });
        return null;
      }
      if (!r.ok) throw new Error(`KV read failed for "${key}": HTTP ${r.status}`);
      const text = await r.text();
      rawCache.set(key, { v: text, t: Date.now() });
      return convert(text, opts);
    },

    async put(key, value, opts) {
      const body = typeof value === 'string' ? value : JSON.stringify(value);
      const ttl = opts && opts.expirationTtl ? `?expiration_ttl=${Math.max(60, Number(opts.expirationTtl))}` : '';
      const r = await fetch(valueUrl(key) + ttl, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/octet-stream' },
        body,
      });
      if (!r.ok) throw new Error(`KV write failed for "${key}": HTTP ${r.status}`);
      rawCache.set(key, { v: body, t: Date.now() });
    },

    async delete(key) {
      const r = await fetch(valueUrl(key), { method: 'DELETE', headers: auth });
      if (!r.ok && r.status !== 404) throw new Error(`KV delete failed for "${key}": HTTP ${r.status}`);
      rawCache.delete(key);
    },

    async list(opts = {}) {
      const q = new URLSearchParams();
      if (opts.prefix) q.set('prefix', opts.prefix);
      if (opts.limit) q.set('limit', String(opts.limit));
      if (opts.cursor) q.set('cursor', opts.cursor);
      const r = await fetch(`${base}/keys?${q}`, { headers: auth });
      if (!r.ok) throw new Error(`KV list failed: HTTP ${r.status}`);
      const j = await r.json();
      const cursor = j.result_info && j.result_info.cursor;
      return { keys: j.result || [], list_complete: !cursor, cursor: cursor || undefined };
    },
  };
}

function localKV() {
  const file = path.join(process.cwd(), 'kv-local.json');
  const legacy = path.join(process.cwd(), 'addons.json');
  const load = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const save = (obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  const isPluginKey = (k) => k === 'cfg:plugins' || k === 'cfg:addons';

  return {
    kind: 'local file (kv-local.json), NOT shared',

    async get(key, opts) {
      const store = load();
      if (key in store) return convert(store[key], opts);
      if (isPluginKey(key) && fs.existsSync(legacy)) {
        try { return convert(fs.readFileSync(legacy, 'utf8'), opts); } catch { /* ignore */ }
      }
      return null;
    },

    async put(key, value) {
      let text = typeof value === 'string' ? value : JSON.stringify(value);
      if (isPluginKey(key)) {
        try {
          const p = JSON.parse(text);
          if (Array.isArray(p)) text = JSON.stringify(p.map((i) => ({ cats: [], ...i })));
          else if (p && Array.isArray(p.repos)) {
            p.repos = p.repos.map((i) => ({ cats: [], ...i }));
            text = JSON.stringify(p);
          }
        } catch { /* keep text as is */ }
      }
      const store = load();
      store[key] = text;
      save(store);
    },

    async delete(key) {
      const store = load();
      delete store[key];
      save(store);
    },

    async list(opts = {}) {
      const store = load();
      const prefix = opts.prefix || '';
      const keys = Object.keys(store).filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

export function createKV() {
  const acct = process.env.CF_ACCOUNT_ID;
  const ns = process.env.CF_KV_NAMESPACE_ID;
  const token = process.env.CF_API_TOKEN;
  if (acct && ns && token) return remoteKV(acct, ns, token);
  return localKV();
}
