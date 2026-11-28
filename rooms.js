// Cinema Lounge live channel: tiny in-memory rooms for chat, reactions and voice signaling.
// Text only. No audio or video ever passes through here (voice is peer-to-peer WebRTC), and nothing is written to D1 or disk.
// A room is created by the first member's request and is purged when everyone has gone quiet (chat buffer included).
const rooms = new Map();           // code -> { seq, ev: [], chat: [], mem: Map(uid -> { n, h, m, s, seen, last }), waiters: Set }
const memo = new Map();            // token|code -> { t, j }
const EMO = new Set(['\u{1F525}', '\u{1F602}', '\u{1F631}', '\u{1F62D}', '\u{1F44F}']);
const MAX_ROOMS = 400, MAX_CHAT = 50, MAX_EV = 300, HOLD_MS = 25000, GONE_MS = 70000;

function J(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// the Worker owns the accounts and the party list: it answers who this token is and whether they are in this party (a read, never a write)
async function who(workerBase, auth, code) {
  const m = /^Bearer\s+(\S+)/i.exec(String(auth || ''));
  if (!m || !/^[A-Z0-9]{6}$/.test(code)) return null;
  const k = m[1] + '|' + code, hit = memo.get(k);
  if (hit && hit.t > Date.now()) return hit.j;
  let j = null;
  try {
    const r = await fetch(workerBase + '/api/acct/party/live', { method: 'POST', headers: { authorization: 'Bearer ' + m[1], 'content-type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(7000) });
    if (r.ok) { const x = await r.json(); if (x && x.ok) j = { uid: String(x.uid), name: clean(x.name, 40) || 'Guest', host: !!x.host }; }
  } catch { return hit ? hit.j : null; }
  if (memo.size > 800) memo.clear();
  memo.set(k, { t: Date.now() + (j ? 45000 : 8000), j });
  return j;
}
function roomOf(code) {
  let r = rooms.get(code);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = { seq: 0, ev: [], chat: [], mem: new Map(), waiters: new Set() };
    rooms.set(code, r);
  }
  return r;
}
function push(r, e) {
  e.s = ++r.seq; e.at = Date.now();
  r.ev.push(e);
  if (r.ev.length > MAX_EV) r.ev.splice(0, r.ev.length - MAX_EV);
  for (const w of r.waiters) w();
}
const memList = (r) => [...r.mem.entries()].map(([u, m]) => ({ u, n: m.n, h: m.h ? 1 : 0, m: m.m ? 1 : 0, s: m.s ? 1 : 0 }));
const bucket = (m, key, gap) => { const n = Date.now(); if (n - (m.last[key] || 0) < gap) return false; m.last[key] = n; return true; };

export async function roomHandle(req, res, u, body, workerBase) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }); res.end(); return; }
  const path = u.pathname;
  let b = {};
  if (req.method === 'POST') { try { b = JSON.parse((body || Buffer.alloc(0)).toString('utf8') || '{}') || {}; } catch { return J(res, 400, { error: 'Bad request' }); } }
  const code = String(req.method === 'POST' ? b.code : u.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const me = await who(workerBase, req.headers['authorization'], code);
  if (!me) return J(res, 403, { error: 'You are not in this party.' });
  const r = roomOf(code);
  if (!r) return J(res, 503, { error: 'Live room is busy. Try again soon.' });
  let m = r.mem.get(me.uid);
  const joined = !m;
  if (!m) { if (r.mem.size >= 8) return J(res, 409, { error: 'Room is full.' }); m = { n: me.name, h: me.host, m: 0, s: 0, seen: 0, last: {} }; r.mem.set(me.uid, m); }
  m.seen = Date.now(); m.n = me.name; m.h = me.host;

  if (path === '/api/room/send' && req.method === 'POST') {
    const t = String(b.t || '');
    if (t === 'chat') {
      const x = clean(b.x, 200);
      if (!x) return J(res, 400, { error: 'Empty' });
      if (!bucket(m, 'chat', 600)) return J(res, 429, { error: 'Slow down a little.' });
      const e = { t: 'chat', u: me.uid, n: m.n, x };
      push(r, e); r.chat.push({ u: me.uid, n: m.n, x, at: e.at }); if (r.chat.length > MAX_CHAT) r.chat.splice(0, r.chat.length - MAX_CHAT);
    } else if (t === 'react') {
      const x = String(b.x || '');
      if (!EMO.has(x)) return J(res, 400, { error: 'Not allowed' });
      if (!bucket(m, 'react', 300)) return J(res, 429, { error: 'Slow down a little.' });
      push(r, { t: 'react', u: me.uid, n: m.n, x });
    } else if (t === 'sig') {
      const to = String(b.to || ''), d = b.d && typeof b.d === 'object' ? b.d : null, raw = d ? JSON.stringify(d) : '';
      if (!d || raw.length > 16000 || !r.mem.has(to) || to === me.uid) return J(res, 400, { error: 'Bad signal' });
      if (!bucket(m, 'sig', 15)) return J(res, 429, { error: 'Slow down.' });
      push(r, { t: 'sig', u: me.uid, to, d });
    } else if (t === 'spk') {
      const on = b.on ? 1 : 0;
      if (m.s !== on) { m.s = on; push(r, { t: 'spk', u: me.uid, on }); }
    } else if (t === 'mic') {
      const on = b.on ? 1 : 0;
      if (m.m !== on) { m.m = on; push(r, { t: 'mic', u: me.uid, on }); if (!on && m.s) { m.s = 0; push(r, { t: 'spk', u: me.uid, on: 0 }); } }
    } else if (t !== 'hi') return J(res, 400, { error: 'Unknown' });
    if (joined) push(r, { t: 'mem' });
    return J(res, 200, { ok: true });
  }

  if (path === '/api/room/poll' && req.method === 'GET') {
    const after = Math.max(0, parseInt(u.searchParams.get('after') || '0', 10) || 0);
    if (joined) push(r, { t: 'mem' });
    const out = () => ({ seq: r.seq, you: me.uid, mem: memList(r), ev: after ? r.ev.filter((e) => e.s > after && e.u !== me.uid && (!e.to || e.to === me.uid)) : [], chat: after ? undefined : r.chat.slice() });
    const ready = () => !after || r.ev.some((e) => e.s > after && e.u !== me.uid && (!e.to || e.to === me.uid));
    if (ready()) return J(res, 200, out());
    let done = false, timer = null;
    const fin = () => { if (done) return; done = true; clearTimeout(timer); r.waiters.delete(w); if (!res.writableEnded && !res.destroyed) J(res, 200, out()); };
    const w = () => { if (ready()) fin(); };
    r.waiters.add(w); timer = setTimeout(fin, HOLD_MS);
    req.on('close', () => { done = true; clearTimeout(timer); r.waiters.delete(w); });
    return;
  }
  return J(res, 404, { error: 'Not found' });
}

// rooms with nobody heard from for 70 s are dropped together with their chat; quiet members leave the roster
setInterval(() => {
  const n = Date.now();
  for (const [code, r] of rooms) {
    for (const [uid, m] of r.mem) if (n - m.seen > GONE_MS) { r.mem.delete(uid); push(r, { t: 'mem' }); }
    if (!r.mem.size) rooms.delete(code);
  }
  for (const [k, v] of memo) if (v.t < n) memo.delete(k);
}, 30000).unref();
