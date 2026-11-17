// fastStreams.js
// Runs plugin scrapers IN PARALLEL (the old code ran them one by one), caches the downloaded
// scripts and the results, and stops waiting after a deadline so the page never hangs.
// Works on your PC and on Render (it needs server.js's require shim). Not used on Cloudflare.

const SCRAPER_TIMEOUT = Number(process.env.SCRAPER_TIMEOUT_MS) || 12000; // each scraper
const DEADLINE = Number(process.env.SEARCH_DEADLINE_MS) || 25000; // whole search
const CONCURRENCY = Number(process.env.SCRAPER_CONCURRENCY) || 24;
const RESULT_TTL = 10 * 60 * 1000;
const EMPTY_TTL = 30 * 1000;
const CODE_TTL = 30 * 60 * 1000;
const MANIFEST_TTL = 10 * 60 * 1000;

// A scraper that fails later on its own must never crash the server.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', (e && e.message) || e));

const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
const scraperConsole = process.env.SCRAPER_LOGS === '1' ? console : quiet;

const manifestCache = new Map();
const compiled = new Map();
const resultCache = new Map();
const inflight = new Map();

function cached(map, key, ttl, loader) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = loader().catch((e) => {
    map.delete(key);
    throw e;
  });
  map.set(key, { t: Date.now(), p });
  return p;
}

async function fetchText(url, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function readRepos(env) {
  const kv = env && env.BOT_USERS;
  if (!kv) return [];
  const raw = (await kv.get('cfg:plugins')) || (await kv.get('cfg:addons'));
  if (!raw) return [];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : parsed.repos || parsed.addons || [];
}

function manifestUrlOf(repo) {
  if (typeof repo === 'string') return repo;
  if (!repo) return '';
  return repo.manifestUrl || repo.manifest || repo.url || repo.link || repo.href || '';
}

async function loadScrapers(env) {
  const repos = await readRepos(env);
  const out = [];
  await Promise.all(
    repos.map(async (repo) => {
      if (repo && repo.enabled === false) return;
      let mUrl = manifestUrlOf(repo);
      if (!mUrl) return;
      if (!/\.json(\?|$)/i.test(mUrl)) mUrl = mUrl.replace(/\/+$/, '') + '/manifest.json';
      try {
        const text = await cached(manifestCache, mUrl, MANIFEST_TTL, () => fetchText(mUrl));
        const manifest = JSON.parse(text);
        const base = mUrl.substring(0, mUrl.lastIndexOf('/') + 1);
        for (const s of manifest.scrapers || []) {
          if (s.enabled === false) continue;
          const url = s.url || (s.filename ? base + s.filename : '');
          if (!url) continue;
          out.push({
            repo: (repo && repo.name) || manifest.name || mUrl,
            name: s.name || s.id || url,
            id: s.id,
            url,
            types: s.supportedTypes,
          });
        }
      } catch (e) {
        console.error('[fast] manifest failed ' + mUrl + ': ' + e.message);
      }
    })
  );
  return out;
}

function getScraperFn(entry) {
  return cached(compiled, entry.url, CODE_TTL, async () => {
    const code = await fetchText(entry.url, 12000);
    const moduleObj = { exports: {} };
    const req = globalThis.customRequire || (() => ({}));
    const fn = new Function('module', 'exports', 'require', 'moduleObj', 'fetch', 'console', code);
    fn(moduleObj, moduleObj.exports, req, moduleObj, globalThis.fetch, scraperConsole);
    const exp = moduleObj.exports || {};
    const getStreams =
      exp.getStreams ||
      exp.getstreams ||
      (exp.default && (exp.default.getStreams || exp.default.getstreams));
    if (typeof getStreams !== 'function') throw new Error('no getStreams export');
    return getStreams;
  });
}

async function runScraper(entry, id, type, season, episode, timeoutMs = SCRAPER_TIMEOUT) {
  const t0 = Date.now();
  try {
    const getStreams = await getScraperFn(entry);
    const result = await withTimeout(
      Promise.resolve(getStreams(String(id), type, Number(season) || 1, Number(episode) || 1)),
      timeoutMs
    );
    const list = Array.isArray(result) ? result : [];
    return {
      ok: true,
      ms: Date.now() - t0,
      streams: list.map((s) => ({ ...s, provider: entry.name || s.provider })),
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, streams: [], error: String((e && e.message) || e) };
  }
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function supports(entry, type) {
  if (!Array.isArray(entry.types) || entry.types.length === 0) return true;
  const wanted = type === 'tv' ? ['tv', 'series'] : ['movie'];
  return entry.types.some((t) => wanted.includes(String(t).toLowerCase()));
}

function onlyList(env) {
  return String((env && env.ONLY_SCRAPERS) || process.env.ONLY_SCRAPERS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function search(env, id, type, season, episode, only, key) {
  let list = (await loadScrapers(env)).filter((e) => supports(e, type));
  if (only.length) {
    list = list.filter((e) => only.some((o) => String(e.name || e.id).toLowerCase().includes(o)));
  }
  const all = [];
  let done = 0;
  const entry = { t: Date.now(), list: all };
  resultCache.set(key, entry);

  const finished = pool(list, CONCURRENCY, async (e) => {
    const r = await runScraper(e, id, type, season, episode);
    done++;
    if (r.ok && r.streams.length) {
      all.push(...r.streams);
      console.log('[fast] ' + e.name + ': ' + r.streams.length + ' streams in ' + r.ms + 'ms');
    }
  }).then(() => {
    entry.t = Date.now();
  });

  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, DEADLINE))]);
  console.log('[fast] ' + type + ' ' + id + ': ' + all.length + ' streams, ' + done + '/' + list.length + ' scrapers finished');
  return all;
}

export async function fastStreams(env, tmdbId, mediaType, season = 1, episode = 1) {
  const type = mediaType === 'series' ? 'tv' : mediaType || 'movie';
  const only = onlyList(env);
  const key = [type, tmdbId, season, episode, only.join(',')].join('|');

  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.t < (hit.list.length ? RESULT_TTL : EMPTY_TTL)) return hit.list.slice();

  if (inflight.has(key)) return (await inflight.get(key)).slice();
  const p = search(env, tmdbId, type, season, episode, only, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return (await p).slice();
}

// ---- helpers for the provider tester page ----
export async function listProviders(env) {
  const all = await loadScrapers(env);
  return all.map(({ repo, name, id, types }) => ({ repo, name, id, types }));
}

export async function testProvider(env, name, id, type, season, episode) {
  const all = await loadScrapers(env);
  const wanted = String(name || '').toLowerCase();
  const entry =
    all.find((e) => String(e.name || e.id).toLowerCase() === wanted) ||
    all.find((e) => String(e.name || e.id).toLowerCase().includes(wanted));
  if (!entry) return { name, ok: false, count: 0, ms: 0, error: 'provider not found' };
  compiled.delete(entry.url); // always test a fresh copy
  const r = await runScraper(entry, id, type === 'tv' ? 'tv' : 'movie', season, episode, 20000);
  return {
    name: entry.name,
    ok: r.ok && r.streams.length > 0,
    count: r.streams.length,
    ms: r.ms,
    error: r.ok && r.streams.length === 0 ? 'ran fine but found no streams for this title' : r.error,
    sample: r.streams.slice(0, 3).map((s) => ({
      title: String(s.title || s.name || '').slice(0, 100),
      quality: s.quality || '',
      url: s.url ? String(s.url).slice(0, 100) : '',
    })),
  };
}
