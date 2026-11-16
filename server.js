import 'dotenv/config';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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
  BOT_USERS: mockBotUsersKV 
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