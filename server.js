import { createServer } from 'node:http';

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
    headers.set('x-tg-init', 'local-dev');

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
    };
    
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