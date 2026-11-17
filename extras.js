// extras.js
// Extra routes handled BEFORE the worker:
//   /health                 keeps Render awake (use with a free uptime pinger)
//   /api/plugin-streams     stream search for Cloudflare + the phone app (key-protected on Render)
//   /provider-test          page to test every provider one by one
//   /api/provider-test      the API behind that page
import crypto from 'node:crypto';
import { fastStreams, listProviders, testProvider } from './fastStreams.js';

const isPublic = () => !!process.env.RENDER || process.env.NODE_ENV === 'production';

function keyOk(req, u) {
  if (!isPublic()) return true; // your own PC: open
  const key = process.env.STREAM_KEY || '';
  if (!key) return false;
  const given = Buffer.from(String(req.headers['x-stream-key'] || u.searchParams.get('key') || ''));
  const real = Buffer.from(key);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

function send(res, status, body, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('content-type', type + '; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Provider tester</title>
<style>
body{font-family:system-ui,sans-serif;background:#0e0e12;color:#eee;margin:0;padding:16px}
input,select,button{background:#22222a;color:#eee;border:1px solid #444;border-radius:8px;padding:8px;margin:2px}
button{cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:12px}
td{padding:8px;border-bottom:1px solid #2a2a33;vertical-align:top;font-size:14px}
.ok{color:#4ade80}.bad{color:#f87171}.dim{color:#888}
</style>
<h2>Provider tester</h2>
<div>
TMDB id <input id="id" value="1368337" size="9">
<select id="type"><option value="movie">movie</option><option value="tv">tv</option></select>
S <input id="s" value="1" size="2"> E <input id="e" value="1" size="2">
</div>
<button id="load">Load providers</button>
<button id="all">Test all</button>
<span id="info" class="dim"></span>
<table id="tbl"></table>
<script>
var KEY = new URLSearchParams(location.search).get("key") || "";
function api(q) {
  return fetch("/api/provider-test?" + q + (KEY ? "&key=" + encodeURIComponent(KEY) : "")).then(function (r) { return r.json(); });
}
function val(id) { return document.getElementById(id).value; }
var rows = [];
function cell(tr, text, cls) {
  var td = document.createElement("td");
  td.textContent = text;
  if (cls) td.className = cls;
  tr.appendChild(td);
  return td;
}
function testRow(row) {
  row.status.textContent = "testing...";
  row.status.className = "dim";
  var q = "action=run&name=" + encodeURIComponent(row.name) + "&id=" + encodeURIComponent(val("id")) +
    "&type=" + val("type") + "&s=" + val("s") + "&e=" + val("e");
  return api(q).then(function (r) {
    if (r.error && !r.name) { row.status.textContent = r.error; row.status.className = "bad"; return; }
    var text = (r.ok ? "OK " : "FAILED ") + r.count + " streams, " + r.ms + "ms";
    if (r.error) text += " - " + r.error;
    if (r.sample && r.sample[0]) text += " | " + r.sample[0].title + " " + r.sample[0].quality;
    row.status.textContent = text;
    row.status.className = r.ok ? "ok" : "bad";
  }).catch(function (e) { row.status.textContent = "error: " + e; row.status.className = "bad"; });
}
document.getElementById("load").onclick = function () {
  document.getElementById("info").textContent = " loading...";
  api("action=list").then(function (r) {
    var tbl = document.getElementById("tbl");
    tbl.textContent = "";
    rows = [];
    (r.providers || []).forEach(function (p) {
      var tr = document.createElement("tr");
      cell(tr, p.name);
      cell(tr, p.repo, "dim");
      var row = { name: p.name };
      row.status = cell(tr, "", "dim");
      var td = document.createElement("td");
      var b = document.createElement("button");
      b.textContent = "Test";
      b.onclick = function () { testRow(row); };
      td.appendChild(b);
      tr.appendChild(td);
      tbl.appendChild(tr);
      rows.push(row);
    });
    document.getElementById("info").textContent = " " + rows.length + " providers";
  });
};
document.getElementById("all").onclick = function () {
  var i = 0;
  function worker() {
    if (i >= rows.length) return Promise.resolve();
    var row = rows[i++];
    return testRow(row).then(worker);
  }
  for (var k = 0; k < 6; k++) worker();
};
document.getElementById("load").click();
</script>`;

export async function handleExtras(req, res, env, fullUrl) {
  let u;
  try {
    u = new URL(fullUrl);
  } catch {
    return false;
  }
  const p = u.pathname;

  if (p === '/health') {
    send(res, 200, 'ok', 'text/plain');
    return true;
  }

  if (p === '/api/plugin-streams') {
    if (!keyOk(req, u)) {
      send(res, 401, { error: 'unauthorized' });
      return true;
    }
    try {
      const out = await fastStreams(
        env,
        u.searchParams.get('id') || '',
        u.searchParams.get('type') || 'movie',
        Number(u.searchParams.get('s')) || 1,
        Number(u.searchParams.get('e')) || 1
      );
      send(res, 200, out);
    } catch (e) {
      console.error('plugin-streams failed:', e);
      send(res, 500, { error: String((e && e.message) || e) });
    }
    return true;
  }

  if (p === '/provider-test') {
    if (!keyOk(req, u)) {
      send(res, 401, 'unauthorized (open this page with ?key=YOUR_STREAM_KEY on the end)', 'text/plain');
      return true;
    }
    send(res, 200, PAGE, 'text/html');
    return true;
  }

  if (p === '/api/provider-test') {
    if (!keyOk(req, u)) {
      send(res, 401, { error: 'unauthorized' });
      return true;
    }
    try {
      if (u.searchParams.get('action') === 'list') {
        send(res, 200, { providers: await listProviders(env) });
      } else {
        send(
          res,
          200,
          await testProvider(
            env,
            u.searchParams.get('name') || '',
            u.searchParams.get('id') || '',
            u.searchParams.get('type') || 'movie',
            Number(u.searchParams.get('s')) || 1,
            Number(u.searchParams.get('e')) || 1
          )
        );
      }
    } catch (e) {
      send(res, 500, { error: String((e && e.message) || e) });
    }
    return true;
  }

  return false;
}
