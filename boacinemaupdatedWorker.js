// Boa Entertainment Bot - Cloudflare Worker (v92 fixes: add-ons, plugins, profiles, library; v91: Nuvio-style Media Servers & Plugins, Nuvio-style Boa Cinema, worldwide "Where to watch", library, caching)
//
// What it does
//   * Telegram bot: browse movies AND series by category/genre, type any title,
//     full cards (Info / Cast / Seasons / Where to watch), trailers inside Telegram,
//     one-screen-at-a-time chat (More / Back replace the previous message).
//   * Boa Cinema: a Nuvio-style Telegram Mini App (served by this same Worker at /app):
//     hero carousel, poster rows, episodes, worldwide "Where to watch", Library, Search, Profile.
//   * Music search: direct song and track links for Spotify, YouTube Music, Audiomack, and YouTube.
//   * Active users: tracks active members automatically via BOT_USERS KV binding.
//
// Secrets needed (Worker > Settings > Variables and Secrets):
//   BOT_TOKEN  - from BotFather
//   TMDB_KEY   - from themoviedb.org
//   OWNER_ID   - your own Telegram numeric id (send /myid to the bot to see it). Only this
//                account can open the Owner panel. Needs the BOT_USERS KV storage to save changes.
//
// Movie/series data: TMDB. Streaming data: JustWatch (via TMDB).
// This product uses the TMDB API but is not endorsed or certified by TMDB.

// ============================================================================
// 1. SETTINGS
// ============================================================================

const BRAND = "Boa Entertainment";

// BOA PICKS: titles you want to feature in "⭐ Boa Picks" even when TMDB doesn't list them yet.
// The app first looks the title up on TMDB (exact title match) and uses its poster and details.
// If TMDB doesn't have it, your own details below are used instead.
//   title   exact title
//   media   "movie" or "tv"
//   date    release date as "YYYY-MM-DD" (leave "" if not announced; the card shows SOON)
//   poster  full https image link of the poster (optional; without it a styled title card is shown)
//   note    one or two lines shown on the details page
//   trailer YouTube video id (optional, the part after v=)
const BOA_PICKS = [
  {
    title: "Jagun Jagun 2",
    media: "movie",
    date: "",
    poster: "",
    note: "The Nollywood epic sequel. Release date and details coming soon.",
    trailer: "",
  },
];

// Country used for "where to watch" until the user taps another flag.
// Use a 2-letter code that exists in WATCH_COUNTRIES below (NG, GH, ZA, GB, US).
const DEFAULT_REGION = "NG";

// Country whose Netflix catalogue fills the "On Netflix" rows (TMDB/JustWatch data).
// If that country has fewer than 6 matches the app quietly falls back to the US catalogue.
const NETFLIX_REGION = DEFAULT_REGION;

// Safety switch for the Mini App's data API (/api/*).
//   false = anyone with the link can call the API (works in any browser, good for testing).
//   true  = only requests coming from inside Telegram are answered. Each request carries Telegram's
//           signed "initData", which the Worker checks with BOT_TOKEN. Turn this on once you have
//           confirmed the app opens fine from the bot.
const REQUIRE_TELEGRAM = false;

const WATCH_COUNTRIES = {
  NG: ["🇳🇬", "Nigeria"],
  GH: ["🇬🇭", "Ghana"],
  ZA: ["🇿🇦", "South Africa"],
  GB: ["🇬🇧", "United Kingdom"],
  US: ["🇺🇸", "United States"],
};

// Movie genres (TMDB movie genre ids)
const GENRES = {
  "Action": 28,
  "Adventure": 12,
  "Animation": 16,
  "Comedy": 35,
  "Crime": 80,
  "Documentary": 99,
  "Drama": 18,
  "Family": 10751,
  "Fantasy": 14,
  "History": 36,
  "Horror": 27,
  "Music": 10402,
  "Mystery": 9648,
  "Romance": 10749,
  "Sci-Fi": 878,
  "Thriller": 53,
  "War": 10752,
  "Western": 37,
};

// Series genres. TMDB uses a different, shorter list for TV
// (no Horror / Romance / Thriller / History / Music, and some genres are combined).
const TV_GENRES = {
  "Action and Adventure": 10759,
  "Animation": 16,
  "Comedy": 35,
  "Crime": 80,
  "Documentary": 99,
  "Drama": 18,
  "Family": 10751,
  "Kids": 10762,
  "Mystery": 9648,
  "Reality": 10764,
  "Sci-Fi and Fantasy": 10765,
  "War and Politics": 10768,
  "Western": 37,
};

// When switching Movies <-> Series, these genres map onto each other
const TV_FROM_MOVIE_GENRE = {
  Action: "Action and Adventure",
  Adventure: "Action and Adventure",
  "Sci-Fi": "Sci-Fi and Fantasy",
  Fantasy: "Sci-Fi and Fantasy",
  War: "War and Politics",
};
const MOVIE_FROM_TV_GENRE = {
  "Action and Adventure": "Action",
  "Sci-Fi and Fantasy": "Sci-Fi",
  "War and Politics": "War",
  Kids: "Family",
};

const MEDIA = {
  movie: { path: "movie", label: "Movies", one: "movie", icon: "🎬", genres: GENRES },
  tv: { path: "tv", label: "Series", one: "series", icon: "📺", genres: TV_GENRES },
};

// defaultMedia = what a typed word like "kdrama" opens when the user didn't say movies/series
const REGIONS = {
  "Kdrama": { lang: "ko", country: "KR", label: "🇰🇷 K-Drama / Korean", defaultMedia: "tv" },
  "Nollywood": { country: "NG", label: "🇳🇬 Nollywood / Nigerian" },
  "Hollywood": { country: "US", label: "🇺🇸 Hollywood / US" },
  "Bollywood": { lang: "hi", country: "IN", label: "🇮🇳 Bollywood / Indian" },
  "Anime": { lang: "ja", type: "animation", label: "🇯🇵 Anime / Japanese", defaultMedia: "tv" },
};

// Typed words that map to a genre or region (lowercase, no spaces or dashes)
const ALIASES = {
  scifi: "Sci-Fi",
  sciencefiction: "Sci-Fi",
  kids: "Family",
  scary: "Horror",
  funny: "Comedy",
  documentaries: "Documentary",
  kdrama: "Kdrama",
  kdramas: "Kdrama",
  korean: "Kdrama",
  nollywood: "Nollywood",
  nigerian: "Nollywood",
  hollywood: "Hollywood",
  bollywood: "Bollywood",
  indian: "Bollywood",
  anime: "Anime",
  japanese: "Anime",
};

// Typed words that open the Faith / Christian category
const FAITH_WORDS = [
  "faith",
  "faithbased",
  "christian",
  "christianity",
  "gospel",
  "bible",
  "biblical",
  "jesus",
  "church",
];

const TV_WORDS = new Set(["series", "tv", "shows", "tvshows", "tvshow", "seasons", "season"]);
const MOVIE_WORDS = new Set(["movie", "movies", "film", "films"]);

// Ignored when checking whether the user typed a category ("best action movies" = "action")
const FILLER = new Set([
  "show", "me", "some", "best", "good", "top", "new", "latest", "any", "give",
  "recommend", "suggest", "please", "i", "want", "to", "watch", "see", "find",
  "a", "for", "the",
]);

const GREETINGS = new Set(["hi", "hello", "hey", "yo", "hola", "start", "menu", "help"]);

// Set from the Worker's own address on every request
let APP_URL = "";
let ORIGIN = "";

const regionNames = Object.keys(REGIONS);
const genreList = (media) => Object.keys(MEDIA[media].genres);
const norm = (t) => t.toLowerCase().replace(/[-\s]/g, "");
const sfx = (media) => (media === "tv" ? ":t" : "");
const mediaFromCb = (parts) => (parts[parts.length - 1] === "t" ? "tv" : "movie");

// Typed word -> { type: "genre" | "region" | "faith", name }
const CATEGORY_LOOKUP = new Map();
for (const g of Object.keys(GENRES)) CATEGORY_LOOKUP.set(norm(g), { type: "genre", name: g });
for (const g of Object.keys(TV_GENRES)) {
  if (!CATEGORY_LOOKUP.has(norm(g))) CATEGORY_LOOKUP.set(norm(g), { type: "genre", name: g });
}
for (const r of regionNames) CATEGORY_LOOKUP.set(norm(r), { type: "region", name: r });
for (const [alias, mapped] of Object.entries(ALIASES)) {
  CATEGORY_LOOKUP.set(
    alias,
    REGIONS[mapped] ? { type: "region", name: mapped } : { type: "genre", name: mapped }
  );
}
for (const w of FAITH_WORDS) CATEGORY_LOOKUP.set(w, { type: "faith" });
CATEGORY_LOOKUP.set("netflix", { type: "netflix" });

// A genre name for the other media type, or null when TMDB has no equivalent
function resolveGenre(name, media) {
  if (!name) return null;
  if (media === "tv") {
    if (TV_GENRES[name]) return name;
    return TV_FROM_MOVIE_GENRE[name] || null;
  }
  if (GENRES[name]) return name;
  return MOVIE_FROM_TV_GENRE[name] || null;
}

// ============================================================================
// 2. SMALL HELPERS
// ============================================================================

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

const titleOf = (m) => m.title || m.name || "Untitled";
const dateOf = (m) => m.release_date || m.first_air_date || "";
const yearOf = (m) => dateOf(m).slice(0, 4) || "N/A";
const ratingOf = (m) => (m.vote_average || 0).toFixed(1);

// Ids in buttons: movies are "123", series are "t123"
const tok = (media, id) => (media === "tv" ? `t${id}` : `${id}`);
function parseTok(t) {
  const m = /^(t?)(\d{1,9})$/.exec(t || "");
  return m ? { media: m[1] ? "tv" : "movie", id: m[2] } : null;
}

const cbOk = (s) => new TextEncoder().encode(s).length <= 64;

// Telegram photo captions allow 1024 visible characters. Tags like <b> don't count,
// and an entity like &amp; counts as 1 character.
const CAPTION_LIMIT = 1000;
const visibleLen = (html) =>
  html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt);/g, "x").length;

function formatDate(d) {
  if (!d) return "";
  try {
    return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch (e) {
    return d;
  }
}

// ============================================================================
// 3. TELEGRAM + TMDB HELPERS
// ============================================================================

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Mini App buttons only work in private chats. In groups, turn them into plain link buttons.
const webAppToUrl = (markup) =>
  markup && markup.inline_keyboard
    ? {
        inline_keyboard: markup.inline_keyboard.map((r) =>
          r.map((b) => (b.web_app ? { text: b.text, url: b.web_app.url } : b))
        ),
      }
    : markup;

async function tgSafe(env, method, payload) {
  const res = await tg(env, method, payload);
  if (!res.ok && payload.reply_markup && /BUTTON_TYPE_INVALID/i.test(res.description || "")) {
    return tg(env, method, { ...payload, reply_markup: webAppToUrl(payload.reply_markup) });
  }
  return res;
}

function say(env, chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgSafe(env, "sendMessage", payload);
}

// Opens the trailer in Telegram's in-app player window (falls back to a YouTube link)
function trailerButton(key, title) {
  if (ORIGIN) {
    return {
      text: "▶️ Play trailer",
      web_app: { url: `${ORIGIN}/trailer?v=${key}&t=${encodeURIComponent(clip(title, 80))}` },
    };
  }
  return { text: "▶️ Play trailer", url: `https://www.youtube.com/watch?v=${key}` };
}

async function tmdb(env, path, params = "") {
  const ic = (await getIntegrations(env)).tmdb;
  const key = (ic.on && ic.key) || env.TMDB_KEY;
  const lang = ic.on && ic.lang && ic.lang !== "en-US" && !/(^|&)language=/.test(params) ? "&language=" + encodeURIComponent(ic.lang) : "";
  const url =
    `https://api.themoviedb.org/3${path}?api_key=${key}${lang}` +
    (params ? `&${params}` : "");
  const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!res.ok) throw new Error("TMDB error " + res.status);
  return res.json();
}

function pickTrailerKey(m) {
  const yt = ((m.videos && m.videos.results) || []).filter((v) => v.site === "YouTube");
  const t =
    yt.find((v) => v.type === "Trailer" && v.official) ||
    yt.find((v) => v.type === "Trailer") ||
    yt.find((v) => v.type === "Teaser");
  return t && /^[\w-]{6,20}$/.test(t.key || "") ? t.key : null;
}

function pickCertification(m, region, media) {
  if (media === "tv") {
    const results = (m.content_ratings && m.content_ratings.results) || [];
    for (const cc of [region, "US", "GB"]) {
      const entry = results.find((r) => r.iso_3166_1 === cc);
      if (entry && entry.rating) return entry.rating;
    }
    return "";
  }
  const results = (m.release_dates && m.release_dates.results) || [];
  for (const cc of [region, "US", "GB"]) {
    const entry = results.find((r) => r.iso_3166_1 === cc);
    const cert =
      entry && (entry.release_dates || []).map((d) => d.certification).find(Boolean);
    if (cert) return cert;
  }
  return "";
}

// ============================================================================
// 5. FETCHING LISTS
// ============================================================================

async function discoverWithFallbackPage(env, media, baseParams) {
  const path = `/discover/${MEDIA[media].path}`;
  const page = Math.floor(Math.random() * 3) + 1;
  let data = await tmdb(env, path, `${baseParams}&page=${page}`);
  let results = data.results || [];
  if (!results.length && page !== 1) {
    data = await tmdb(env, path, `${baseParams}&page=1`);
    results = data.results || [];
  }
  return results;
}

const baseParams = (media, minVotes = 3) =>
  `sort_by=popularity.desc&vote_count.gte=${minVotes}` +
  (media === "movie" ? "&include_adult=false" : "");

async function fetchTitles(env, media, genreId = null, regionKey = null) {
  const reg = regionKey ? REGIONS[regionKey] : null;
  const genreIds = [];
  if (genreId) genreIds.push(genreId);
  if (reg && reg.type === "animation" && !genreIds.includes(16)) genreIds.push(16);

  let params = baseParams(media);
  if (genreIds.length) params += `&with_genres=${genreIds.join(",")}`;
  if (reg && reg.lang) params += `&with_original_language=${reg.lang}`;
  if (reg && reg.country) params += `&with_origin_country=${reg.country}`;

  let results = await discoverWithFallbackPage(env, media, params);

  if (!results.length && regionKey === "Anime") {
    results = await discoverWithFallbackPage(
      env,
      media,
      `${baseParams(media)}&with_original_language=ja&with_genres=16`
    );
  }
  return results;
}

// Faith category: TMDB has no "Christian" genre, so we use keywords (shared by movies and series).
// Keyword ids are looked up once by exact name, then remembered.
let faithKeywordIds = null;
const FAITH_KEYWORD_QUERIES = [
  "christianity",
  "christian",
  "jesus christ",
  "bible",
  "gospel",
  "faith",
];

async function getFaithKeywordIds(env) {
  if (faithKeywordIds && faithKeywordIds.length) return faithKeywordIds;
  const found = await Promise.all(
    FAITH_KEYWORD_QUERIES.map(async (q) => {
      try {
        const data = await tmdb(env, "/search/keyword", `query=${encodeURIComponent(q)}`);
        const exact = (data.results || []).find(
          (k) => String(k.name || "").toLowerCase() === q
        );
        return exact ? exact.id : null;
      } catch (e) {
        return null;
      }
    })
  );
  faithKeywordIds = [...new Set(found.filter(Boolean))];
  return faithKeywordIds;
}

async function fetchFaithTitles(env, media, ids) {
  const params = `${baseParams(media)}&with_keywords=${encodeURIComponent(ids.join("|"))}`;
  return discoverWithFallbackPage(env, media, params);
}

// ============================================================================
// 9. BOOKS AND SONGS (legal sources only)
// ============================================================================

// "Reply to the user's message" so the Close button can remove both messages
const replyTo = (messageId) =>
  messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {};

async function sayTo(env, chatId, text, replyMarkup, messageId) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...replyTo(messageId),
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgSafe(env, "sendMessage", payload);
}

const closeRow = [{ text: "✖ Close", callback_data: "x" }];

// Books: free and legal sources only. Project Gutenberg and Google Books "free ebooks" give full
// free copies; Open Library adds Internet Archive copies, borrowing and previews. Recent books are
// still under copyright, so for those the buttons lead to borrow, preview and buy options.
async function bookJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "BoaEntertainmentBot/1.0 (Telegram bot)" },
      signal: AbortSignal.timeout(6000),
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

async function handleBookSearch(env, chatId, query, messageId) {
  const q = String(query || "").trim();
  if (!q) {
    return sayTo(
      env,
      chatId,
      "📚 <b>Book search</b>\nType <code>/book &lt;title&gt;</code>, or a title followed by <b>pdf</b> (for example <code>atomic habits pdf</code>).",
      { inline_keyboard: [closeRow] },
      messageId
    );
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const enc = encodeURIComponent(q);

  const [ol, gut, gb] = await Promise.all([
    bookJson(
      "https://openlibrary.org/search.json?limit=5&fields=key,title,author_name,first_publish_year,ia,public_scan_b,has_fulltext&q=" +
        enc
    ),
    bookJson("https://gutendex.com/books/?search=" + enc),
    bookJson("https://www.googleapis.com/books/v1/volumes?maxResults=5&printType=books&filter=free-ebooks&q=" + enc),
  ]);

  // free full copies, de-duplicated by title
  const free = [];
  const seen = new Set();
  const addFree = (title, author, url, source) => {
    const key = String(title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (!key || !/^https:\/\//.test(url || "") || seen.has(key)) return;
    seen.add(key);
    free.push({ title, author: author || "", url, source });
  };
  for (const b of ((gut && gut.results) || []).slice(0, 3)) {
    addFree(
      b.title,
      b.authors && b.authors[0] && b.authors[0].name,
      `https://www.gutenberg.org/ebooks/${b.id}`,
      "Project Gutenberg"
    );
  }
  for (const it of ((gb && gb.items) || []).slice(0, 3)) {
    const vi = it.volumeInfo || {};
    const ai = it.accessInfo || {};
    const url = String(ai.webReaderLink || vi.infoLink || "").replace(/^http:/, "https:");
    addFree(vi.title, (vi.authors || [])[0], url, "Google Books");
  }
  const docs = (ol && ol.docs) || [];
  for (const d of docs) {
    if (d.public_scan_b && d.ia && d.ia.length) {
      addFree(d.title, (d.author_name || [])[0], `https://archive.org/details/${d.ia[0]}`, "Internet Archive");
    }
  }
  const shownFree = free.slice(0, 4);

  const rows = [];
  const freeBlock = shownFree.length
    ? "🆓 <b>Free to read or download</b>\n" +
      shownFree
        .map((b, i) => {
          rows.push([{ text: `🆓 ${clip(b.title, 24)} · ${b.source}`, url: b.url }]);
          return `${i + 1}. <b>${esc(clip(b.title, 70))}</b>${b.author ? " — " + esc(clip(b.author, 40)) : ""}\n    ${esc(b.source)}`;
        })
        .join("\n")
    : "";

  const borrowBlock = docs.length
    ? "📖 <b>Borrow or preview (Open Library)</b>\n" +
      docs
        .slice(0, 3)
        .map((d) => {
          const author = (d.author_name || [])[0] || "";
          const page = String(d.key || "").startsWith("/") ? d.key : `/works/${d.key}`;
          rows.push([{ text: `📖 ${clip(d.title || "Open", 28)}`, url: `https://openlibrary.org${page}` }]);
          return (
            `• <b>${esc(clip(d.title || "Untitled", 60))}</b>` +
            (author ? ` — ${esc(clip(author, 30))}` : "") +
            (d.first_publish_year ? ` (${d.first_publish_year})` : "")
          );
        })
        .join("\n")
    : "";

  rows.push([
    { text: "🆓 Project Gutenberg", url: `https://www.gutenberg.org/ebooks/search/?query=${enc}` },
    { text: "🗃 Internet Archive", url: `https://archive.org/search?query=${enc}&and%5B%5D=mediatype%3Atexts` },
  ]);
  rows.push([
    { text: "📗 Google Books (free)", url: `https://www.google.com/search?tbm=bks&tbs=bkv:f&q=${enc}` },
    { text: "🛒 Preview or buy", url: `https://www.google.com/search?tbm=bks&q=${enc}` },
  ]);
  rows.push(closeRow);

  const note = shownFree.length
    ? "<i>Free copies are public-domain or publisher-free titles from Project Gutenberg, Google Books and the Internet Archive.</i>"
    : "<i>No free full copy found. Recent books are under copyright, so use the borrow, preview or free-library options below.</i>";

  return sayTo(
    env,
    chatId,
    `📚 <b>Books for "${esc(clip(q, 60))}"</b>\n\n` +
      [freeBlock, borrowBlock].filter(Boolean).join("\n\n") +
      `${freeBlock || borrowBlock ? "\n\n" : ""}${note}`,
    { inline_keyboard: rows },
    messageId
  );
}

// Songs: finds the exact track (iTunes search -> Odesli), then links straight to it on
// Spotify, Apple Music, YouTube Music, YouTube and Audiomack. Apple Music uses the Nigerian
// storefront first (some African songs aren't in the US one). Anything that can't be matched
// falls back to that platform's search page, so a button always works.
async function findSong(q) {
  try {
    let hit = null;
    let store = "ng";
    for (const cc of ["NG", "US"]) {
      const r = await fetch(
        `https://itunes.apple.com/search?media=music&entity=song&limit=1&country=${cc}&term=${encodeURIComponent(q)}`,
        { cf: { cacheTtl: 86400, cacheEverything: true } }
      );
      if (!r.ok) continue;
      const first = ((await r.json()).results || [])[0];
      if (first && first.trackViewUrl) {
        hit = first;
        store = cc.toLowerCase();
        break;
      }
    }
    if (!hit) return null;
    const song = {
      title: hit.trackName,
      artist: hit.artistName,
      apple: hit.trackId ? `https://music.apple.com/${store}/song/${hit.trackId}` : hit.trackViewUrl,
      page: "",
      links: {},
    };
    try {
      const o = await fetch(
        "https://api.song.link/v1-alpha.1/links?userCountry=NG&url=" + encodeURIComponent(hit.trackViewUrl),
        { cf: { cacheTtl: 86400, cacheEverything: true } }
      );
      if (o.ok) {
        const j = await o.json();
        if (typeof j.pageUrl === "string" && j.pageUrl.startsWith("https://")) song.page = j.pageUrl;
        const by = j.linksByPlatform || {};
        for (const k of ["spotify", "appleMusic", "youtubeMusic", "youtube", "audiomack"]) {
          if (by[k] && typeof by[k].url === "string" && by[k].url.startsWith("https://")) {
            song.links[k] = by[k].url;
          }
        }
      }
    } catch (e) {}
    return song;
  } catch (e) {
    return null;
  }
}

async function handleSongSearch(env, chatId, query, messageId) {
  const q = String(query || "").trim();
  if (!q) {
    return sayTo(
      env,
      chatId,
      "🎵 <b>Song search</b>\nType a song or artist followed by <b>song</b> (for example <code>burna boy city boys song</code>) or use <code>/song &lt;track&gt;</code>.",
      { inline_keyboard: [closeRow] },
      messageId
    );
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const enc = encodeURIComponent(q);
  const song = await findSong(q);
  const L = song ? song.links : {};
  const link = {
    spotify: L.spotify || `https://open.spotify.com/search/${enc}`,
    apple: (song && song.apple) || L.appleMusic || `https://music.apple.com/search?term=${enc}`,
    ytm: L.youtubeMusic || `https://music.youtube.com/search?q=${enc}`,
    yt: L.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(q + " official audio")}`,
    audiomack: L.audiomack || `https://audiomack.com/search?q=${enc}`,
  };
  const head = song
    ? `🎵 <b>${esc(clip(song.title, 60))}</b>\n${esc(clip(song.artist, 60))}\n<i>Tap a platform to play this song.</i>`
    : `🎵 <b>Songs for "${esc(clip(q, 60))}"</b>\n<i>Couldn't pin the exact track, so these open the search on each platform.</i>`;
  const keyboard = [
    [
      { text: "🟢 Spotify", url: link.spotify },
      { text: "🍎 Apple Music", url: link.apple },
    ],
    [
      { text: "🎧 YouTube Music", url: link.ytm },
      { text: "▶️ YouTube", url: link.yt },
    ],
    [{ text: "🟠 Audiomack", url: link.audiomack }],
  ];
  if (song && song.page) keyboard.push([{ text: "🔗 More platforms (song.link)", url: song.page }]);
  keyboard.push(closeRow);
  return sayTo(env, chatId, head, { inline_keyboard: keyboard }, messageId);
}

// "atomic habits pdf", "book atomic habits", "download rich dad poor dad book"
function detectBook(text) {
  const t = text.toLowerCase().trim();
  const hit =
    /\b(pdf|epub|ebook|e-book)$/.test(t) ||
    /^(pdf|epub|ebook|e-book)\b/.test(t) ||
    (/^(download|find|get|search)\b/.test(t) && /\b(book|novel)$/.test(t));
  if (!hit) return null;
  return text
    .replace(/\b(download|find|get|search|me|a|an|the|for|pdf|epub|ebook|e-book|book|novel|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "burna boy song", "play essence", "city boys mp3"
function detectSong(text) {
  const t = text.toLowerCase().trim();
  const hit = /\b(songs?|mp3|music|audio)$/.test(t) || /^(play|listen to|stream)\b/.test(t);
  if (!hit) return null;
  return text
    .replace(/\b(play|listen|to|stream|download|find|me|a|the|for|song|songs|music|mp3|audio|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================================
// 10. ACTIVE USERS (one number, counted once per person)
// ============================================================================
// Needs a KV namespace bound to this Worker with the variable name BOT_USERS.
// A person is counted once (by Telegram user id) whether they type, tap a button or use
// the Cinema app, and drops out of the count after 30 days without activity.


// ============================================================================
// PRIVACY RELAY (optional, user-chosen): the stream host sees this Worker, not the viewer.
// Links are signed (HMAC) and expire after 6 hours, so this can't be used as an open proxy.
// ============================================================================
// ---- memory guards: capped caches and a small concurrency pool ----
function capSet(map, key, val, max) {
  map.delete(key);
  map.set(key, val);
  while (map.size > max) map.delete(map.keys().next().value);
}
async function runPool(fns, limit) {
  let i = 0;
  const worker = async () => { while (i < fns.length) { const f = fns[i++]; try { await f(); } catch (e) {} } };
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
}
async function relayHmac(env, msg) {
  const secret = env.RELAY_SECRET || env.BOT_TOKEN || "boa-relay";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function relayAllowed(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    const h = x.hostname;
    if (h === "localhost" || h.includes(":") || /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.(local|internal)$/.test(h)) return false;
    return true;
  } catch (e) { return false; }
}
// Only these plugin headers may be forwarded to the stream host (signed together with the link).
function relayHdrClean(raw) {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return "";
    const out = {};
    for (const k of Object.keys(o)) {
      const n = k.toLowerCase();
      if (n === "referer" || n === "referrer") out.Referer = String(o[k]).slice(0, 300);
      else if (n === "origin") out.Origin = String(o[k]).slice(0, 200);
      else if (n === "user-agent") out["User-Agent"] = String(o[k]).slice(0, 300);
    }
    const t = JSON.stringify(out);
    return t === "{}" || t.length > 700 ? "" : t;
  } catch (e) { return ""; }
}
async function relaySign(env, u, hdr) {
  const e = Math.floor(Date.now() / 1000) + 21600;
  hdr = hdr || "";
  return "/api/relay?u=" + encodeURIComponent(u) + "&e=" + e + (hdr ? "&h=" + encodeURIComponent(hdr) : "") + "&s=" + (await relayHmac(env, u + "|" + e + (hdr ? "|" + hdr : "")));
}
const RELAY_CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "range, if-range, content-type", "Access-Control-Max-Age": "86400" };
async function relayHandle(request, url, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: RELAY_CORS });
  const u = url.searchParams.get("u") || "";
  const e = Number(url.searchParams.get("e")) || 0;
  const sg = url.searchParams.get("s") || "";
  const hdr = url.searchParams.get("h") || "";
  if (!relayAllowed(u) || e < Date.now() / 1000 || sg !== (await relayHmac(env, u + "|" + e + (hdr ? "|" + hdr : "")))) return new Response("forbidden", { status: 403, headers: RELAY_CORS });
  // Only stream headers are built here: nothing about the viewer (IP, country, cookies) is forwarded.
  const h = new Headers();
  h.set("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36");
  h.set("Accept", "*/*");
  const rg = request.headers.get("range");
  if (rg) h.set("Range", rg);
  const ir = request.headers.get("if-range");
  if (ir && rg) h.set("If-Range", ir);
  if (hdr) { try { const o = JSON.parse(hdr); for (const k of Object.keys(o)) h.set(k, o[k]); } catch (e2) {} }
  let res;
  try { res = await fetch(u, { headers: h, redirect: "follow", method: request.method === "HEAD" ? "HEAD" : "GET", signal: request.signal }); }
  catch (err) { return new Response("relay failed", { status: 502, headers: RELAY_CORS }); }
  const out = new Headers();
  ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"].forEach((k) => { const v = res.headers.get(k); if (v) out.set(k, v); });
  out.set("Access-Control-Allow-Origin", "*");
  out.set("Access-Control-Expose-Headers", "content-range, accept-ranges, content-length, content-type");
  out.set("Cache-Control", "no-store");
  const ct = res.headers.get("content-type") || "";
  const clen = Number(res.headers.get("content-length")) || 0;
  if ((/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u)) && clen < 1500000) {
    const base = res.url || u;
    const lines = (await res.text()).split("\n");
    const fix = async (ref) => { try { const abs = new URL(ref.trim(), base).href; return relayAllowed(abs) ? await relaySign(env, abs, hdr) : ref; } catch (err) { return ref; } };
    const done = await Promise.all(lines.map(async (ln) => {
      if (!ln.trim()) return ln;
      if (ln[0] === "#") {
        const m = /URI="([^"]+)"/.exec(ln);
        return m ? ln.replace(m[0], 'URI="' + (await fix(m[1])) + '"') : ln;
      }
      return fix(ln);
    }));
    out.delete("content-length");
    out.set("content-type", "application/vnd.apple.mpegurl");
    return new Response(done.join("\n"), { status: res.status, headers: out });
  }
  return new Response(res.body, { status: res.status, headers: out });
}

// Privacy-relay status for the Settings screen. The relay is this Worker: stream hosts see the Worker's exit IP instead of the viewer's.
// We compare the Worker's exit IP with the viewer's IP on the server and only ever return the exit IP (and only when it differs);
// the viewer's own IP is never sent back, so it can never be shown as a "relay IP".
let RELAY_EGRESS = { ip: "", at: 0 };
async function relayCheck(request, url) {
  const you = (request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "").trim();
  let eg = RELAY_EGRESS.ip && Date.now() - RELAY_EGRESS.at < 600000 ? RELAY_EGRESS.ip : "";
  if (!eg) {
    try {
      const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      if (/^[0-9a-fA-F:.]{3,45}$/.test(String((j && j.ip) || ""))) { eg = String(j.ip); RELAY_EGRESS = { ip: eg, at: Date.now() }; }
    } catch (e) {}
  }
  if (!eg) return { ok: false };
  const own = !you || you === "::1" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(you);   // running on the viewer's own network: nothing is hidden
  const masked = !you ? null : own ? false : eg !== you;
  return { ok: true, masked, ip: masked ? eg : "", host: url.host };
}
// Click-time size check: asks the stream host for ONE byte (Range 0-0) and reads the real total size from its headers. No video is read or
// relayed (the body is cancelled at once). HLS / DASH / embeds have no single size, so they report "unknown". Results are cached at the edge
// for 10 minutes (Cache API, no KV). Signed exactly like the probe, so it can't be used as an open fetcher.
async function sizeHandle(url, env) {
  const out = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" } });
  const u = url.searchParams.get("u") || "";
  const e = Number(url.searchParams.get("e")) || 0;
  const hdr = url.searchParams.get("h") || "";
  if (!relayAllowed(u) || e < Date.now() / 1000 || (url.searchParams.get("s") || "") !== (await relayHmac(env, u + "|" + e + (hdr ? "|" + hdr : "")))) return new Response("forbidden", { status: 403 });
  if (/\.(m3u8|mpd)(\?|$)|\/embed\/|\.html?(\?|$)/i.test(u)) return out({ ok: true, state: "unknown" });
  const ck = new Request("https://boa-cache.internal/size/" + fnv(u + "|" + hdr));
  try {
    const hit = globalThis.caches && caches.default ? await caches.default.match(ck) : null;
    if (hit) return out(await hit.json());
  } catch (e0) {}
  const h = new Headers({ "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", Accept: "*/*", Range: "bytes=0-0" });
  if (hdr) { try { const o = JSON.parse(hdr); for (const k of Object.keys(o)) h.set(k, o[k]); } catch (e2) {} }
  let res;
  try { res = await fetch(u, { headers: h, redirect: "follow", signal: AbortSignal.timeout(5000) }); }
  catch (err) { return out({ ok: true, state: "unknown", why: "unreachable" }); }
  try { if (res.body) await res.body.cancel(); } catch (e3) {}
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (res.status >= 400 || /text\/html/.test(ct)) return out({ ok: true, state: "unknown", status: res.status });
  let bytes = null;
  const cr = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "");
  if (res.status === 206 && cr) bytes = Number(cr[1]);
  else if (res.status === 200) { const cl = res.headers.get("content-length"); if (cl !== null) bytes = Number(cl); }
  let o;
  if (bytes === null) o = { ok: true, state: "unknown" };
  else if (!isFinite(bytes) || bytes <= 0 || bytes > 2199023255552) o = { ok: true, state: "invalid", bytes: isFinite(bytes) ? bytes : -1 };
  else o = { ok: true, state: "ok", bytes, gb: Math.round((bytes / 1073741824) * 100) / 100 };
  try { if (globalThis.caches && caches.default) await caches.default.put(ck, new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } })); } catch (e4) {}
  return out(o);
}
// Looks at what a stream link really returns (first bytes / playlist) and explains why a browser may not play it.
// Runs only after a playback failure, from this Worker (the viewer's IP is never involved).
async function probeHandle(url, env) {
  const out = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" } });
  const u = url.searchParams.get("u") || "";
  const e = Number(url.searchParams.get("e")) || 0;
  const hdr = url.searchParams.get("h") || "";
  if (!relayAllowed(u) || e < Date.now() / 1000 || (url.searchParams.get("s") || "") !== (await relayHmac(env, u + "|" + e + (hdr ? "|" + hdr : "")))) return new Response("forbidden", { status: 403 });
  const h = new Headers({ "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", Accept: "*/*", Range: "bytes=0-65535" });
  if (hdr) { try { const o = JSON.parse(hdr); for (const k of Object.keys(o)) h.set(k, o[k]); } catch (e2) {} }
  let res;
  try { res = await fetch(u, { headers: h, redirect: "follow", signal: AbortSignal.timeout(6000) }); }
  catch (err) { return out({ ok: false, kind: "network", reason: "Couldn't reach the stream host (it is offline, blocked or the address no longer exists)." }); }
  const st = res.status, ct = (res.headers.get("content-type") || "").toLowerCase();
  let bytes = new Uint8Array(0);
  try {
    if (res.body) {
      const rd = res.body.getReader();
      const parts = []; let n = 0;
      while (n < 65536) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; }
      try { await rd.cancel(); } catch (e2) {}
      bytes = new Uint8Array(Math.min(n, 65536));
      let o = 0; for (const p of parts) { const take = Math.min(p.length, bytes.length - o); if (take <= 0) break; bytes.set(p.subarray(0, take), o); o += take; }
    }
  } catch (err) {}
  const txt = new TextDecoder("latin1").decode(bytes);
  const base = { status: st, ct: ct.slice(0, 60) };
  if (st === 401 || st === 403) return out({ ...base, ok: false, kind: "denied", reason: "The host refused access (HTTP " + st + "): the link is blocked, expired or needs a login or token." });
  if (st === 404 || st === 410) return out({ ...base, ok: false, kind: "gone", reason: "The file no longer exists on the host (HTTP " + st + ")." });
  if (st === 429) return out({ ...base, ok: false, kind: "ratelimit", reason: "The host is rate-limiting requests (HTTP 429). Wait a minute or switch server." });
  if (st >= 500) return out({ ...base, ok: false, kind: "hosterr", reason: "The host had a server error (HTTP " + st + ")." });
  if (st >= 400) return out({ ...base, ok: false, kind: "http", reason: "The host answered HTTP " + st + "." });
  if (/text\/html/.test(ct) || /^\s*<(!doctype|html|head|body)/i.test(txt)) return out({ ...base, ok: false, kind: "html", reason: "This link opens a web page, not a video file (it may need a browser, a login or an embedded player)." });
  if (/^#EXTM3U/.test(txt) || /mpegurl/.test(ct)) {
    const codecs = (txt.match(/CODECS="([^"]+)"/g) || []).join(" ");
    if (/hvc1|hev1|dvh1/i.test(codecs)) return out({ ...base, ok: false, kind: "hls", codec: "hevc", reason: "This HLS stream uses HEVC (H.265) video, which most browsers can't decode. Use VLC or another server." });
    if (/ec-3|ac-3/i.test(codecs)) return out({ ...base, ok: false, kind: "hls", codec: "ac3", reason: "This HLS stream uses AC3 / E-AC3 audio, which many browsers can't play. Use VLC or another server." });
    if (/METHOD=SAMPLE-AES|skd:\/\/|com\.apple\.fps|widevine/i.test(txt)) return out({ ...base, ok: false, kind: "hls", codec: "drm", reason: "This HLS stream is DRM-protected and can't be played in the browser." });
    if (!/#EXTINF|#EXT-X-STREAM-INF/.test(txt)) return out({ ...base, ok: false, kind: "hls", reason: "The HLS playlist is empty or has expired." });
    return out({ ...base, ok: true, kind: "hls", reason: "The HLS playlist looks valid, but the browser could not load its segments (often a CORS block or an expired token)." });
  }
  const b = bytes;
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    if (/webm/i.test(txt.slice(0, 64))) return out({ ...base, ok: true, kind: "webm", reason: "A WebM file that the browser still refused to play (likely a CORS block or a codec the browser lacks)." });
    return out({ ...base, ok: false, kind: "mkv", reason: "This is an MKV file. Mobile web players can't play the MKV container, so use VLC or another server." });
  }
  if (txt.slice(0, 4) === "RIFF" && txt.slice(8, 12) === "AVI ") return out({ ...base, ok: false, kind: "avi", reason: "This is an AVI file, which browsers can't play. Use VLC or another server." });
  if (txt.slice(4, 8) === "ftyp") {
    const brand = txt.slice(8, 12);
    if (/hvc1|hev1|dvh1/.test(txt)) return out({ ...base, ok: false, kind: "mp4", codec: "hevc", reason: "This file uses HEVC (H.265) video, which most browsers can't decode. Use VLC or another server." });
    if (/ec-3|ac-3|dtsc|dtsh|dtsl/.test(txt)) return out({ ...base, ok: false, kind: "mp4", codec: "audio", reason: "This file uses AC3 / E-AC3 / DTS audio, which many browsers can't play. Use VLC or another server." });
    return out({ ...base, ok: true, kind: brand === "qt  " ? "mov" : "mp4", reason: "The file looks like a normal MP4, but the browser could not load it (likely a CORS block, a blocked range request or an expired link)." });
  }
  if (b.length && b[0] === 0x47 && b[188] === 0x47) return out({ ...base, ok: false, kind: "ts", reason: "This is a raw MPEG-TS stream, which browsers can't play directly. Use VLC or another server." });
  if (txt.slice(0, 3) === "FLV") return out({ ...base, ok: false, kind: "flv", reason: "This is an FLV file, which browsers can't play." });
  if (/^(video|audio)\//.test(ct)) return out({ ...base, ok: true, kind: "media", reason: "The host returns " + ct.split(";")[0] + ", but the browser could not play it (codec or CORS issue)." });
  return out({ ...base, ok: false, kind: "unknown", reason: "The host returned something that isn't a recognisable video (type: " + (ct.split(";")[0] || "unknown") + ")." });
}

// ============================================================================
// SUBTITLES from installed Stremio-style subtitle add-ons (e.g. OpenSubtitles)
// ============================================================================
const SUBS_CACHE = new Map();
async function imdbFor(env, mt, id) {
  try {
    const j = await tmdb(env, "/" + (mt === "tv" ? "tv" : "movie") + "/" + id + "/external_ids");
    return j && /^tt\d+$/.test(j.imdb_id || "") ? j.imdb_id : "";
  } catch (e) { return ""; }
}
async function findSubs(env, mt, id, sNum, eNum) {
  const key = [mt, id, sNum, eNum].join("|");
  const hit = SUBS_CACHE.get(key);
  if (hit && Date.now() - hit.at < 3600000) return hit.v;
  const addons = (await getAddons(env)).filter((a) => a.subs && a.enabled !== false && a.base);
  if (!addons.length) return [];
  const imdb = await imdbFor(env, mt, id);
  if (!imdb) return [];
  const vid = mt === "tv" ? imdb + ":" + (sNum || 1) + ":" + (eNum || 1) : imdb;
  const lists = await Promise.all(addons.map(async (a) => {
    try {
      const r = await fetch(a.base + "/subtitles/" + (mt === "tv" ? "series" : "movie") + "/" + encodeURIComponent(vid).replace(/%3A/g, ":") + ".json", { headers: { "User-Agent": "BoaCinema/1.0" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const j = await r.json();
      return (Array.isArray(j.subtitles) ? j.subtitles : []).map((x) => ({ lang: String(x.lang || "und").slice(0, 12), url: x.url, from: a.name }));
    } catch (e) { return []; }
  }));
  const seen = {};
  const out = [];
  for (const x of lists.flat()) {
    if (!x.url || !relayAllowed(x.url)) continue;
    seen[x.lang] = (seen[x.lang] || 0) + 1;
    if (seen[x.lang] > 3) continue; // up to 3 per language keeps the list short
    const e = Math.floor(Date.now() / 1000) + 21600;
    out.push({ lang: x.lang, n: seen[x.lang], from: x.from, u: "/api/sub?u=" + encodeURIComponent(x.url) + "&e=" + e + "&s=" + (await relayHmac(env, "sub|" + x.url + "|" + e)) });
  }
  out.sort((a, b) => (a.lang === "eng" ? 0 : 1) - (b.lang === "eng" ? 0 : 1) || a.lang.localeCompare(b.lang));
  capSet(SUBS_CACHE, key, { at: Date.now(), v: out }, 100);
  if (SUBS_CACHE.size > 300) SUBS_CACHE.delete(SUBS_CACHE.keys().next().value);
  return out;
}
async function subHandle(url, env) {
  const u = url.searchParams.get("u") || "";
  const e = Number(url.searchParams.get("e")) || 0;
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "range" };
  if (!relayAllowed(u) || e < Date.now() / 1000 || url.searchParams.get("s") !== (await relayHmac(env, "sub|" + u + "|" + e))) return new Response("forbidden", { status: 403, headers: CORS });
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 BoaCinema/1.0", Accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return new Response("not found", { status: 404, headers: CORS });
    if ((Number(r.headers.get("content-length")) || 0) > 3000000) return new Response("too big", { status: 413, headers: CORS });
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 3000000) return new Response("too big", { status: 413, headers: CORS });
    let t;
    try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e2) { t = new TextDecoder("windows-1252").decode(buf); }
    return new Response(srtToVtt(t), { headers: { ...CORS, "content-type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  } catch (err) { return new Response("failed", { status: 502, headers: CORS }); }
}

// ---- stream-level subtitles: plugin streams may carry subtitles / captions / tracks / subs ----
const L3 = { en: "eng", es: "spa", fr: "fre", pt: "por", ar: "ara", de: "ger", it: "ita", ru: "rus", hi: "hin", tr: "tur", zh: "chi", ja: "jpn", ko: "kor", nl: "dut", pl: "pol", id: "ind", sw: "swa" };
function lang3(l) {
  const k = String(l || "und").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 12) || "und";
  return L3[k.slice(0, 2)] && k.length <= 5 ? L3[k.slice(0, 2)] : k;
}
async function signStreamSubs(env, list) {
  if (!Array.isArray(list)) return list;
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== "object") { out.push(x); continue; }
    const raw = [x.subtitles, x.captions, x.tracks, x.subs].find((a) => Array.isArray(a) && a.length);
    if (!raw && !("subtitles" in x || "captions" in x || "tracks" in x || "subs" in x)) { out.push(x); continue; }
    const y = Object.assign({}, x);
    delete y.subtitles; delete y.captions; delete y.tracks; delete y.subs;
    const subs = [], seen = {};
    for (const t of (raw || []).slice(0, 12)) {
      const u = typeof t === "string" ? t : (t && (t.url || t.file || t.src || t.link)) || "";
      const kind = t && t.kind ? String(t.kind).toLowerCase() : "subtitles";
      if (!/^https?:\/\//i.test(u) || !relayAllowed(u) || !/subtitles|captions/.test(kind) || seen[u]) continue;
      seen[u] = 1;
      const e = Math.floor(Date.now() / 1000) + 21600;
      const lg = lang3(t && (t.lang || t.language || t.srclang));
      subs.push({ lang: lg, label: String((t && (t.label || t.name)) || "").slice(0, 40), u: "/api/sub?u=" + encodeURIComponent(u) + "&e=" + e + "&s=" + (await relayHmac(env, "sub|" + u + "|" + e)) });
      if (subs.length >= 6) break;
    }
    if (subs.length) y.subs = subs;
    out.push(y);
  }
  return out;
}
// .srt (or loose text) -> valid WEBVTT
function srtToVtt(t) {
  t = String(t || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const vtt = /^\s*WEBVTT/.test(t);
  if (!vtt) t = t.replace(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}),(\d{1,3})/g, "$1.$2");
  // drop positioning (line / position / align / size, SRT X1:Y1:) after the timestamps and {\an8}-style tags, so captions stay anchored
  t = t.replace(/^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})[^\n]*$/gm, "$1").replace(/\{\\an?\d\}/g, "");
  return vtt ? t.replace(/^\s+/, "") : "WEBVTT\n\n" + t.trim() + "\n";
}

// Bump this string on every release. It versions the app, the service worker and the caches.
const APP_VERSION = "2026-11-21.23";
const SW_JS = ("// " + "@@VER@@" + "\nvar V=\"boa-@@VER@@\";\nself.addEventListener(\"install\",function(e){self.skipWaiting();});\nself.addEventListener(\"activate\",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});\nself.addEventListener(\"fetch\",function(e){\n  var r=e.request;\n  if(r.method!==\"GET\")return;\n  var u=new URL(r.url);\n  if(u.pathname.indexOf(\"/api/\")===0)return;\n  if(r.mode===\"navigate\"){\n    e.respondWith(fetch(r).then(function(res){\n      if(u.pathname===\"/\"||u.pathname===\"/app\"){var c=res.clone();caches.open(V).then(function(ca){ca.put(\"/app\",c);});}\n      return res;\n    }).catch(function(){return caches.match(\"/app\").then(function(m){return m||new Response(\"You are offline. Open Boa Cinema again when you have a connection.\",{status:503,headers:{\"content-type\":\"text/plain\"}});});}));\n    return;\n  }\n  if(u.hostname===\"image.tmdb.org\"){\n    e.respondWith(caches.open(V).then(function(ca){return ca.match(r).then(function(hit){\n      var f=fetch(r).then(function(res){if(res.ok||res.type===\"opaque\")ca.put(r,res.clone());return res;}).catch(function(){return hit;});\n      return hit||f;\n    });}));\n  }\n});\n").split("@@VER@@").join(APP_VERSION);
const PWA_ICONS = { "192": "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", "512": "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ev0510wH1KtXrx49eqTd6sILL+zQoUPaYikKbN68WZ0KmzFjxg033KBOi6nb2LFj1cM1a9bs3r07xYapn6pTp861116bugzPVhYgACprsBxNgW0yfrko9uu9vzKdO3fuQQcdpBayuX3zzTfqUudvf/tbdfK9efPmRxxxRN26dY877rg2bdpcfPHF6uTS559/nk39iW2nTJmS9pcShg8fniiscf/WW29169btpJNO6t69uzppo96zP/KfH9Wuenjuuec2adJEhaVGzYlN+vbtq+I2scx9WgECIC0RBcIt8LgsO18Urxe+fd+DOvPTunXrbBA3bNjQv3//Qw45ZMiQIU8//fRrr732/vvv79y5U9W5ZcuWN95444UXXhg9evSRRx7Zs2fP9evXq/XaNxUqc+bMSfGhIPXev0WLFnr1P/74461atVqyZEmKzb/77ruBAwcOGDAgRZkUTxUVFQ0bNixFAZ6qLEAAJDVYiJrAThn/X6t4TKxst0+f+FSg559//tChQ9WC3k296x8zZozKjwULFtipYdGiReqAQG2idqN2ytdYpmnTptdcc02NT6mV2m//V65c2adPH1WDndv8+fPVYY2dktXLdO3atfpK1tQoQADUyMLK0As8b5WrN/4+/q5vQvDOO+/U/qiMOlF+2mmn3X333VJmcPiiCqtNzjjjjE8//TTRB4372vbUhx122JlnnqlRYUVFRYpQqbFCdVizcOHCGp9KvfLQQw9t1qxZ6jI8mxAgABIO3EdEQO3+XrbKe1jFg0Xp1/698U9oqmuqao+ZWM70Xp3hUe9kP/vss0w3TJT/8MMP1TtoVUniYab3P//5zwcOHFh9q4suuqj6Sjtrnnvuuffee89OycplJk6cWPmh/WV1LcF+4R9KmvofAWDqzEdu3MVSPiLL2os9V4nS1336pH8VVO0T2cXFxZdddtkHH3xQpcKMHqodrrrQqv2hmho737Zt24z6kCy8dOnS5LL9hXfffVdd4bBfPllS7zAlubk5CwSAOXMd2ZF+JePTZWkbsWdcrOwTv9/1J5XbtWvXvHnz5MOMFu66667Vq1dntEmNhdXl4pm2P9pfpYZjjjmmc+fOlVcKIfR2rOr8j7o4Ubkq+8vqorf9wsmSp59+enKZhRQCBEAKHJ4KtMCnMj7XKrvSKj5D7Lk7Vp7FCR9Xhjl48GC9er/44os77rhDb9vqW91+++3/+te/qq+3s2bQoEGVi6nzKik+HVS5ZJXljz/+WF3NrrLS5sO//e1vNktWLrbvvvs2atSo8hqWaxQgAGpkYWVABSqkfF1W3G6VdrL2nBMrvkmUrRLxchGYt/0/sR111FEddH9VatKkSeoU0E81Zfv/7777TjtOWrdu3bBhw2QP1HWF/v37X3311ePHj7/tttvuueeeuXPnquu0zz//vDpeWb9+/ebNm7dv375r167kJomFbC5Hb9q0KVFJpveVe57ptuaUJwDMmevQj/QNWfF7q2SgKJklyj/w73P9dhzVGXy9D/+oveesWbPsNGG/jDoLpGLAfvnKJdW7/uTDjz76aMGCBap7kydPvvHGG6+77jp1iKAudHfp0qV9+/YqLU466SSVfAcddFDdunXV/XHHHadOxXTq1EkFRrKSTBdUz/V+we2AAw7ItC0DyxMAloGzHtIhnyxyZorCDVadlbLwgXj+yHjuxTLnOCnyM/mUpDdjP+200/QaUu+my8oc/kMFqsIVK1bo9adVq1Z6G6ok27Jly5tvvrly5coNGzboVZLY6quvvkosZHRPANjhIgDsKFEmWAIHWbG2Ire/yL/dKlhsFW2y6r4QL7w5ntdWBuX1rB0AixcvdsNa70M4qifav/SrtnXqVlpaqlFVgwYNNLYybZOg/IMxzZ3xOivQWMS6i7wHrMJ18cLb4nlnx2N5/h0WqL1/nTp1NAao3jU/++yzGhum3UTlijoOSFuseoFmzZrpXfitXpX2Gr0AqF+/vo0WTS9CAJj+CojY+PcTsS4i7z5RuFYW3RnP7xiPFXieBOpsuJ7q66+/rrebTtvcN9988+6776YtVr1ATk5Ou3btqq/3ck08HtdorrCwUGMr0zYhAEybcVPG+zMRu1DkThOFr8qi38ncOhl8mUK2RC1bttSr4v3339fb0M5W6hKunWLVy6gLudVXsiYaAgRANOaRUdQqsK+IXWPlL5eFA2Vu4d5HA7Vuk90T2ufN9d6k2+ys9u8VH3XUUTaboFjoBAiA0E0ZHdYRqC9iI36IgaK+MtfVk0Lq1LP2J9DffvttnbHZ22bz5s32ClYttd9++1VdpftYXZg99thjzzrrrAsuuKBLly7du3fv0aNH7969+/btO2DAgN///vfDhg0bPnz4yJEjr7/++vHjx994440TJ07U/j4l3W4atB0BYNBkM9T9RWy0lf+KLLoinuPSh0e1/xpJeXl5lh+XTD2/2ocXKtJS11zjs+owqF+/fpMmTVq6dOkbb7zx4Ycffv/991u3bl23bp260P3oo4/Omzdv9uzZ999//7333jtt2rQpU6bcfvvtanevdvpq1z9mzBgVAyoMVCQccsghNTbByuwFDA6A7PGoIZwCB4rYOFHwjCw6Sjr/K8Tab/937NhRUVHhnqj2r+PaPwI4+uijb7nllrVr16p9/fLly6dOnTpo0KA2bdocc8wxv/jFL9wbGjVrCxAA2nRsGG6BxiK2UBZ2cvpXB/bff389F7XT1NvQ5la7qn1Dg80N0x4BqBM7Q4cOXbFihXqnf/XVVzfju/htygagGAEQgEmgCz4JFAkx1SqcIPMc/KUBtTfUG82///1vvQ1tblVSUqL3FUMFBQX77bdfja0IIa655ppNmzbdeuutp5xyinpYY7EArqRLCQECIOHAvbkCl1t5j8vCgx36nGja98u1QWt/cX9tFVZfr91EjSdw1B7/1Vdfvfnmm+vVq1e9LdaEQoAACMU00Ul3BY4TOU/JwjOdOB1U25vltANw+whAdWDPnj3qXuNW/Xt1xo4dq875nHjiiRq1sUlwBAiA4MwFPfFKoKZ29hWxmbLgxHi2l4W13w57EADalxmqnNeaMGHC6NGja1JkXcgECICQTVht3V0oy3pZxQG5XWEVD7WKx1olf7JK75Glc62yRbLsJav8dVmxXer8Wr/lyU+BEPdaBQdm10G98+xqfOpUu7p39ZaTk6NXf+Vv47n++utHjBihVw9bBU2AAAjajGj2Z5slXxPxgNzWiPhSEX9UVPxZlN8VK79JlF0XKxskSnvEStrEipuK3Z2sPQOskluskoesshWyfI8nv6BrR/ZAEZtlFRRk0Z+vv/7aTkPVy+h9f1z1elKs0W4i+TfF1N5/zJgxKZrgqXAJGBgA4ZqgaPb2AyGXiYq/iIoJoqx/rPQUsfv3svgpWfZdAI4PjhU5U6wCbXe9L69XzRUVFal7V2/aAfDll1+qjp111lkO7v1VnRs3bly5cuWiRYvuu+++6bX/bNu2TbXOzQ0BAsANVerMTKBUiBdi8eGxsuax4gGy+K/S4b+IkllvLKu9lTtY5ma6VaJ8JI8AtmzZokZ38803q/tsbu+8887UqVO7detWt27dRo0anXbaaZ06derZs+e11147svafrVu3ZtMo26YQIABS4PCUDwLLYvERsbI21m51VSMuHfpsZubjGGbld4jr/OtIni3JtE3tt+c2G1IXAPLy8mwWrlxMXTqWUl566aW//vWvK6/PaPmzzz7r2rVrixYt1NXjJUuWZLStk4Wpa28BnZf43jXwCAHnBbYLa2Ss7H9E8WmiqoAAABAASURBVCtWufO126txopWv8SXS2gGg/R0S9kZj/fKXv7RZskqxb7/9Vq1RZ//Vvd7tscceO/roo5cuXaq3OVu5J0AAuGdLzdkKqEsFA0XpH6ySUj8OBfYVsT5WxieCvvjiC71h169fv/rH7fWqqnGrX/3qVzWuT7tSndTq2LHjUbpfCv3SSy/17ds3bSspCuyzzz4pnuWpbARi2WzMtgh4ILBYVFxmFX/twPXhjDvbV2b8l2R27Nih9xesVOdc/b0q9R5cNaFx27Vr19lnn62xodrko48+6ty5szqDpJa1bzX+HrJ2bWxYWYAAqKzBckAF3orJzqL4fVnhcf/UQUDvzA8C1F5Pr59NmzbV29DOVkceeaSdYtXLbN68+Ywzzqi+3s6a+fPn2ymWokxBQYH29+ulqJanEgIEQMKB+6ALqKsCXUXxMun1JYF+mR8ErF27Vk9T+zSLneaaNGlip1j1MuvXr9c7NCkvL589e3b1CjNaow5c+I65jMQyKmxQAGTkQuEAChQLcZUo8fg4QB0E9MrwIGD16tV6eieffLLehmm3ysvL09uJq7M3O3fu1NsFv/fee+qEWNq+pS7QsmXL1AV4NhsBAiAbPbb1WiAuxCirtEJ6+vHQbjKzS8Evvviinkvz5s21/6BY6hZ/85vfFBYWpi5T47NqJ679G2r//Oc/a6wzo5UXXnhhRuUpnJEAAZARF4X9F9gYk3O8/WzoESLWSGbwJXHbtm3T+wvsOTk56pKpG8QdO3bUq/a1117T/nxq9gFQr169Nm3a6PV87614VLMAAVCzC2uDLHCnKN3q7YeC2mb4TdHalwHOO+88N+Tbt2+vV+2qVau0r8Fu375dr9HkVt26dcvNzezwK7ktC3YECAA7SpQJlkCJELMtT78uorWV2fdoal8GaNeu3aGHHuos92WXXab3GwbqAsDzzz+vHQDafxohOXx15iq5nOmC3nWLTFsJe3kCIOwzaGj/nxEV9q8EZG/U0srJz+TCw8KFC3ft2qXRrjpTP3LkSI0NU2wyduzYFM+meOrll1/++uuvCwo0vxrv8MMPT1F52qc6dep07rnnpi1WW4H8/PzanmJ9UoAASFKwECaBb4T1muXdrwUUCHFGJp8FUnv/OXPm6IFefvnlDv7qU//+/Rs1aqTXk8mTJ6sNE18FoRYyvR1yyCGZbpIsr87+T5s2LflQY0E7tzTaCu8mBEB45870ni8V3gWAsm5jZfaP5a677tL74zDqIGDUqFGqRUduI0aM0KtnzZo1K1euVNuqgwB1r3HL5lzWxIkTDzroII1Gk5tkfwIqWVWEFzJ7TYcSgk5HVOB5y9OzQOdkeBng888/f+SRR/Ts+/Xrd8kll+htW3mrhx566LDDDqu8xv6yCrBEYe0AaNiwod6nj4YMGdKnT59E69r3WeaHdrvh2pAACNd80dv/CqizQJut7P5+438rS790kBXL9MtB77zzzooKncOUWCw2c+bMFi1apO9W7SVmzJhx8cUX1/58qmfeeeedZ555JlFCOwDU5hMmTFD3Gd2uv/76P/3pT9lfwnX116ozGlGQCxMAQZ4d+pZGYIfl6W+ENUzTnapPf/jhh4sXL6661t7jOnXqPPXUU927d7dXfK9S6hKCaveKK67Ya20mDyZNmpQsvmnTpuRypgvNmjW77LLL7G+lItOpPzpWv379Zs2a2W/azJIEgJnzHpFRexwA9a0Mfh0sQTx+/PidO3cmljO9VxdCZ8+erQ4F1FUB+9t27tx57dq12h/8Vw2tWLHi0UcfVQuJ21tvvaVOZyWWNe5vvvnm888/P+2GLVu2fPrppwcOHJi2pP0CF1xwgf3CZpYkAMyc94iM+guPjwAy+X3gBPGWLVsGDRqUWNa779Wr17p166699toGDRqkrkG91160aNHDDz+sTr6nLpni2U8++aRHjx5VCmj/WoOqRx2OPP744w888IB6S64eVr/95je/WbJkycsvv5z6S6c1+qCOgdKiVe+PUWsIAKOmO2qDTRMATg93f5HxEYDqgtq7qTMbakH71qRJk5tuumnz5s1z5swZN26cukbas2dP9U6/d+/eQ4cOHTt2rDpK2L59u9rJdujQQbsVtWFxcbHaaVY/6b9q1Sr1bDY3FU6fffaZOpu0dOnSadOmzZo1S7H8/e9/37Fjx4IFC9q2bZu68unTpz/44IOpy1R/9ogjjlCt6P0SXPXaIrmGAIjktJoyKI9PATXI/BRQYibUiaDXX389sax9r04Ede3addSoUeoa6X333afe6d9777233nrr6NGj1VGCOl+kXXNyw2uuueb//u//kg+TC08++eR3332XfKi90KhRozZt2vTt2/fyyy9XO/2mTZvWrVs3bW3qKGrkyJHvvvtu2pLVCxx//PEqvRYuXKjEbvvPjwpjdUTi0lduVO9AwNcQAAGfILqXSiCu9ZY8VY0pn9O4BpCoT0qp3rNr/7XIRCVu38+fP3/u3Lk1tqIuYzz00EM1PuXBSnWUo1rZuHGj3keqDj30ULW7V/6D//OjLjOoaxIcFihSdYtwAKjRcYu4wP7ejm//LD5ztG3btn79+n3//ffedtlua2vWrBkwYECK0pMmTVIniFIUcOkpdZSjLg+oysvKyjZs2KAWuDkoQAA4iElVXgtovyXX6+h+uqeAEs0tW7asffv2n376aeJhcO7nzZvXqVOn1P35/PPPtX+vLXXNKZ5dvnz5ddddlyzw7LPPJpdZcESAAHCEkUr8EWiY+cdysuloFgcAPzb75ptvqpPgNZ5n/7GEt/9Tb6uHDx9+1VVXqYW0Lf/xj39UF6LTFnOqwEcffaQuHauzZ8kK1Rmq3bt3Jx+mWuA5ewIEgD0nSgVSoIG3vdqt8yGgql388ssvzz33XB9PqSc79NVXX3Xu3HnmzJnJNakXVM8vuugib65kvPfee+pM/a5de32jqjoKCYJbaqVwPUsAhGu+6O1eAg2yOyezV102HuzJ5BuhU9Sn3m6rS5EjR47Uu6qZomb7T73//vtt27ZdsWKF/U1UyS1btnTv3l37+0FVDXZuq1evVhm5devW6oUnT57sy6WI6j2JxhoCIBrzaOgomtX8DZ1uaXzvxBFAsnPTp09v3br1U0895XEMqJ24OrHeqlUrdY4l2Rn7C+vWrTv77LP1PpSZthW1c7/ttts6duxY/XcREtt+9tlnTn1XRKJCw+8JAMNfACEe/vFx0UB4+gL+3qEjgCS6uiSgTnOffvrpTz75ZHl5eXK9Swtqrz148OATTjjhnnvuKSkp0W5FnZ855ZRTHn/8ce0aatxQXRo566yzbrzxxtSJeN99902dOrXGGliZqYCn/34y7RzlEUgh0E54/ddiHbkGUH1EGzduvOKKK1q0aPHoo4+qs0PVC2S/ZsOGDVdeeaXaaz/44IOpd6/22+rTp88ll1yyfv16+5vUVlKd3B82bJg6JfX222/XVqby+tGjRw8aNKi0tLTySpY1BCIYABoKbBJGgbbenv9RRK5+88Q//vGPvn37HnXUUVddddWCBQuy/LSo2sur9/vz589XO9aTTz75zDPPfOyxx9QQnL0999xz6ixW79691aGMXs3qYOLOO+886aSTHnjggYxqmDt3bvPmzdUVbHUp2+aG6tLFa6+9phrq0aMHF5MTaARAwoH7kAk0kNYJGf6FluxHuFm6/ucHdu7cOW/evP79+//qV79SO+7x48e/+OKLmzZtUldE1f6rtiFs3779rbfeWrZsmdrLT5kypWfPno0aNVLv9wcMGKD2d2onW9uGjqx/4okn1Fmsli1bXn311Sq6Un9UdMeOHepUjzrldcstt6gBqtu4ceP0vmfi448/Hj58+GGHHda1a9cZM2aonbuqucrtpZdeUueLVLKqhg4++OBzzjlHJeLixYstfv4jQAD8h4G7sAlcIb0+/6OE3heuB4BqJXlTO+7JkydfdNFFp5566jHHHKP2X3Xr1lV7drUva9++vTr9os6YqyMGtVLdq4u6F1xwgTrPM3bs2EWLFtl/X5xsLssFdfZm1qxZKrrU2/lEl1QCqcvFF198cefOndUhiIo0tb5x48bqVI865TVx4kQ1wCwbTWy+dOnSESNGqJ1727aq7r1uqml1vkidW3OqrUSLkbknACIzlQYN5Odxq7+V5/GAt8l4mbdfPVTjAL/88ku1L1u9erU6/bJu3Tr13r/GYr6vVB1T56DWrl37wgsvqLfh6iJElie1fB9RJDtAAERyWiM+qOFWXoHn++LNlqdv/yM+hQwvGAIEQDDmgV7YFjhOiotFzW//bdehU/Atkf03Qei0yzYIuCdAALhnS82uCNxg5btSb7pK/2a5/jn9dF3geQQcFiAAHAalOlcFJsi8X3v+4R81ot1S/p1TQAqCW7QEIhQA0ZoYRlNVQMpb43mXe37tN9GNv4kKS4jEMvcIREaAAIjMVEZ5IELKu62Crn6c+k+wrpIViQXuEYiSAAEQpdmM5lgOl9aDsuB8y4cP/idBX1RHAMkHLARPgB7pCRAAem5s5YVAgZTXxnOXyKIzPP/an8rDWyLL/8Xpn8oiLEdFgACIykxGbhwdZewFWTRI5Hv/kf8qlo8IPv9ThYSHEREgACIykZEZxhHSGiLzlsYLplmFBwt7r083B79Fxtd4+w0Qbo6GuhHYS8D/f2B7dYcHpgr8PG71k7mLZOFLVp2hVt5RIicgErz9D8hE0A03BAgAN1SpM41AvpTNZKyLzLkunnt/PH9FvHCVqDPKyvf4L3yl6aVl/UvG51tlaYtRAIGQCkQgAEIq73C3D7FESxkL1O3c+A+7+CviOYNl7uh43sR43lSZ/2A8/8V44Sar7iKr8Dar4H9FfjuRG4RTPTXOx11WWTEf/6+RhpWRECAAIjGNltVF5M2zCgN1myF+2MWPEwXDrPy+Iq+byOtk5Z4pchsF4My+nVnfLCs4/2MHijLhFSAAwjt39NxdgQmijN/+dZc4+9qpITsBAiA7P7aOqMAKWb6WD/9EdHIZVlKAAEhSsIDAjwK7ZPx6q/THB/wPgegKEADRndvoj8yVEUoph4rSL/iX4YoulQZLgJd5sOaD3vguMF2Uv8rJH9+ngQ54IkAAeMJMIyEReFWWT+XkT0gmi25mLxDiAMh+8NSAQGWBjbLid6KUT/5UNmE52gIEQLTnl9HZFVB7/96iZDff+mkXjHJRECAAojCLjCFLgcTefxd7/ywdvduclpwRIACccaSW8AqskeU9RAl7//DOID3XFiAAtOnYMAoCi2RZH878RGEmGYOOAAGgo8Y2/go41fpdVul1sbI4X/fmFCj1hE2AAAjbjNFfJwRKpRwii+/hT305gUkd4RUgAMI7d/RcU+AdWXGJKH4uFtfcns0QiIpACAMgKvSMw3uBPVLeYZVeJIrfE9L71mkRgaAJEABBmxH645bABqviArHnflEuOenvljH1hkyAAAjZhNFVzpFGAAAJiklEQVRdDYHNsmKoVXypVfwpn/TX4AvSJvTFWQECwFlPaguWwKcyPtIq+R9RvFTE+Y6HYM0NvQmAAAEQgEmgCy4IfG7Fx8uSDmLPQlHBOR8XgKkyCgIEQBRm0ZQx2BhnXMq/yfJhVnE7a8+CWEUFp/ttoFHEWAECwNipj9rAt8v4dFl6ltjTN1a6RMTL2fVHbYYZj/MCBIDzptTomYCUcqP1w36/q9zTRuy5O1a+ncu8nunTUPgFQhQA4cdmBA4JfCPjz1vlo6ySM8Sei0Wx2u+/GZNc43VIl2oMEiAADJrsUA/1Yxl/UpaNtUrOs/a0iBUPFqVPiooveb9v8YOAvgABoG/Hlu4JfCbjq2T5w1bZrVbp/1rFp1q7O8SKR8XKHhUVH/FLvO65B7ZmOuaOAAHgjiu12hDYIeMbZcUyq+IRWXa3VTrWKlH7+k7WnqZid7tY8ZWx0htE2WxRvlzEv+advsUPAs4LEADOmyZqfEJUqB0ZtxQCZ8SKL46VDBAl42Jl00W5enev9vUf8AY/8QLiHgH3BQgA941pIVsBtkcAAVcECABXWKkUAQQQCL4AARD8OaKHCCCAgCsCIQgAV8ZNpQgggIDxAgSA8S8BABBAwFQBAsDUmWfcCIRAgC66K0AAuOtL7QgggEBgBQiAwE4NHUMAAQTcFSAA3PWl9mwE2BYBBFwVIABc5aVyBBBAILgCBEBw54aeIYAAAq4KBDgAXB03lSOAAALGCxAAxr8EAEAAAVMFCABTZ55xIxBgAbrmjQAB4I0zrSCAAAKBEyAAAjcldAgBBBDwRoAA8MaZVjIRoCwCCHgiQAB4wkwjCCCAQPAECIDgzQk9QgABBDwRCGAAeDJuGkEAAQSMFyAAjH8JAIAAAqYKEACmzjzjRiCAAnTJWwECwFtvWkMAAQQCI0AABGYq6AgCCCDgrQAB4K03raUS4DkEEPBUgADwlJvGEEAAgeAIEADBmQt6ggACCHgqEKAA8HTcNIYAAggYL0AAGP8SAAABBEwVIABMnXnGjUCABOiKPwIEgD/utIoAAgj4LkAA+D4FdAABBBDwR4AA8MedVisLsIwAAr4IEAC+sNMoAggg4L8AAeD/HNADBBBAwBeBAASAL+OmUQQQQMB4AQLA+JcAAAggYKoAAWDqzDNuBAIgQBf8FSAA/PWndQQQQMA3AQLAN3oaRgABBPwVIAD89Te7dUaPAAK+ChAAvvLTOAIIIOCfAAHgnz0tI4AAAr4K+BgAvo6bxhFAAAHjBQgA418CACCAgKkCBICpM8+4EfBRgKaDIUAABGMe6AUCCCDguQAB4Dk5DSKAAALBECAAgjEPZvWC0SKAQCAECIBATAOdQAABBLwXIAC8N6dFBBBAIBACPgRAIMZNJxBAAAHjBQgA418CACCAgKkCBICpM8+4EfBBgCaDJUAABGs+6A0CCCDgmQAB4Bk1DSGAAALBEiAAgjUf0e4No0MAgUAJEACBmg46gwACCHgnQAB4Z01LCCCAQKAEPAyAQI2bziCAAALGCxAAxr8EAEAAAVMFCABTZ55xI+ChAE0FU4AACOa80CsEEEDAdQECwHViGkAAAQSCKUAABHNeotUrRoMAAoEUIAACOS10CgEEEHBfgABw35gWEEAAgUAKeBAAgRw3nUIAAQSMFyAAjH8JAIAAAqYKEACmzjzjRsADAZoItgABEOz5oXcIIICAawIEgGu0VIwAAggEW4AACPb8hLt39B4BBAItQAAEenroHAIIIOCeAAHgni01I4AAAoEWcDEAAj1uOocAAggYL0AAGP8SAAABBEwVIABMnXnGjYCLAlQdDgECIBzzRC8RQAABxwUIAMdJqRABBBAIhwABEI55Clcv6S0CCIRCgAAIxTTRSQQQQMB5AQLAeVNqRAABBEIh4EIAhGLcdBIBBBAwXoAAMP4lAAACCJgqQACYOvOMGwEXBKgyXAIEQLjmi94igAACjgkQAI5RUhECCCAQLgECIFzzFeze0jsEEAiVAAEQqumiswgggIBzAgSAc5bUhAACCIRKwMEACNW46SwCCCBgvAABYPxLAAAEEDBVgAAwdeYZNwIOClBVOAUIgHDOG71GAAEEshYgALImpAIEEEAgnAIEQDjnLVi9pjcIIBBKAQIglNNGpxFAAIHsBQiA7A2pAQEEEAilgAMBEMpx02kEEEDAeAECwPiXAAAIIGCqAAFg6swzbgQcEKCKcAsQAOGeP3qPAAIIaAsQANp0bIgAAgiEW4AACPf8+dt7WkcAgVALEAChnj46jwACCOgLEAD6dmyJAAIIhFogiwAI9bjpPAIIIGC8AAFg/EsAAAQQMFWAADB15hk3AlkIsGk0BAiAaMwjo0AAAQQyFiAAMiZjAwQQQCAaAgRANObR21HQGgIIREKAAIjENDIIBBBAIHMBAiBzM7ZAAAEEIiGgEQCRGDeDQAABBIwXIACMfwkAgAACpgoQAKbOPONGQEOATaIlQABEaz4ZDQIIIGBbgACwTUVBBBBAIFoCBEC05tPd0VA7AghESoAAiNR0MhgEEEDAvgABYN+KkggggECkBDIIgEiNm8EggAACxgsQAMa/BABAAAFTBQgAU2eecSOQgQBFoylAAERzXhkVAgggkFaAAEhLRAEEEEAgmgIEQDTn1dlRURsCCERSgACI5LQyKAQQQCC9AAGQ3ogSCCCAQCQFbARAJMfNoBBAAAHjBQgA418CACCAgKkCBICpM8+4EbAhQJFoCxAA0Z5fRocAAgjUKkAA1ErDEwgggEC0BQiAaM9vdqNjawQQiLQAARDp6WVwCCCAQO0CBEDtNjyDAAIIRFogRQBEetwMDgEEEDBegAAw/iUAAAIImCpAAJg684wbgRQCPGWGAAFgxjwzSgQQQKCaAAFQjYQVCCCAgBkCBIAZ85zZKCmNAAJGCBAARkwzg0QAAQSqCxAA1U1YgwACCBghUEMAGDFuBokAAggYL0AAGP8SAAABBEwVIABMnXnGjUANAqwyS4AAMGu+GS0CCCCQFCAAkhQsIIAAAmYJEABmzXfq0fIsAggYJUAAGDXdDBYBBBD4rwAB8F8LlhBAAAGjBCoFgFHjZrAIIICA8QIEgPEvAQAQQMBUAQLA1Jln3AhUEmDRTAECwMx5Z9QIIICARQDwIkAAAQQMFSAADJ34vYbNAwQQMFKAADBy2hk0AgggYHEKiBcBAgggYKpAzLJMHTrjRgABBMwW4BSQ2fPP6BFAwGABAsDgyWfoCCBgtsD/AwAA//8M15XnAAAABklEQVQDAHX92tMzknW4AAAAAElFTkSuQmCC" };
const PWA_MANIFEST = {
  name: "Boa Cinema",
  short_name: "Boa Cinema",
  description: "Discover movies and series",
  id: "/app",
  start_url: "/app",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#0a0a0a",
  theme_color: "#0a0a0a",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
function pwaResponse(path) {
  if (path === "/manifest.webmanifest" || path === "/manifest.json")
    return new Response(JSON.stringify(PWA_MANIFEST), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
  if (path === "/sw.js")
    return new Response(SW_JS, { headers: { "content-type": "application/javascript", "cache-control": "no-cache, no-store, must-revalidate", "service-worker-allowed": "/" } });
  const m = /^\/icon-(192|512)\.png$/.exec(path);
  if (m) {
    const bin = atob(PWA_ICONS[m[1]]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
  }
  return null;
}


// ============================================================================
// VISITOR ANALYTICS: hashed-IP presence keys with TTLs (self-cleaning, no raw IPs, no event logs)
//   live_<hash>  3 min   -> "Active Now"
//   day_<hash>   24 h    -> "Active Today"
//   mon_<hash>   30 days -> "Active Users (30 days)"  (metadata keeps the last-seen day for "This Week")
//   agg          one small JSON: 144 ten-minute samples (24 h) + 7 daily counts
// ============================================================================
// Public routes never write to Workers KV. Visitor counters live in this small in-memory store instead
// (bounded, TTL-aware). Set the Worker variable ANALYTICS_KV=1 to opt back in to KV-backed counters.
const MEMKV = (function () {
  const m = new Map(), CAP = 6000;
  const live = (k) => { const e = m.get(k); if (!e) return null; if (e.x && e.x < Date.now()) { m.delete(k); return null; } return e; };
  return {
    async get(k) { const e = live(k); return e ? e.v : null; },
    async put(k, v, o) {
      m.delete(k);
      m.set(k, { v: String(v), x: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0, md: o && o.metadata });
      if (m.size > CAP) {
        const now = Date.now();
        for (const [kk, e] of m) if (e.x && e.x < now) m.delete(kk);
        while (m.size > CAP) m.delete(m.keys().next().value);
      }
    },
    async delete(k) { m.delete(k); },
    async list(o) {
      const pre = (o && o.prefix) || "", now = Date.now(), keys = [];
      for (const [k, e] of m) { if (e.x && e.x < now) { m.delete(k); continue; } if (k.startsWith(pre)) keys.push(e.md ? { name: k, metadata: e.md } : { name: k }); }
      return { keys, list_complete: true };
    },
  };
})();
function anEnv(env) {
  if (!env || env.BOT_USERS === MEMKV || env.ANALYTICS_KV === "1") return env;
  const e2 = Object.create(env);
  Object.defineProperty(e2, "BOT_USERS", { value: MEMKV, enumerable: true });
  return e2;
}
const anMemo = new Map();
let anStatsCache = null, anStatsAt = 0, anLastRoll = 0, anLastVisit = 0;
async function anHash(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  const ua = request.headers.get("user-agent") || "";
  const salt = (env.ANALYTICS_SALT || env.BOT_TOKEN || "boa") + "|" + new Date().toISOString().slice(0, 7);
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((ip || ua || "?") + "|" + salt));
  return [...new Uint8Array(dig)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Walks a KV prefix page by page (1000 keys max in memory at a time) and hands each key name to fn.
async function anEach(env, prefix, fn) {
  let cursor;
  for (let i = 0; i < 60; i++) {
    const page = await env.BOT_USERS.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) fn(k.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
}
async function anCount(env, prefix) { let n = 0; await anEach(env, prefix, () => { n++; }); return n; }
// Compact keys (names carry the data, so tallying never needs to read values):
//   s:<sessionId>:<b|p|w><0|1>  one per open app/tab, TTL 75s  value {s,t,ts}   (3 phones = 3 keys, even behind one Wi-Fi)
//   d:<dayIdx>:<visitorId>      TTL 8 days   unique visitor per UTC day (Active Today + the 7-day chart)
//   v:<visitorId>               TTL 7 days   "seen this week"        m:<visitorId>  TTL 30 days
const AN_SRC = { bot: "b", bot_mini_app: "b", app: "p", pwa_installed: "p", web: "w", browser: "w" };
const AN_ID = /^[a-z0-9]{6,24}$/;
async function analyticsPing(request, env) {
  env = anEnv(env);
  const nope = new Response(null, { status: 204 });
  if (!env.BOT_USERS) return nope;
  let b = {};
  try { b = await request.json(); } catch (e) {}
  const src = AN_SRC[b.source] || "w";
  const st = b.streaming === true ? 1 : 0;
  const now = Date.now();
  const dayIdx = Math.floor(now / 86400000);
  let vid = AN_ID.test(String(b.vid || "")) ? String(b.vid) : "";
  if (!vid) vid = await anHash(env, request);          // old clients: fall back to a salted IP hash
  const sid = AN_ID.test(String(b.sid || "")) ? String(b.sid) : vid;
  const jobs = [];
  const ms = anMemo.get("s" + sid) || {};
  const sk = "s:" + sid + ":" + src + st;
  if (ms.k !== sk || now - ms.at > 45000) {
    jobs.push(env.BOT_USERS.put(sk, JSON.stringify({ s: src, t: st, ts: now }), { expirationTtl: 75 }));
    if (ms.k && ms.k !== sk) jobs.push(env.BOT_USERS.delete(ms.k));
    else if (!ms.k && b.edge === true) jobs.push(env.BOT_USERS.delete("s:" + sid + ":" + src + (1 - st)));
    ms.k = sk; ms.at = now;
  }
  capSet(anMemo, "s" + sid, ms, 1000);
  const mv = anMemo.get("v" + vid) || {};
  if (mv.day !== dayIdx) {
    mv.day = dayIdx;
    jobs.push(env.BOT_USERS.put("d:" + dayIdx + ":" + vid, "1", { expirationTtl: 691200 }));
    jobs.push(env.BOT_USERS.put("v:" + vid, "1", { expirationTtl: 604800 }));
    jobs.push(env.BOT_USERS.put("m:" + vid, "1", { expirationTtl: 2592000 }));
  }
  capSet(anMemo, "v" + vid, mv, 1000);
  if (now - anLastVisit > 600000) { anLastVisit = now; jobs.push(env.BOT_USERS.put("cfg:lastvisit", String(now))); }
  try { await Promise.all(jobs); } catch (e) {}
  if (now - anLastRoll > 600000) { anLastRoll = now; try { await analyticsRoll(env); } catch (e) {} }
  return nope;
}
// fixed-size history: 144 x 10-minute "active now" peaks and 7 daily "active today" counts
async function analyticsRoll(env, liveCount, dayCount) {
  env = anEnv(env);
  const now = Date.now();
  let agg = {};
  try { agg = JSON.parse((await env.BOT_USERS.get("agg")) || "{}") || {}; } catch (e) {}
  if (!liveCount && agg.t && now - agg.t < 540000) return agg;
  if (liveCount == null) liveCount = await anCount(env, "s:");
  const slot = Math.floor(now / 600000);
  const s = Array.isArray(agg.s) && agg.s.length === 144 ? agg.s : new Array(144).fill(0);
  if (agg.se != null) { for (let i = agg.se + 1; i <= Math.min(slot, agg.se + 144); i++) s[i % 144] = 0; }
  s[slot % 144] = Math.max(agg.se === slot ? s[slot % 144] : 0, liveCount);
  const dayIdx = Math.floor(now / 86400000);
  const d = Array.isArray(agg.d) && agg.d.length === 7 ? agg.d : new Array(7).fill(0);
  if (agg.de != null) { for (let i = agg.de + 1; i <= Math.min(dayIdx, agg.de + 7); i++) d[i % 7] = 0; }
  if (dayCount == null && (!agg.dt || now - agg.dt > 3600000)) dayCount = await anCount(env, "d:" + dayIdx + ":");
  if (dayCount != null) { d[dayIdx % 7] = Math.max(d[dayIdx % 7] || 0, dayCount); agg.dt = now; }
  const out = { s, se: slot, d, de: dayIdx, dt: agg.dt || 0, t: now };
  await env.BOT_USERS.put("agg", JSON.stringify(out));
  return out;
}
const anDayHist = new Map();   // day index -> unique visitors that day (memory only, <= 31 entries; fills as stats are read)
async function analyticsStats(env) {
  env = anEnv(env);
  const empty = { active: null, today: 0, week: 0, lastVisit: 0, now: 0, streaming: 0, src: { b: 0, p: 0, w: 0 }, breakdown: { streaming: 0, bot: 0, app: 0, web: 0 }, hours: [], days: [], first: 0 };
  if (!env.BOT_USERS) return empty;
  if (anStatsCache && Date.now() - anStatsAt < 30000) return anStatsCache;
  try {
    const nowMs = Date.now();
    const dayIdx = Math.floor(nowMs / 86400000);
    const out = { ...empty, first: dayIdx - 6, days: [0, 0, 0, 0, 0, 0, 0] };
    const seen = new Set();            // one entry per active session id (tiny strings, bounded by who is online)
    const tally = anEach(env, "s:", (name) => {
      const c = name.lastIndexOf(":");
      const sid = name.slice(2, c), tail = name.slice(c + 1);
      if (seen.has(sid)) return;
      seen.add(sid);
      if (out.src[tail[0]] != null) out.src[tail[0]]++;
      if (tail[1] === "1") out.streaming++;
    });
    const dayT = anEach(env, "d:", (name) => {
      const d = Number(name.slice(2, name.indexOf(":", 2))), i = d - (dayIdx - 6);
      if (i >= 0 && i < 7) out.days[i]++;
    });
    const [, , wk, mo] = await Promise.all([tally, dayT, anCount(env, "v:"), anCount(env, "m:")]);
    out.now = seen.size;
    out.today = out.days[6];
    // Cumulative figures: sum of the daily active-user counts (yesterday + today + earlier days; today is counted once).
    for (let i = 0; i < 7; i++) { const di = dayIdx - 6 + i, old = anDayHist.get(di) || 0; if (out.days[i] > old || i === 6) anDayHist.set(di, Math.max(out.days[i], i === 6 ? out.days[i] : old)); }
    for (const k of anDayHist.keys()) if (k < dayIdx - 29) anDayHist.delete(k);
    let wsum = 0, msum = 0;
    for (let i = 0; i < 7; i++) wsum += out.days[i];
    for (const [k, n] of anDayHist) if (k >= dayIdx - 29 && k <= dayIdx) msum += n;
    out.week = wsum;
    out.active = Math.max(msum, wsum);
    out.uniqWeek = wk; out.uniqMonth = mo;         // unique people (not summed), kept for reference
    out.breakdown = { streaming: out.streaming, bot: out.src.b, app: out.src.p, web: out.src.w };
    out.lastVisit = Number(await env.BOT_USERS.get("cfg:lastvisit")) || 0;
    const agg = await analyticsRoll(env, out.now, out.today);
    const slot = Math.floor(nowMs / 600000);
    for (let i = 143; i >= 0; i--) out.hours.push(slot - i > agg.se ? 0 : agg.s[(slot - i) % 144] || 0);
    anStatsCache = out; anStatsAt = nowMs;
    return out;
  } catch (e) { return empty; }
}


// ============================================================================
// INTEGRATIONS: personal API keys + options, kept in KV (cfg:integrations). Written ONLY by the admin Save button.
// Blank key = use the built-in default (TMDb: the Worker's TMDB_KEY). Keys are never sent back to the browser in full.
// ============================================================================
const INTEG_DEFAULT = {
  tmdb: { on: false, key: "", lang: "en-US", opts: { trailers: true, cast: true } },
  mdblist: { on: false, key: "", lang: "en", opts: { imdb: true, rt: true, metacritic: false, letterboxd: false } },
  subdl: { on: false, key: "", lang: "en", opts: { auto: true, hi: false } },
  ads: { on: false, key: "", lang: "en", zone: "", midZone: "", url: "", opts: { viewgate: true } },
  bridge: { on: false, key: "", lang: "en", url: "", opts: {} },
  custom: [],
};
let integCache = null, integAt = 0;
function integMerge(c) {
  c = c || {};
  const o = { custom: Array.isArray(c.custom) ? c.custom.slice(0, 8) : [] };
  for (const k of ["tmdb", "mdblist", "subdl", "ads", "bridge"]) o[k] = { ...INTEG_DEFAULT[k], ...(c[k] || {}), opts: { ...INTEG_DEFAULT[k].opts, ...((c[k] && c[k].opts) || {}) } };
  return o;
}
async function getIntegrations(env) {
  if (integCache && Date.now() - integAt < 300000) return integCache;
  let c = null;
  try { if (env && env.BOT_USERS) c = JSON.parse((await env.BOT_USERS.get("cfg:integrations")) || "{}") || {}; } catch (e) { c = null; }
  if (c === null && integCache) { integAt = Date.now() - 240000; return integCache; }   // read failed: keep the last good copy, retry in 1 min
  integCache = integMerge(c || {}); integAt = Date.now();
  return integCache;
}
// Runtime lookup for any integration (built-in name or custom id). Memory-cached, never writes. Returns null when off or missing.
async function integGet(env, id) {
  const c = await getIntegrations(env);
  const x = c[id] && id !== "custom" ? c[id] : (c.custom || []).find((y) => y.id === id);
  return x && x.on ? x : null;
}
function integKeyOf(old, k) {            // undefined = keep what is saved, "" = clear (fall back to default)
  if (k === undefined || k === null) return old || "";
  k = String(k).trim();
  if (!k) return "";
  if (!/^[\w.~+\/=:-]{6,300}$/.test(k)) throw new Error("That key doesn't look right. Paste it again without spaces");
  return k;
}
function integApply(prev, b) {
  const c = integMerge(JSON.parse(JSON.stringify(prev)));
  const kind = String(b.kind || "");
  if (kind === "custom") {
    if (b.remove) { c.custom = c.custom.filter((x) => x.id !== b.id); return c; }
    let x = c.custom.find((y) => y.id === b.id);
    if (!x) {
      if (c.custom.length >= 8) throw new Error("Up to 8 custom keys");
      x = { id: "c" + Date.now().toString(36), name: "", on: true, key: "", url: "" };
      c.custom.push(x);
    }
    const name = b.name === undefined ? x.name : String(b.name || "").trim().slice(0, 40);
    if (!name) throw new Error("Give this key a name");
    const url = b.url === undefined ? x.url : String(b.url || "").trim();
    if (url && !/^https:\/\/[^\s"'<>]{4,300}$/i.test(url)) throw new Error("Base URL must start with https://");
    x.name = name; x.url = url; x.on = !!b.on; x.key = integKeyOf(x.key, b.key);
    return c;
  }
  if (!INTEG_DEFAULT[kind] || kind === "custom") throw new Error("Unknown integration");
  const D = INTEG_DEFAULT[kind], x = c[kind], lg = String(b.lang || "").trim();
  x.on = !!b.on;
  x.key = integKeyOf(x.key, b.key);
  x.lang = b.lang === undefined ? x.lang : (/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(lg) ? lg : D.lang);
  const o = {};
  for (const k in D.opts) o[k] = b.opts && b.opts[k] !== undefined ? !!b.opts[k] : (x.opts && x.opts[k] !== undefined ? !!x.opts[k] : D.opts[k]);
  x.opts = o;
  if (kind === "ads") {
    x.key = "";                                              // ad requests never carry an API key
    const zr = /^[\w.-]{1,40}$/, one = (v, old) => (v === undefined ? old : String(v || "").trim());
    x.zone = one(b.zone, x.zone); x.midZone = one(b.midZone, x.midZone); x.url = one(b.url, x.url);
    if ((x.zone && !zr.test(x.zone)) || (x.midZone && !zr.test(x.midZone))) throw new Error("Zone IDs can only use letters, numbers, dots and dashes");
    if (x.url && !/^https:\/\/[^\s"'<>]{8,2000}$/i.test(x.url)) throw new Error("Ad tag template must start with https://");
    if (x.on && !(x.zone || x.url)) throw new Error("Add a zone ID or an ad tag template before turning this on");
  } else if (kind === "bridge") {
    if (b.url !== undefined) x.url = String(b.url || "").trim();
    if (x.url && (!/^https:\/\/[^\s"'<>]{8,2000}$/i.test(x.url) || /^https:\/\/[^/?#]*onrender\.com([/:?#]|$)/i.test(x.url))) throw new Error("Bridge address must start with https:// and cannot be a Render address (video must never pass through Render)");
    if (x.on && !x.url) throw new Error("Add your bridge address before turning this on");
  } else if (x.on && kind !== "tmdb" && !x.key) throw new Error("Add your API key before turning this on");
  return c;
}
function integView(c) {
  const m = (x) => { const o = { ...x, keySet: !!x.key, mask: x.key ? "\u2022\u2022\u2022\u2022" + x.key.slice(-4) : "" }; delete o.key; return o; };
  return { tmdb: m(c.tmdb), mdblist: m(c.mdblist), subdl: m(c.subdl), ads: m(c.ads), bridge: m(c.bridge), custom: c.custom.map(m) };
}
// MDBList ratings for one title (only when the owner turned it on and saved a key). Cached at the edge, no KV writes.
async function ratingsHandle(url, env) {
  const hd = { "content-type": "application/json", "cache-control": "public, max-age=21600" };
  try {
    const ic = (await integGet(env, "mdblist")) || { on: false };
    const type = url.searchParams.get("type") === "tv" ? "show" : "movie", id = url.searchParams.get("id") || "";
    if (!ic.key || !/^\d{1,9}$/.test(id)) return new Response('{"ok":false}', { headers: { ...hd, "cache-control": "no-store" } });
    const r = await fetch("https://api.mdblist.com/tmdb/" + type + "/" + id + "?apikey=" + encodeURIComponent(ic.key), { cf: { cacheTtl: 21600, cacheEverything: true }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return new Response('{"ok":false}', { headers: { ...hd, "cache-control": "no-store" } });
    const j = await r.json(), want = ic.opts || {}, out = [];
    for (const x of j.ratings || []) {
      const src = String(x.source || "").toLowerCase();
      if (x.value == null) continue;
      if ((src === "imdb" && want.imdb) || (src.indexOf("tomato") > -1 && want.rt) || (src === "metacritic" && want.metacritic) || (src === "letterboxd" && want.letterboxd)) out.push({ s: src, v: x.value });
    }
    return new Response(JSON.stringify({ ok: true, ratings: out }), { headers: hd });
  } catch (e) { return new Response('{"ok":false}', { headers: { ...hd, "cache-control": "no-store" } }); }
}


// ============================================================================
// TORRENT BRIDGE: an OPTIONAL resolver (your own server or a hosted one, set in Admin > Integrations > Torrent Bridge) that turns a magnet
// link into a direct HTTP/HLS stream URL, so a browser can play torrents that have no WebRTC peers. Only the small JSON answer passes through
// this Worker; the video travels straight from the bridge to the viewer (never through Render, never through this Worker). No KV writes.
//   Template mode:  address contains {magnet} and/or {hash} (and optionally {key}); the stream URL is built instantly, e.g.
//                   https://my-torrserver.example/stream?link={magnet}&index=1&play
//   Resolver mode:  address has no placeholders; the Worker calls  GET <address>?magnet=<magnet>  and expects {"url":"https://..."}
// ============================================================================
const BR_JOBS = new Map();
function bridgeUrlOk(u) {
  return relayAllowed(u) && !/(^|\.)onrender\.com$/i.test(new URL(u).hostname);
}
async function bridgeResolve(env, magnet) {
  const ic = await integGet(env, "bridge");
  if (!ic || !ic.url) return { ok: false, off: true };
  const m = /^magnet:\?(?:[^#]*&)?xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})(?:&|$)/i.exec(magnet);
  if (!m || magnet.length > 2000) return { ok: false, error: "bad magnet" };
  const hash = m[1].toLowerCase();
  if (/\{(magnet|hash)\}/i.test(ic.url)) {
    const u = ic.url.replace(/\{magnet\}/gi, encodeURIComponent(magnet)).replace(/\{hash\}/gi, hash).replace(/\{key\}/gi, encodeURIComponent(ic.key || ""));
    return bridgeUrlOk(u) ? { ok: true, url: u, mode: "direct" } : { ok: false, error: "bridge address not allowed" };
  }
  const ck = new Request("https://boa-cache.internal/bridge/" + hash);
  try {
    const hit = globalThis.caches && caches.default ? await caches.default.match(ck) : null;
    if (hit) { const j = await hit.json(); if (j && j.url) return { ok: true, url: j.url, mode: "resolved" }; }
  } catch (e) {}
  if (BR_JOBS.has(hash)) return BR_JOBS.get(hash);            // same torrent asked at the same moment: one call to the bridge
  const job = (async () => {
    try {
      const target = ic.url + (ic.url.includes("?") ? "&" : "?") + "magnet=" + encodeURIComponent(magnet);
      const hd = { accept: "application/json" };
      if (ic.key) hd.authorization = "Bearer " + ic.key;
      const r = await fetch(target, { headers: hd, signal: AbortSignal.timeout(Number(env.BRIDGE_TIMEOUT_MS) || 20000) });
      if (!r.ok) return { ok: false, error: "bridge answered " + r.status };
      const j = await r.json();
      const u = String((j && (j.url || j.stream || j.hls)) || "");
      if (!bridgeUrlOk(u)) return { ok: false, error: "bridge returned no usable link" };
      try { if (globalThis.caches && caches.default) await caches.default.put(ck, new Response(JSON.stringify({ url: u }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } })); } catch (e) {}
      return { ok: true, url: u, mode: "resolved" };
    } catch (e) { return { ok: false, error: "bridge unreachable" }; }
  })().finally(() => BR_JOBS.delete(hash));
  BR_JOBS.set(hash, job);
  return job;
}

// ============================================================================
// VAST ADS: tag is kept in KV (cfg:ads); the Worker fetches + parses VAST (wrappers included) so the browser never needs CORS access
// ============================================================================
// HilltopAds VAST: lock = seconds a pre-roll cannot be skipped (the video starts after it), skip = seconds before a mid-roll skip button unlocks
const ADS_DEFAULT = { on: false, tag: "", midTag: "", pre: true, mid: true, lock: 15, skip: 15, view: 5, movie: [35, 40], tv: [20, 25] };
async function getAds(env) {
  let c = {};
  try { if (env.BOT_USERS) c = JSON.parse((await env.BOT_USERS.get("cfg:ads")) || "{}") || {}; } catch (e) {}
  if (c.lock === undefined) c.skip = ADS_DEFAULT.skip;      // settings saved before the 15 s pre-roll / mid-roll rules move to the new timers
  return { ...ADS_DEFAULT, ...c };
}
function adNum(v, lo, hi, d) { const n = Number(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
function cleanAds(b) {
  const tag = String(b.tag || "").trim(), midTag = String(b.midTag || "").trim();
  const ok = (u) => !u || /^https:\/\/[^\s"'<>]{8,2000}$/i.test(u);
  if (!ok(tag) || !ok(midTag)) return null;
  const rng = (a, d) => { const x = adNum(a && a[0], 1, 600, d[0]), y = adNum(a && a[1], 1, 600, d[1]); return [Math.min(x, y), Math.max(x, y)]; };
  return { on: !!b.on, tag, midTag, pre: b.pre !== false, mid: b.mid !== false, lock: adNum(b.lock, 0, 60, 15), skip: adNum(b.skip, 0, 60, 15), view: adNum(b.view, 0, 30, 5), movie: rng(b.movie, [35, 40]), tv: rng(b.tv, [20, 25]) };
}
// Effective VAST tag: the Ads tab tag if set, else the optional HilltopAds template from Integrations with its zone id filled in. No API key is ever added to an ad request.
function adTagFor(a, ic, kind) {
  const z = ic ? (kind === "mid" && ic.midZone ? ic.midZone : ic.zone) || "" : "";
  let tag = kind === "mid" ? a.midTag || a.tag : a.tag;
  if (!tag && ic && ic.url) tag = ic.url;
  return String(tag || "").replace(/\[ZONE\]|\{\{?ZONE\}?\}/gi, encodeURIComponent(z)).replace(/\[KEY\]|\{\{?KEY\}?\}/gi, "");
}
function adMacros(tag, request) {
  const ip = (request && (request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim())) || "";
  const ua = (request && request.headers.get("user-agent")) || "";
  const ts = String(Date.now());
  return tag
    .replace(/\[(CACHEBUSTER|TIMESTAMP|RANDOM)\]|\{\{?(CACHEBUSTER|TIMESTAMP|RANDOM)\}?\}/gi, ts)
    .replace(/\[IP\]|\{\{?IP\}?\}/gi, encodeURIComponent(ip))
    .replace(/\[UA\]|\{\{?UA\}?\}/gi, encodeURIComponent(ua));
}
function xmlText(v) { return String(v || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").trim(); }
function xmlAttr(attrs, name) { const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(attrs || ""); return m ? m[1] : ""; }
function vastSecs(t) { const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t || ""); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; }
async function fetchVast(tag, request, depth, acc) {
  acc = acc || { imp: [], trk: {}, click: [], clickTrk: [] };
  const ip = (request && (request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim())) || "";
  const headers = { accept: "application/xml,text/xml,*/*", "user-agent": (request && request.headers.get("user-agent")) || "Mozilla/5.0" };
  if (ip) headers["x-forwarded-for"] = ip;
  const r = await fetch(adMacros(tag, request), { headers, signal: AbortSignal.timeout(6000), redirect: "follow" });
  if (!r.ok) throw new Error("ad server answered " + r.status);
  const xml = await r.text();
  if (xml.length > 600000) throw new Error("VAST too large");
  if (!/<VAST\b/i.test(xml)) throw new Error("not a VAST response");
  let m;
  const imp = /<Impression\b[^>]*>([\s\S]*?)<\/Impression>/gi;
  while ((m = imp.exec(xml))) { const u = xmlText(m[1]); if (/^https?:/i.test(u)) acc.imp.push(u); }
  const trk = /<Tracking\b([^>]*)>([\s\S]*?)<\/Tracking>/gi;
  while ((m = trk.exec(xml))) {
    const ev = xmlAttr(m[1], "event"), u = xmlText(m[2]);
    if (!ev || !/^https?:/i.test(u)) continue;
    if (ev === "progress") (acc.prog = acc.prog || []).push({ o: xmlAttr(m[1], "offset"), u });   // progress pings carry a time offset
    else (acc.trk[ev] = acc.trk[ev] || []).push(u);
  }
  const vw = /<Viewable\b[^>]*>([\s\S]*?)<\/Viewable>/gi;                                       // VAST 4 viewability pixels
  while ((m = vw.exec(xml))) { const u = xmlText(m[1]); if (/^https?:/i.test(u)) (acc.trk.viewable = acc.trk.viewable || []).push(u); }
  const ct = /<ClickTracking\b[^>]*>([\s\S]*?)<\/ClickTracking>/gi;
  while ((m = ct.exec(xml))) { const u = xmlText(m[1]); if (/^https?:/i.test(u)) acc.clickTrk.push(u); }
  const er = /<Error\b[^>]*>([\s\S]*?)<\/Error>/gi;
  while ((m = er.exec(xml))) { const u = xmlText(m[1]); if (/^https?:/i.test(u)) (acc.trk.error = acc.trk.error || []).push(u); }
  const wrap = /<VASTAdTagURI\b[^>]*>([\s\S]*?)<\/VASTAdTagURI>/i.exec(xml);
  if (wrap) {
    if (depth >= 4) throw new Error("too many wrapper redirects");
    return fetchVast(xmlText(wrap[1]), request, depth + 1, acc);
  }
  const files = [];
  const mf = /<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi;
  while ((m = mf.exec(xml))) {
    const type = xmlAttr(m[1], "type");
    let u = xmlText(m[2]);
    if (!/^https?:/i.test(u) || !/^video\/(mp4|webm)/i.test(type)) continue;
    u = u.replace(/^http:/i, "https:");
    files.push({ url: u, type, w: Number(xmlAttr(m[1], "width")) || 0 });
  }
  if (!files.length) throw new Error("no playable video file in the ad (needs MP4 or WebM)");
  files.sort((a, b) => Math.abs((a.w || 640) - 640) - Math.abs((b.w || 640) - 640) + ((/mp4/i.test(b.type) ? 1 : 0) - (/mp4/i.test(a.type) ? 1 : 0)) * 1000);
  const dur = /<Duration>\s*([\d:.]+)\s*<\/Duration>/i.exec(xml);
  const click = /<ClickThrough\b[^>]*>([\s\S]*?)<\/ClickThrough>/i.exec(xml);
  const so = /<Linear\b[^>]*\bskipoffset\s*=\s*"([^"]*)"/i.exec(xml);
  return {
    skipoff: so ? so[1].slice(0, 20) : "", prog: (acc.prog || []).slice(0, 12),
    media: files[0].url, type: files[0].type, duration: vastSecs(dur && dur[1]),
    imp: acc.imp.slice(0, 30), trk: acc.trk, click: click && /^https?:/i.test(xmlText(click[1])) ? xmlText(click[1]) : "", clickTrk: acc.clickTrk.slice(0, 10),
  };
}

const ACTIVE_DAYS = 30;
let usersCache = { n: null, at: 0 };

async function trackUser(env, userId) {
  env = anEnv(env);
  if (!env.BOT_USERS || !userId) return;
  try {
    const key = `u:${userId}`;
    const today = Math.floor(Date.now() / 86400000);
    if (userDayMemo.get(userId) === today) return;
    const last = await env.BOT_USERS.get(key);
    if (last !== null && Number(last) === today) { capSet(userDayMemo, userId, today, 400); return; } // already counted today, no write
    await env.BOT_USERS.put(key, String(today), { expirationTtl: ACTIVE_DAYS * 86400, metadata: { d: today } });
    capSet(userDayMemo, userId, today, 400);
    const now = Date.now();
    if (now - lastVisitWrite > 600000) {
      lastVisitWrite = now;
      await env.BOT_USERS.put("cfg:lastvisit", String(now));
    }
  } catch (e) {}
}
let lastVisitWrite = 0;
const userDayMemo = new Map();
async function activityStats(env) {
  env = anEnv(env);
  const out = { active: null, today: 0, week: 0, lastVisit: 0 };
  if (!env.BOT_USERS) return out;
  const today = Math.floor(Date.now() / 86400000);
  let n = 0, cursor;
  try {
    for (let i = 0; i < 25; i++) {
      const page = await env.BOT_USERS.list({ prefix: "u:", cursor });
      page.keys.forEach((k) => {
        n++;
        const d = k.metadata && k.metadata.d;
        if (d === today) out.today++;
        if (d != null && today - d < 7) out.week++;
      });
      if (page.list_complete) break;
      cursor = page.cursor;
    }
    out.active = n;
    out.lastVisit = Number(await env.BOT_USERS.get("cfg:lastvisit")) || 0;
  } catch (e) {}
  return out;
}

async function activeUsers(env, fresh = false) {
  if (!env.BOT_USERS) return null;
  if (!fresh && usersCache.n !== null && Date.now() - usersCache.at < 60000) return usersCache.n;
  let n = 0;
  let cursor;
  try {
    for (let i = 0; i < 25; i++) {
      const page = await env.BOT_USERS.list({ prefix: "u:", cursor });
      n += page.keys.length;
      if (page.list_complete) break;
      cursor = page.cursor;
    }
  } catch (e) {
    return usersCache.n;
  }
  usersCache = { n, at: Date.now() };
  return n;
}

const usersLine = (n) =>
  n === null ? "" : `\n👥 <b>${n.toLocaleString("en-US")}</b> active member${n === 1 ? "" : "s"} this month`;

// ============================================================================
// 11. BOT SETUP (runs once after each deploy)
// ============================================================================

let setupDone = false;
async function setupBot(env) {
  if (setupDone) return;
  setupDone = true;
  try {
    // Restores the normal "Menu" commands button, which removes the extra Cinema button
    // beside the message box (Open Boa Cinema stays inside the main menu).
    await tg(env, "setChatMenuButton", { menu_button: { type: "commands" } });
    await tg(env, "setMyCommands", {
      commands: [
        { command: "start", description: "Open the main menu" },
        { command: "movies", description: "Browse movies" },
        { command: "series", description: "Browse series" },
        { command: "soon", description: "Coming soon by region" },
        { command: "random", description: "Surprise me" },
        { command: "faith", description: "Faith and Christian picks" },
        { command: "book", description: "Find a book" },
        { command: "song", description: "Find a song" },
        { command: "cinema", description: "Open Boa Cinema" },
        { command: "stats", description: "Active members" },
        { command: "help", description: "How to use the bot" },
      ],
    });
  } catch (e) {
    setupDone = false;
  }
}

// ============================================================================
// 12. UPDATE HANDLER: the chat opens Boa Cinema; books and songs stay in chat
// ============================================================================

const CAT_KEY = {
  "Sci-Fi": "scifi",
  "Sci-Fi and Fantasy": "scifi",
  "Action and Adventure": "action",
  Adventure: "action",
};
const SOON_WORDS = new Set(["comingsoon", "upcoming", "releases", "newreleases", "upcomingmovies", "comingsoonmovies"]);
const catKey = (c) => (c.type === "netflix" ? "netflix" : c.type === "faith" ? "faith" : CAT_KEY[c.name] || c.name.toLowerCase());

const startText = () =>
  `🍿 <b>Welcome to ${BRAND}</b>\n` +
  "<i>Movies and series: trailers, cast, ratings, new releases and where to watch.</i>\n\n" +
  "Tap 🍿 <b>Open Boa Cinema</b> to browse. You can also type a movie or series title, a song or a book right here.";

const helpText = () =>
  `🍿 <b>${BRAND} help</b>\n\n` +
  "<b>Watch</b>\n" +
  "/cinema · open Boa Cinema\n" +
  "/movies · /series · jump to movies or series\n" +
  "/faith · faith and Christian picks\n" +
  "/kdrama · /nollywood · /bollywood · /hollywood · /anime\n" +
  "/soon · coming soon, by region\n" +
  "/random · surprise me\n\n" +
  "<b>Find in chat</b>\n" +
  "/song &lt;track&gt; · song links on Spotify, Apple Music, YouTube Music & Audiomack\n" +
  "/book &lt;title&gt; · free books (Project Gutenberg, Google Books, Internet Archive, Open Library)\n\n" +
  "<b>Or just type</b>\n" +
  "• a title: <i>War Room</i> (opens in Boa Cinema)\n" +
  "• a category: <i>nollywood</i>, <i>action series</i>\n" +
  "• a song: <i>burna boy song</i>\n" +
  "• a book: <i>atomic habits pdf</i>\n\n" +
  "<i>Movie data: TMDB. Streaming data: JustWatch. This bot uses the TMDB API but is not endorsed or certified by TMDB.</i>";

// Sends one message with a single "Open Boa Cinema" button (optionally deep-linked)
function openCinema(env, chatId, text, params = {}) {
  if (!APP_URL) return say(env, chatId, "Boa Cinema isn't available right now. Try again in a moment.");
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${APP_URL}?${qs}` : APP_URL;
  return say(env, chatId, text, {
    inline_keyboard: [[{ text: "🍿 Open Boa Cinema", web_app: { url } }]],
  });
}

async function welcome(env, chatId) {
  const n = await activeUsers(env);
  return openCinema(env, chatId, startText() + usersLine(n));
}

async function handleCallback(cq, env) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  if (!cq.message) return;
  await trackUser(env, cq.from && cq.from.id);

  const msg = cq.message;
  const chatId = msg.chat.id;
  const data = cq.data || "";

  // Close: removes the bot's message and the user's message it answered
  if (data === "x" || data === "delete_msg") {
    try {
      await tg(env, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
      if (msg.reply_to_message) {
        await tg(env, "deleteMessage", {
          chat_id: chatId,
          message_id: msg.reply_to_message.message_id,
        });
      }
    } catch (e) {}
    return;
  }

  // Buttons on older menus: swap them for the Cinema button
  try {
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
  } catch (e) {}
  return welcome(env, chatId);
}

async function handleMessage(msg, env) {
  if (!msg.text) return;
  await trackUser(env, msg.from && msg.from.id);

  const chatId = msg.chat.id;
  const mid = msg.message_id;
  const text = msg.text.trim();

  // ----- slash commands -----
  if (text.startsWith("/")) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].split("@")[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();
    const regionCmd = {
      "/kdrama": "Kdrama",
      "/nollywood": "Nollywood",
      "/hollywood": "Hollywood",
      "/bollywood": "Bollywood",
      "/anime": "Anime",
    }[cmd];

    if (["/start", "/menu", "/cinema", "/app"].includes(cmd)) return welcome(env, chatId);
    if (cmd === "/movies") return openCinema(env, chatId, "🎬 Tap below to browse movies on Boa Cinema:", { type: "movie" });
    if (cmd === "/series" || cmd === "/tv") {
      return openCinema(env, chatId, "📺 Tap below to browse series on Boa Cinema:", { type: "tv" });
    }
    if (cmd === "/soon" || cmd === "/upcoming") {
      return openCinema(env, chatId, "🗓 Tap below to see what's coming soon, by region:", { type: "movie", cat: "upcoming" });
    }
    if (cmd === "/myid") return say(env, chatId, `🆔 Your Telegram ID: <code>${msg.from ? msg.from.id : ""}</code>`);
    if (cmd === "/admin" && msg.from && ownerIds(env).includes(String(msg.from.id)) && msg.chat.type === "private") {
      return openCinema(env, chatId, "🔐 <b>Owner panel</b>\nTap below, then open Profile and choose <b>Owner panel</b>.", { go: "admin" });
    }
    if (cmd === "/help") return say(env, chatId, helpText());
    if (cmd === "/stats") {
      const n = await activeUsers(env, true);
      return say(
        env,
        chatId,
        n === null
          ? "Member counting isn't switched on yet (the BOT_USERS storage isn't connected)."
          : `👥 <b>${n.toLocaleString("en-US")}</b> active member${n === 1 ? "" : "s"} in the last ${ACTIVE_DAYS} days.`
      );
    }
    if (cmd === "/book" || cmd === "/pdf") return handleBookSearch(env, chatId, arg, mid);
    if (cmd === "/song" || cmd === "/music") return handleSongSearch(env, chatId, arg, mid);
    if (cmd === "/random") {
      const picks = ["action", "comedy", "drama", "thriller", "horror", "romance", "family"];
      const cat = picks[Math.floor(Math.random() * picks.length)];
      const type = Math.random() < 0.5 ? "movie" : "tv";
      const key = ROW_DEFS[type][cat] ? cat : "trending";
      return openCinema(env, chatId, "🎲 Surprise! Tap below to see today's pick:", { type, cat: key });
    }
    if (cmd === "/faith") {
      const type = arg.toLowerCase().includes("series") ? "tv" : "movie";
      return openCinema(env, chatId, "✝️ Tap below for faith and Christian picks:", { type, cat: "faith" });
    }
    if (regionCmd) {
      const type = REGIONS[regionCmd].defaultMedia || "movie";
      return openCinema(env, chatId, `${REGIONS[regionCmd].label}: tap below to browse`, {
        type,
        cat: regionCmd.toLowerCase(),
      });
    }
    return say(env, chatId, "I don't know that command. Try /help");
  }

  // ----- songs and books stay in the chat -----
  const bookQuery = detectBook(text);
  if (bookQuery !== null) return handleBookSearch(env, chatId, bookQuery, mid);
  const songQuery = detectSong(text);
  if (songQuery !== null) return handleSongSearch(env, chatId, songQuery, mid);

  // ----- everything else opens Boa Cinema -----
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean);

  if (!tokens.length || (tokens.length === 1 && GREETINGS.has(tokens[0]))) return welcome(env, chatId);

  const hasTv = tokens.some((t) => TV_WORDS.has(t));
  const hasMovie = tokens.some((t) => MOVIE_WORDS.has(t));
  const said = hasTv ? "tv" : hasMovie ? "movie" : null;
  const rest = tokens.filter((t) => !FILLER.has(t) && !TV_WORDS.has(t) && !MOVIE_WORDS.has(t));

  if (!rest.length) {
    const type = said || "movie";
    return openCinema(env, chatId, `${MEDIA[type].icon} Tap below to browse ${MEDIA[type].label.toLowerCase()}:`, { type });
  }

  if (SOON_WORDS.has(norm(rest.join(" ")))) {
    return openCinema(env, chatId, "🗓 Tap below to see what's coming soon, by region:", { type: said || "movie", cat: "upcoming" });
  }

  const cat = CATEGORY_LOOKUP.get(norm(rest.join(" ")));
  if (cat) {
    const type = said || (cat.type === "region" ? REGIONS[cat.name].defaultMedia || "movie" : "movie");
    const key = catKey(cat);
    if (ROW_DEFS[type][key]) {
      return openCinema(env, chatId, `🍿 <b>${esc(ROW_DEFS[type][key].title)}</b> is ready. Tap below:`, {
        type,
        cat: key,
      });
    }
  }

  // Not a category: search it inside Boa Cinema
  const q = said ? rest.join(" ") : clip(text, 100);
  return openCinema(env, chatId, `🔎 Tap below to see <b>${esc(clip(q, 60))}</b> on Boa Cinema:`, { q });
}

async function handleUpdate(update, env) {
  if (update.callback_query) return handleCallback(update.callback_query, env);
  if (update.message) return handleMessage(update.message, env);
}

// ============================================================================
// 13. BOA CINEMA: data API (movies and series)
// ============================================================================

const disc = (media, extra, votes = 50) => `${baseParams(media, votes)}${extra}`;

const ROW_DEFS = {
  movie: {
    trending: { title: "🔥 Trending Now", path: "/trending/movie/week", params: "" },
    upcoming_boa: { title: "⭐ Boa Picks", curated: true },
    netflix: { title: "🔴 On Netflix: Movies", netflix: true },
    netflix_ng: { title: "🔴 Nollywood on Netflix", netflix: true, extra: "&with_origin_country=NG", votes: 1 },
    netflix_new: { title: "🔴 New on Netflix", netflix: true, fresh: true },
    upcoming: { title: "🗓 Coming Soon", upcoming: true, variants: [""] },
    upcoming_cin: { title: "🎟 In Nigerian Cinemas Soon", upcoming: true, release: true, variants: ["&region=NG&with_release_type=2%7C3"] },
    upcoming_ng: { title: "🇳🇬 Coming Soon: Nollywood", upcoming: true, variants: ["&with_origin_country=NG", "&with_original_language=yo%7Cig%7Cha"] },
    upcoming_gh: { title: "🇬🇭 Coming Soon: Ghana", upcoming: true, variants: ["&with_origin_country=GH"] },
    upcoming_za: { title: "🇿🇦 Coming Soon: South Africa", upcoming: true, variants: ["&with_origin_country=ZA"] },
    upcoming_us: { title: "🇺🇸 Coming Soon: Hollywood", upcoming: true, variants: ["&with_origin_country=US"] },
    upcoming_gb: { title: "🇬🇧 Coming Soon: UK", upcoming: true, variants: ["&with_origin_country=GB"] },
    upcoming_kr: { title: "🇰🇷 Coming Soon: Korea", upcoming: true, variants: ["&with_original_language=ko"] },
    upcoming_in: { title: "🇮🇳 Coming Soon: India", upcoming: true, variants: ["&with_original_language=hi%7Cta%7Cte"] },
    upcoming_jp: { title: "🇯🇵 Coming Soon: Japan and Anime", upcoming: true, variants: ["&with_original_language=ja"] },
    faith: { title: "✝️ Faith and Christian", faith: true },
    nollywood: { title: "🇳🇬 Nollywood", path: "/discover/movie", params: disc("movie", "&with_origin_country=NG", 3) },
    kdrama: { title: "🇰🇷 Korean Movies", path: "/discover/movie", params: disc("movie", "&with_original_language=ko&with_origin_country=KR", 10) },
    bollywood: { title: "🇮🇳 Bollywood", path: "/discover/movie", params: disc("movie", "&with_original_language=hi&with_origin_country=IN", 10) },
    hollywood: { title: "🇺🇸 Hollywood", path: "/discover/movie", params: disc("movie", "&with_origin_country=US", 200) },
    anime: { title: "🇯🇵 Anime Movies", path: "/discover/movie", params: disc("movie", "&with_original_language=ja&with_genres=16", 10) },
    action: { title: "💥 Action", path: "/discover/movie", params: disc("movie", "&with_genres=28") },
    comedy: { title: "😂 Comedy", path: "/discover/movie", params: disc("movie", "&with_genres=35") },
    thriller: { title: "🔪 Thriller", path: "/discover/movie", params: disc("movie", "&with_genres=53") },
    horror: { title: "👻 Horror", path: "/discover/movie", params: disc("movie", "&with_genres=27") },
    romance: { title: "💕 Romance", path: "/discover/movie", params: disc("movie", "&with_genres=10749") },
    scifi: { title: "🚀 Sci-Fi", path: "/discover/movie", params: disc("movie", "&with_genres=878") },
    crime: { title: "🕵️ Crime", path: "/discover/movie", params: disc("movie", "&with_genres=80") },
    mystery: { title: "🔎 Mystery", path: "/discover/movie", params: disc("movie", "&with_genres=9648") },
    animation: { title: "🎨 Animation", path: "/discover/movie", params: disc("movie", "&with_genres=16") },
    documentary: { title: "🎞 Documentary", path: "/discover/movie", params: disc("movie", "&with_genres=99", 10) },
    family: { title: "👨‍👩‍👧 Family", path: "/discover/movie", params: disc("movie", "&with_genres=10751") },
    drama: { title: "🎭 Drama", path: "/discover/movie", params: disc("movie", "&with_genres=18") },
    toprated: { title: "⭐ Top Rated", path: "/movie/top_rated", params: "" },
  },
  tv: {
    trending: { title: "🔥 Trending Now", path: "/trending/tv/week", params: "" },
    upcoming_boa: { title: "⭐ Boa Picks", curated: true },
    netflix: { title: "🔴 On Netflix: Series", netflix: true },
    netflix_orig: { title: "🔴 Netflix Originals", path: "/discover/tv", params: disc("tv", "&with_networks=213", 50) },
    netflix_ng: { title: "🔴 Nollywood on Netflix", netflix: true, extra: "&with_origin_country=NG", votes: 1 },
    netflix_new: { title: "🔴 New on Netflix", netflix: true, fresh: true },
    upcoming: { title: "🗓 Coming Soon", upcoming: true, variants: [""] },
    upcoming_ng: { title: "🇳🇬 Coming Soon: Nollywood", upcoming: true, variants: ["&with_origin_country=NG", "&with_original_language=yo%7Cig%7Cha"] },
    upcoming_gh: { title: "🇬🇭 Coming Soon: Ghana", upcoming: true, variants: ["&with_origin_country=GH"] },
    upcoming_za: { title: "🇿🇦 Coming Soon: South Africa", upcoming: true, variants: ["&with_origin_country=ZA"] },
    upcoming_us: { title: "🇺🇸 Coming Soon: Hollywood", upcoming: true, variants: ["&with_origin_country=US"] },
    upcoming_gb: { title: "🇬🇧 Coming Soon: UK", upcoming: true, variants: ["&with_origin_country=GB"] },
    upcoming_kr: { title: "🇰🇷 Coming Soon: Korea", upcoming: true, variants: ["&with_original_language=ko"] },
    upcoming_in: { title: "🇮🇳 Coming Soon: India", upcoming: true, variants: ["&with_original_language=hi%7Cta%7Cte"] },
    upcoming_jp: { title: "🇯🇵 Coming Soon: Japan and Anime", upcoming: true, variants: ["&with_original_language=ja"] },
    faith: { title: "✝️ Faith and Christian", faith: true },
    kdrama: { title: "🇰🇷 K-Drama", path: "/discover/tv", params: disc("tv", "&with_original_language=ko&with_origin_country=KR", 10) },
    nollywood: { title: "🇳🇬 Nollywood Series", path: "/discover/tv", params: disc("tv", "&with_origin_country=NG", 3) },
    bollywood: { title: "🇮🇳 Indian Series", path: "/discover/tv", params: disc("tv", "&with_original_language=hi&with_origin_country=IN", 10) },
    hollywood: { title: "🇺🇸 Hollywood Series", path: "/discover/tv", params: disc("tv", "&with_origin_country=US", 100) },
    anime: { title: "🇯🇵 Anime Series", path: "/discover/tv", params: disc("tv", "&with_original_language=ja&with_genres=16", 10) },
    action: { title: "💥 Action and Adventure", path: "/discover/tv", params: disc("tv", "&with_genres=10759") },
    comedy: { title: "😂 Comedy", path: "/discover/tv", params: disc("tv", "&with_genres=35") },
    crime: { title: "🕵️ Crime", path: "/discover/tv", params: disc("tv", "&with_genres=80") },
    drama: { title: "🎭 Drama", path: "/discover/tv", params: disc("tv", "&with_genres=18") },
    mystery: { title: "🔎 Mystery", path: "/discover/tv", params: disc("tv", "&with_genres=9648") },
    scifi: { title: "🚀 Sci-Fi and Fantasy", path: "/discover/tv", params: disc("tv", "&with_genres=10765") },
    animation: { title: "🎨 Animation", path: "/discover/tv", params: disc("tv", "&with_genres=16") },
    documentary: { title: "🎞 Documentary", path: "/discover/tv", params: disc("tv", "&with_genres=99", 10) },
    family: { title: "👨‍👩‍👧 Family", path: "/discover/tv", params: disc("tv", "&with_genres=10751") },
    toprated: { title: "⭐ Top Rated", path: "/tv/top_rated", params: "" },
  },
};

const ROW_ORDER = {
  movie: ["trending", "upcoming_boa", "netflix", "netflix_new", "netflix_ng", "upcoming", "upcoming_cin", "upcoming_ng", "upcoming_gh", "upcoming_za", "upcoming_us", "upcoming_gb", "upcoming_kr", "upcoming_in", "upcoming_jp", "faith", "nollywood", "kdrama", "bollywood", "hollywood", "anime", "action", "comedy", "thriller", "horror", "romance", "scifi", "crime", "mystery", "animation", "documentary", "family", "drama", "toprated"],
  tv: ["trending", "upcoming_boa", "netflix", "netflix_orig", "netflix_new", "netflix_ng", "upcoming", "upcoming_ng", "upcoming_gh", "upcoming_za", "upcoming_us", "upcoming_gb", "upcoming_kr", "upcoming_in", "upcoming_jp", "faith", "kdrama", "nollywood", "bollywood", "hollywood", "anime", "action", "comedy", "crime", "drama", "mystery", "scifi", "animation", "documentary", "family", "toprated"],
};

const GENRE_NAME = {};
for (const [name, gid] of Object.entries(TV_GENRES)) GENRE_NAME[gid] = name;
for (const [name, gid] of Object.entries(GENRES)) GENRE_NAME[gid] = name;

const slim = (m, media) => ({
  id: m.id,
  mt: media,
  d: dateOf(m),
  t: titleOf(m),
  y: yearOf(m) === "N/A" ? "" : yearOf(m),
  r: m.vote_average ? m.vote_average.toFixed(1) : "",
  p: m.poster_path,
  b: m.backdrop_path,
  o: clip(m.overview || "", 220),
  g: ((m.genre_ids || []).map((gid) => GENRE_NAME[gid]).filter(Boolean)[0]) || "",
});

const slimList = (arr, media) =>
  (arr || [])
    .filter((m) => m.poster_path)
    .slice(0, 20)
    .map((m) => slim(m, media || m.media_type));

async function getRow(env, media, key) {
  if (/^x[0-9a-z]{1,8}$/.test(key) && !ROW_DEFS[media][key]) return importedRow(env, media, key);
  const def = ROW_DEFS[media][key];
  if (!def) return null;
  // Boa Picks: hand-picked titles (TMDB data when it has them, your own details when it doesn't)
  if (def.curated) {
    const picks = await getPicks(env);
    const out = (
      await Promise.all(
        picks.map(async (p, i) => {
          if ((p.media || "movie") !== media) return null;
          let hit = null;
          try {
            const d = await tmdb(
              env,
              `/search/${MEDIA[media].path}`,
              `include_adult=false&query=${encodeURIComponent(p.title)}`
            );
            hit = (d.results || []).find((r) => titleOf(r).toLowerCase() === p.title.toLowerCase()) || null;
          } catch (e) {}
          const card = hit
            ? slim(hit, media)
            : { id: "c" + i, mt: media, d: "", t: p.title, y: "", r: "", p: null, b: null, o: clip(p.note || "", 220) };
          if (p.poster) {
            card.p = p.poster;
            card.b = p.poster;
          }
          if (p.date) {
            card.d = p.date;
            card.y = p.date.slice(0, 4);
          }
          return card;
        })
      )
    ).filter(Boolean);
    return out.sort((a, b) => (a.d ? 0 : 1) - (b.d ? 0 : 1) || String(a.d).localeCompare(String(b.d)));
  }
  // Coming Soon: titles releasing from today onward, merged from one or more TMDB queries
  if (def.upcoming) {
    const today = new Date().toISOString().slice(0, 10);
    const field = def.release ? "release_date" : media === "tv" ? "first_air_date" : "primary_release_date";
    const variants = def.variants && def.variants.length ? def.variants : [""];
    const pages = await Promise.all(
      variants.map((v) =>
        tmdb(
          env,
          `/discover/${MEDIA[media].path}`,
          `sort_by=popularity.desc&${field}.gte=${today}` +
            (media === "movie" ? "&include_adult=false" : "") +
            v
        ).catch(() => ({ results: [] }))
      )
    );
    const seen = new Set();
    const merged = [];
    for (const p of pages) {
      for (const m of p.results || []) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          merged.push(m);
        }
      }
    }
    merged.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return slimList(merged, media).sort((a, b) => String(a.d).localeCompare(String(b.d)));
  }
  // On Netflix: titles TMDB/JustWatch list as streaming on Netflix (provider 8). Trailers and details only.
  if (def.netflix) {
    const regions = [...new Set([NETFLIX_REGION, "US"])];
    const today = new Date().toISOString().slice(0, 10);
    const ago = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const field = media === "tv" ? "first_air_date" : "primary_release_date";
    for (let i = 0; i < regions.length; i++) {
      const rg = regions[i];
      const q =
        `${baseParams(media, def.votes || 20)}&with_watch_providers=8&watch_region=${rg}&with_watch_monetization_types=flatrate` +
        (def.extra || "") +
        (def.fresh ? `&${field}.gte=${ago}&${field}.lte=${today}` : "");
      const d = await tmdb(env, `/discover/${MEDIA[media].path}`, q).catch(() => ({ results: [] }));
      const list = slimList(d.results, media);
      if (list.length >= 6 || i === regions.length - 1) return list;
    }
  }
  let data;
  if (def.faith) {
    const ids = await getFaithKeywordIds(env);
    if (!ids.length) return [];
    data = await tmdb(
      env,
      `/discover/${MEDIA[media].path}`,
      `${baseParams(media)}&with_keywords=${encodeURIComponent(ids.join("|"))}`
    );
  } else {
    data = await tmdb(env, def.path, def.params);
  }
  return slimList(data.results, media);
}

// Every streaming service that carries the title anywhere in the world, grouped by type.
// Result: [{ id, n: name, l: logo, k: "stream"|"free"|"rent"|"buy", c: ["NG", "US", ...] }]
function buildProviders(all) {
  const kinds = [["flatrate", "stream"], ["free", "free"], ["ads", "free"], ["rent", "rent"], ["buy", "buy"]];
  const map = new Map();
  for (const cc of Object.keys(all || {})) {
    const w = all[cc] || {};
    for (const [field, kind] of kinds) {
      for (const p of w[field] || []) {
        const key = kind + ":" + p.provider_id;
        let e = map.get(key);
        if (!e) {
          e = { id: p.provider_id, n: p.provider_name, l: p.logo_path || null, k: kind, c: [] };
          map.set(key, e);
        }
        if (!e.c.includes(cc)) e.c.push(cc);
      }
    }
  }
  const out = [];
  for (const kind of ["stream", "free", "rent", "buy"]) {
    out.push(
      ...[...map.values()]
        .filter((e) => e.k === kind)
        .sort((x, y) => y.c.length - x.c.length)
        .slice(0, 24)
    );
  }
  return out;
}

async function getTitleApi(env, media, id) {
  const tv = media === "tv";
  const m = await tmdb(
    env,
    `/${MEDIA[media].path}/${id}`,
    (tv
      ? "append_to_response=videos,watch/providers,credits,content_ratings,images,recommendations"
      : "append_to_response=videos,watch/providers,credits,release_dates,images,recommendations") +
      "&include_image_language=en,null"
  );
  const uniq = (arr) => [...new Set(arr)];
  const crew = (m.credits && m.credits.crew) || [];
  const by = tv
    ? uniq((m.created_by || []).map((c) => c.name)).slice(0, 3)
    : uniq(crew.filter((c) => c.job === "Director").map((c) => c.name)).slice(0, 2);
  const logos = ((m.images && m.images.logos) || []).filter((l) => l.file_path && !/\.svg$/i.test(l.file_path));
  const logo = logos.find((l) => l.iso_639_1 === "en") || logos[0] || null;
  const ys = (m.first_air_date || "").slice(0, 4);
  const ye = (m.last_air_date || "").slice(0, 4);
  const ended = m.status === "Ended" || m.status === "Canceled";
  const releaseInfo = tv
    ? ys
      ? ended
        ? ye && ye !== ys
          ? `${ys}-${ye}`
          : ys
        : `${ys}-Present`
      : ""
    : dateOf(m);
  const originCountry = tv
    ? (m.origin_country || [])[0] || ""
    : ((m.production_countries || [])[0] || {}).iso_3166_1 || "";
  return {
    mt: media,
    id: m.id,
    t: titleOf(m),
    y: yearOf(m) === "N/A" ? "" : yearOf(m),
    r: m.vote_average ? m.vote_average.toFixed(1) : "",
    rt: tv ? (m.episode_run_time && m.episode_run_time[0]) || 0 : m.runtime || 0,
    d: dateOf(m),
    cert: pickCertification(m, DEFAULT_REGION, media),
    g: (m.genres || []).slice(0, 4).map((g) => g.name),
    tag: m.tagline || "",
    o: m.overview || "",
    p: m.poster_path,
    b: m.backdrop_path,
    lg: logo ? logo.file_path : null,
    trailer: pickTrailerKey(m),
    // worldwide availability (no country picker needed)
    wp: buildProviders(m["watch/providers"] && m["watch/providers"].results),
    wl: `https://www.themoviedb.org/${media}/${m.id}/watch`,
    cast: ((m.credits && m.credits.cast) || [])
      .slice(0, 10)
      .map((c) => ({ n: c.name, c: clip(c.character || "", 40), p: c.profile_path || null })),
    by,
    byLabel: tv ? "Created by" : "Directed by",
    seasons: tv
      ? (m.seasons || [])
          .filter((s) => s.season_number > 0)
          .map((s) => ({ n: s.season_number, e: s.episode_count || 0, y: (s.air_date || "").slice(0, 4) }))
      : [],
    status: m.status || "",
    ri: releaseInfo,
    oc: originCountry,
    ol: (m.original_language || "").toUpperCase(),
    net: tv ? (m.networks || []).slice(0, 2).map((n) => n.name) : [],
    rec: slimList((m.recommendations && m.recommendations.results) || [], media).slice(0, 12),
  };
}

// Episodes of one season (cards with S1 E1, title, summary, runtime, rating, air date)
async function getSeasonApi(env, id, n) {
  const s = await tmdb(env, `/tv/${id}/season/${n}`, "");
  return (s.episodes || []).map((e) => ({
    n: e.episode_number,
    t: e.name || `Episode ${e.episode_number}`,
    o: clip(e.overview || "", 160),
    rt: e.runtime || 0,
    d: e.air_date || "",
    r: e.vote_average ? e.vote_average.toFixed(1) : "",
    s: e.still_path || null,
  }));
}

// Title artwork (the stylised logo shown on the hero and the details page)
async function getLogoApi(env, media, id) {
  const d = await tmdb(env, `/${MEDIA[media].path}/${id}/images`, "include_image_language=en,null");
  const logos = (d.logos || []).filter((l) => l.file_path && !/\.svg$/i.test(l.file_path));
  const pick = logos.find((l) => l.iso_639_1 === "en") || logos[0] || null;
  return { l: pick ? pick.file_path : null };
}

function curatedTitle(picks, i) {
  const p = picks[i];
  if (!p) return null;
  const img = p.poster || null;
  return {
    mt: p.media === "tv" ? "tv" : "movie",
    id: "c" + i,
    d: p.date || "",
    t: p.title,
    y: p.date ? p.date.slice(0, 4) : "",
    r: "",
    rt: 0,
    cert: "",
    g: [],
    tag: "",
    o: p.note || "Details coming soon.",
    p: img,
    b: img,
    trailer: /^[\w-]{6,20}$/.test(p.trailer || "") ? p.trailer : null,
    lg: null,
    wp: [],
    wl: "",
    cast: [],
    by: [],
    byLabel: "Directed by",
    seasons: [],
    status: "",
    ri: p.date || "",
    oc: "",
    ol: "",
    net: [],
    rec: [],
  };
}
// ============================================================================
// 12b. NUVIO PLUGIN RUNTIME, STREAM DISCOVERY & CORS PROXY
// ============================================================================
async function getPluginsConfig(env) {
  if (!env.BOT_USERS) return { globalEnabled: true, groupByRepo: false, repos: [] };
  try {
    const raw = await env.BOT_USERS.get("cfg:plugins_v2");
    if (raw) return JSON.parse(raw);
    // Migrate legacy cfg:plugins if present
    const legacy = await env.BOT_USERS.get("cfg:plugins");
    if (legacy) {
      const arr = JSON.parse(legacy);
      return {

        globalEnabled: true,
        groupByRepo: false,
        repos: Array.isArray(arr) ? arr.map(p => ({ ...p, enabled: true })) : [],
      };
    }
  } catch (e) {}
  return { globalEnabled: true, groupByRepo: false, repos: [] };
}
globalThis.__fetchPluginStreams = fetchPluginStreams;

// ---- Stream discovery fallback: every scraper runs at the same time, results are cached and time-boxed ----
// (If globalThis.__fastStreams exists, e.g. your faststream.js on Render, it is used first and this is skipped.)
const STREAM_TTL_MS = 10 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 1000;
const CODE_TTL_MS = 30 * 60 * 1000;
const STREAM_CACHE = new Map();
const STREAM_JOBS = new Map();
const MANIFEST_CACHE = new Map();
const SCRIPT_CACHE = new Map();

function cacheSetStreams(key, list) {
  capSet(STREAM_CACHE, key, { at: Date.now(), list }, 100);
}

// Plugin repositories live ONLY in cfg:plugins. (Older versions also read cfg:addons, which is
// where the catalog add-ons live; that mixing made removed items "come back".)
async function getPluginRepos(env) {
  if (!env.BOT_USERS) return [];
  const read = async (k) => {
    try {
      const raw = await env.BOT_USERS.get(k);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };
  let list = await read("cfg:plugins");
  if (list === null) list = await read("cfg:addons"); // legacy, only when cfg:plugins never existed
  if (list && !Array.isArray(list)) list = list.repos || list.addons || [];
  return (Array.isArray(list) ? list : [])
    .map((p) => {
      const url = p && (p.url || p.transportUrl);
      return url ? { ...p, url, id: p.id || "pl_" + fnv(String(url)) } : null;
    })
    .filter(Boolean);
}

// ============================================================================
// MULTI-FORMAT PLUGINS: Nuvio repositories (JS scrapers) + Stremio stream add-ons (HTTP)
// ============================================================================
function manifestBase(url) {
  return String(url || "").replace(/[?#].*$/, "").replace(/\/manifest\.json$/i, "").replace(/\/+$/, "");
}
function stremioHasStream(m) {
  const r = m && Array.isArray(m.resources) ? m.resources : [];
  return r.some((x) => (typeof x === "string" ? x : x && x.name) === "stream");
}
function looksStremio(m) {
  return !!(m && typeof m === "object" && !Array.isArray(m) && m.id && m.name && Array.isArray(m.resources));
}
function hasScrapers(m, url) {
  const raw = m && (m.scrapers || m.plugins || m.providers);
  return Array.isArray(raw) && scraperList(m, url).length > 0;
}
const IDS_MEMO = new Map();
async function streamVideoIds(env, mediaType, tmdbId, season, episode) {
  const ids = [];
  const suffix = mediaType === "tv" ? ":" + season + ":" + episode : "";
  let imdb = IDS_MEMO.get(mediaType + tmdbId);
  if (imdb === undefined) {
    imdb = await imdbFor(env, mediaType, tmdbId);
    capSet(IDS_MEMO, mediaType + tmdbId, imdb, 100);
  }
  if (imdb) ids.push(imdb + suffix);
  ids.push("tmdb:" + tmdbId + suffix);
  return ids;
}
function qualityOf(text) {
  const t = String(text || "");
  if (/2160p|\b4k\b|\buhd\b/i.test(t)) return "4K";
  const m = /(1080|720|480|360)p/i.exec(t);
  return m ? m[1] + "p" : "";
}
function normStremio(repo, x) {
  if (!x || typeof x !== "object") return null;
  let url = x.url || "";
  const bh = x.behaviorHints || {};
  const label = [x.name, x.title, x.description, bh.filename].filter(Boolean).join(" ");
  const first = String(x.title || x.description || x.name || bh.filename || "Stream").split("\n")[0].trim();
  let tor = false;
  if (!/^https?:\/\//i.test(url)) {
    // a torrent result (no debrid needed): kept as a magnet link so it can be opened in a torrent app, never played in the browser
    const ih = /^[a-f0-9]{40}$/i.test(String(x.infoHash || "")) ? String(x.infoHash).toLowerCase() : "";
    if (/^magnet:\?/i.test(url)) tor = true;
    else if (ih) {
      const trs = (Array.isArray(x.sources) ? x.sources : []).map((t) => String(t)).filter((t) => /^tracker:/i.test(t)).slice(0, 6).map((t) => "&tr=" + encodeURIComponent(t.replace(/^tracker:/i, "")));
      url = "magnet:?xt=urn:btih:" + ih + "&dn=" + encodeURIComponent(String(bh.filename || first).slice(0, 90)) + trs.join("");
      tor = true;
    } else return null;
  }
  const out = { title: first.slice(0, 120), url, quality: qualityOf(label), provider: repo.name || "Stremio" };
  if (tor) { out.torrent = true; const sm0 = /(?:👤|seeders?:?)\s*(\d+)/i.exec(label); out.seeders = Number(x.seeders) || (sm0 ? Number(sm0[1]) : 0); }
  if (bh.videoSize) out.size = bh.videoSize;
  else { const sm = /(\d+(?:\.\d+)?)\s?(GB|GiB|MB|MiB)/i.exec(label); if (sm) out.size = sm[1] + " " + sm[2].toUpperCase().replace("IB", "B"); }
  if (bh.notWebReady) out.notWebReady = true;
  const ph = bh.proxyHeaders && bh.proxyHeaders.request;
  if (ph && typeof ph === "object") { const hc = relayHdrClean(ph); if (hc) out.headers = JSON.parse(hc); }
  return out;
}
async function stremioStreams(repo, env, mediaType, tmdbId, season, episode, timeoutMs) {
  const base = repo.base || manifestBase(repo.url);
  const sig = AbortSignal.timeout(timeoutMs || 9000);          // ONE deadline for this provider, however many ids are tried
  const ids = await streamVideoIds(env, mediaType, tmdbId, season, episode);
  for (const vid of ids) {
    if (sig.aborted) break;
    try {
      const r = await fetch(base + "/stream/" + (mediaType === "tv" ? "series" : "movie") + "/" + encodeURIComponent(vid).replace(/%3A/g, ":") + ".json", {
        headers: { "user-agent": "BoaCinema/1.0" },
        signal: sig,
      });
      if (!r.ok) continue;
      const j = await r.json();
      let list = (Array.isArray(j.streams) ? j.streams : []).map((x) => normStremio(repo, x)).filter(Boolean);
      // keep the answer small: at most the 8 best-seeded torrent results per add-on
      if (list.some((x) => x.torrent)) list = list.filter((x) => !x.torrent).concat(list.filter((x) => x.torrent).sort((a, b) => (b.seeders || 0) - (a.seeders || 0)).slice(0, 8));
      if (list.length) return list;
    } catch (e) {}
  }
  return [];
}
async function stremioOnly(env, mediaType, tmdbId, season, episode) {
  const repos = (await getPluginRepos(env)).filter((r) => r.enabled !== false && r.kind === "stremio" && !(r.disabled || []).includes("stremio"));
  const lists = await Promise.all(repos.map((r) => stremioStreams(r, env, mediaType, tmdbId, season, episode, providerMs(env)).catch(() => [])));
  return lists.flat();
}

async function loadManifest(url, timeoutMs, fresh) {
  const hit = MANIFEST_CACHE.get(url);
  if (!fresh && hit && Date.now() - hit.at < CODE_TTL_MS) return hit.m;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 8000), headers: { "user-agent": "BoaCinema/1.0" } });
  if (!r.ok) throw new Error("manifest " + r.status);
  const m = await r.json();
  capSet(MANIFEST_CACHE, url, { at: Date.now(), m }, 40);
  return m;
}

function scraperList(manifest, manifestUrl) {
  const items = (manifest && (manifest.scrapers || manifest.plugins || manifest.providers)) || [];
  const base = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
  const abs = (u) => (/^https?:\/\//i.test(u) ? u : base + String(u).replace(/^\.?\//, ""));
  return items.map((s) => {
    const raw = s.url || s.scriptUrl || s.filename || "";
    return { ...s, url: raw ? abs(raw) : "" };
  });
}

function compileScraper(code, timeoutMs) {
  const moduleObj = { exports: {} };
  const timedFetch = (input, init) => {
    const o = init || {};
    if (o.signal) return fetch(input, o);
    return fetch(input, Object.assign({}, o, { signal: AbortSignal.timeout(timeoutMs) }));
  };
  const mockRequire = (mod) => (mod === "axios" ? timedFetch : {});
  const fn = new Function("module", "exports", "require", "moduleObj", "fetch", "console", code);
  fn(moduleObj, moduleObj.exports, mockRequire, moduleObj, timedFetch, console);
  const exp = moduleObj.exports || {};
  const g = exp.getStreams || exp.getstreams || (exp.default && (exp.default.getStreams || exp.default.getstreams));
  return typeof g === "function" ? g : null;
}

async function loadScraperFn(url, timeoutMs, fresh) {
  const hit = SCRIPT_CACHE.get(url);
  if (!fresh && hit && Date.now() - hit.at < CODE_TTL_MS) return hit.fn;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 12000) });
  if (!r.ok) throw new Error("script " + r.status);
  const fn = compileScraper(await r.text(), 9000);
  if (!fn) throw new Error("no getStreams function in that script");
  capSet(SCRIPT_CACHE, url, { at: Date.now(), fn }, 100);
  return fn;
}

function withTimeout(p, ms, label) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label + " timed out")), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

// ---- Progressive stream engine -------------------------------------------------------------------------
// Every provider runs in parallel with its own hard timeout and drops its results into a shared "job" the moment they
// arrive. Clients read the job as it fills (long-poll), so the first playable stream shows up immediately and slower
// providers are merged in later. Finished lists are cached in the Edge Cache API (caches.default) with stale-while-
// revalidate, never in KV. Nothing here reads or writes admin state beyond one cached config read at job start.
const SC_FRESH_MS = 90 * 1000;       // served as-is
let STREAM_EPOCH = 0;                // bumped when plugins change, so NEW lookups skip older cached lists (running jobs are untouched)
function providerMs(env) { return Math.min(Math.max(Number(env.PROVIDER_TIMEOUT_MS) || 5000, 1500), 12000); }
function newJob() { return { bag: [], seen: new Set(), ws: [], fin: false, done: Promise.resolve() }; }
function jobWake(job) { const w = job.ws; job.ws = []; for (const f of w) f(); }
function jobPush(job, list, needUrl, prov) {
  let n = 0;
  for (const st of list || []) {
    if (!st || (needUrl && !st.url)) continue;
    const k = String(st.url || st.title || "");
    if (!k || job.seen.has(k)) continue;
    job.seen.add(k);
    job.bag.push(prov ? { ...st, provider: prov } : st);
    n++;
  }
  if (n) jobWake(job);
  return n;
}
// resolves when the job has more than `since` items, has finished, or `ms` passed (no timer is left behind)
function jobWait(job, since, ms) {
  if (job.fin || job.bag.length > since) return Promise.resolve();
  return new Promise((res) => {
    let t;
    const f = () => { clearTimeout(t); res(); };
    job.ws.push(f);
    t = setTimeout(() => { const i = job.ws.indexOf(f); if (i > -1) job.ws.splice(i, 1); res(); }, ms);
  });
}
function limiter(n) {
  let act = 0;
  const q = [];
  const next = () => {
    while (act < n && q.length) {
      const it = q.shift();
      act++;
      Promise.resolve().then(it.f).catch(() => {}).finally(() => { act--; it.r(); next(); });
    }
  };
  return (f) => new Promise((r) => { q.push({ f, r }); next(); });
}
const scReq = (key) => new Request("https://boa-cache.internal/streams/" + encodeURIComponent(key), { method: "GET" });
async function edgeGet(key) {
  try {
    if (!globalThis.caches || !caches.default) return null;
    const r = await caches.default.match(scReq(key));
    if (!r) return null;
    const at = Number(r.headers.get("x-boa-at")) || 0;
    const list = await r.json();
    return Array.isArray(list) && (list.length || Date.now() - at < EMPTY_TTL_MS) ? { list, at } : null;
  } catch (e) { return null; }
}
async function edgePut(key, list) {
  try {
    if (!globalThis.caches || !caches.default || JSON.stringify(list).length > 400000) return;
    // "nothing found" is also kept, but only for a few seconds, so a struggling backend isn't asked again by every viewer
    await caches.default.put(scReq(key), new Response(JSON.stringify(list), {
      headers: { "content-type": "application/json", "cache-control": list.length ? "public, max-age=" + Math.round(STREAM_TTL_MS / 1000) + ", stale-while-revalidate=120" : "public, max-age=" + Math.round(EMPTY_TTL_MS / 1000), "x-boa-at": String(Date.now()) },
    }));
  } catch (e) {}
}
// In-flight marker in the edge cache (shared by every isolate in this data center): "someone is already asking the backend for this title".
// Cache API only, never KV. It expires by itself after LOCK_TTL seconds.
const LOCK_TTL = 20;
const lockReq = (key) => scReq(key + "|lock");
async function lockPresent(key) {
  try { return !!(globalThis.caches && caches.default && (await caches.default.match(lockReq(key)))); } catch (e) { return false; }
}
async function lockPut(key) {
  try { if (globalThis.caches && caches.default) await caches.default.put(lockReq(key), new Response("1", { headers: { "cache-control": "public, max-age=" + LOCK_TTL } })); } catch (e) {}
}
async function lockDrop(key) {
  try { if (globalThis.caches && caches.default) await caches.default.delete(lockReq(key)); } catch (e) {}
}
// Another isolate is already fetching this title: wait (up to ~8 s) for its finished list to appear in the edge cache instead of asking the backend again.
async function waitPeer(job, key) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 700));
    const eg = await edgeGet(key);
    if (eg) { jobPush(job, eg.list, false); return true; }
    if (!(await lockPresent(key))) return false;           // the other request ended without a result: ask the backend ourselves
  }
  return false;
}

async function runScrapers(job, env, tmdbId, mediaType, season, episode) {
  const perScraper = Math.min(Number(env.SCRAPER_TIMEOUT_MS) || 4000, 4000);
  const per = providerMs(env);
  const only = String(env.ONLY_SCRAPERS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  const repos = (await getPluginRepos(env)).filter((r) => r.enabled !== false);
  const lim = limiter(10), all = [];
  await Promise.all(
    repos.map(async (repo) => {
      if (repo.kind === "stremio") {
        if ((repo.disabled || []).includes("stremio")) return;
        all.push(lim(async () => {
          const res = await stremioStreams(repo, env, mediaType, tmdbId, season, episode, per).catch(() => []);
          jobPush(job, res, false);
        }));
        return;
      }
      let manifest;
      try { manifest = await loadManifest(repo.url, 6000); } catch (err) { return; }     // a slow manifest only delays its own repository
      const off = new Set((repo.disabled || []).map(String));
      for (const sc of scraperList(manifest, repo.url)) {
        const sid = String(sc.id || sc.name || "");
        const label = sc.name || sc.id || sc.url;
        if (sc.enabled === false || !sc.url || off.has(sid)) continue;
        if (only.length && !only.some((o) => String(sc.name || sc.id).toLowerCase().includes(o))) continue;
        const types = sc.supportedTypes || sc.types;
        if (Array.isArray(types) && types.length && !types.includes(mediaType)) continue;
        all.push(lim(async () => {
          try {
            const fn = await loadScraperFn(sc.url, 4000);
            const res = await withTimeout(Promise.resolve().then(() => fn(String(tmdbId), mediaType, season, episode)), perScraper, label);
            if (Array.isArray(res)) jobPush(job, res, false, sc.name || sc.id);
          } catch (err) {}
        }));
      }
    })
  );
  await Promise.all(all);
}
async function runFast(job, env, tmdbId, mediaType, season, episode) {
  const tasks = [
    withTimeout(Promise.resolve(globalThis.__fastStreams(env, tmdbId, mediaType, season, episode)), Number(env.FAST_TIMEOUT_MS) || 15000, "fast")
      .then((l) => { jobPush(job, Array.isArray(l) ? l : [], true); }).catch(() => {}),
  ];
  const repos = (await getPluginRepos(env)).filter((r) => r.enabled !== false && r.kind === "stremio" && !(r.disabled || []).includes("stremio"));
  const per = providerMs(env);
  for (const r of repos) tasks.push(stremioStreams(r, env, mediaType, tmdbId, season, episode, per).then((l) => { jobPush(job, l, true); }).catch(() => {}));
  await Promise.all(tasks);
}
async function runBackend(job, env, tmdbId, mediaType, season, episode) {
  try {
    const r = await fetch(
      env.STREAM_BACKEND.replace(/\/+$/, "") + "/api/plugin-streams?type=" + encodeURIComponent(mediaType) + "&id=" + encodeURIComponent(tmdbId) + "&s=" + season + "&e=" + episode,
      { headers: { "x-stream-key": env.STREAM_KEY || "" }, signal: AbortSignal.timeout(Number(env.BACKEND_TIMEOUT_MS) || 45000) }
    );
    const list = r.ok ? await r.json() : [];
    if (Array.isArray(list)) jobPush(job, list, false);
  } catch (err) {}
}
function startJob(env, ctx, key, tmdbId, mediaType, season, episode, follow) {
  const job = newJob();
  STREAM_JOBS.set(key, job);
  const run = env.STREAM_BACKEND ? runBackend : globalThis.__fastStreams ? runFast : runScrapers;
  const go = async () => {
    if (env.STREAM_BACKEND) {
      if (follow && (await waitPeer(job, key))) return;      // served from the edge: the backend is not called at all
      await lockPut(key);
    }
    await run(job, env, tmdbId, mediaType, season, episode);
  };
  job.done = withTimeout(Promise.resolve().then(go), (Number(env.STREAM_JOB_MS) || 30000) + (follow ? 8000 : 0), "job")
    .catch(() => {})
    .then(async () => {
      job.fin = true;
      jobWake(job);
      STREAM_JOBS.delete(key);
      cacheSetStreams(key, job.bag.slice());
      await edgePut(key, job.bag);
      if (env.STREAM_BACKEND) await lockDrop(key);
    });
  try { if (ctx && ctx.waitUntil) ctx.waitUntil(job.done); } catch (e) {}      // keeps running after the first response is sent
  return job;
}
// Returns a job-like object { bag, fin, done, ws }. Cached lists come back finished; stale ones are refreshed in the background.
async function streamsFor(env, ctx, tmdbId, mediaType, season, episode, fresh) {
  const s = Number(season) || 1, e = Number(episode) || 1;
  const key = [STREAM_EPOCH, mediaType, tmdbId, mediaType === "tv" ? s : 0, mediaType === "tv" ? e : 0].join(":");
  const fin = (list) => { const j = newJob(); j.bag = list; j.fin = true; return j; };
  const now = Date.now();
  let hit = null;
  const mem = STREAM_CACHE.get(key);
  if (mem && (mem.list.length || !fresh) && now - mem.at < (mem.list.length ? STREAM_TTL_MS : EMPTY_TTL_MS)) hit = mem;
  if (!hit && !fresh && !STREAM_JOBS.get(key)) { const eg = await edgeGet(key); if (eg) hit = { at: eg.at, list: eg.list }; }
  if (hit && !fresh) {
    if (hit.list.length && now - hit.at > SC_FRESH_MS && !STREAM_JOBS.get(key)) startJob(env, ctx, key, tmdbId, mediaType, s, e);   // stale-while-revalidate
    return fin(hit.list);
  }
  // Already running in this isolate: join it. Otherwise, if another isolate in this data center is already asking the backend, follow it.
  if (STREAM_JOBS.get(key)) return STREAM_JOBS.get(key);
  const follow = !!env.STREAM_BACKEND && !fresh && (await lockPresent(key));
  return STREAM_JOBS.get(key) || startJob(env, ctx, key, tmdbId, mediaType, s, e, follow);
}
async function fetchPluginStreams(env, tmdbId, mediaType, season = 1, episode = 1, fresh = false, ctx) {
  const job = await streamsFor(env, ctx, tmdbId, mediaType, season, episode, fresh);
  if (!job.fin) {
    let timer;
    await Promise.race([job.done, new Promise((r) => { timer = setTimeout(r, Number(env.STREAM_BUDGET_MS) || 10000); })]);
    clearTimeout(timer);
  }
  return job.bag.slice();
}

// Runs ONE provider for the admin "Test provider" button
async function testScraper(env, o) {
  const t0 = Date.now();
  const type = o.type === "tv" ? "tv" : "movie";
  if (!/^https:\/\//i.test(o.url || "")) return { ok: false, error: "This provider has no script link to test." };
  if (o.kind === "stremio") {
    try {
      const list = await stremioStreams({ base: manifestBase(o.url), name: "Stremio" }, env, type, String(o.id), Number(o.s) || 1, Number(o.e) || 1, 15000);
      return { ok: true, count: list.length, ms: Date.now() - t0, sample: list.slice(0, 5).map((x) => ({ title: x.title, quality: x.quality })) };
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: String((err && err.message) || err) };
    }
  }
  try {
    const fn = await loadScraperFn(o.url, 15000, true);
    const res = await withTimeout(
      Promise.resolve().then(() => fn(String(o.id), type, Number(o.s) || 1, Number(o.e) || 1)),
      Number(env.TEST_TIMEOUT_MS) || 20000,
      "Provider"
    );
    const list = Array.isArray(res) ? res : [];
    return {
      ok: true,
      count: list.length,
      ms: Date.now() - t0,
      sample: list.slice(0, 5).map((x) => ({
        title: String((x && (x.title || x.name)) || "Stream").slice(0, 90),
        quality: String((x && (x.quality || x.resolution)) || "").slice(0, 20),
      })),
    };
  } catch (err) {
    const msg = String((err && err.message) || err);
    return {
      ok: false,
      ms: Date.now() - t0,
      error: /code generation|eval/i.test(msg)
        ? "Cloudflare Workers block running provider code. Run this test on your Render server (set STREAM_BACKEND on the Worker)."
        : msg,
    };
  }
}

// Repositories + providers for the admin panel (reads the manifests)
async function providersPayload(env, fresh) {
  const saved = await getPluginRepos(env);
  const repos = [];
  const providers = [];
  await Promise.all(
    saved.map(async (repo, idx) => {
      const dis = new Set((repo.disabled || []).map(String));
      if (repo.kind === "stremio") {
        const base = repo.base || manifestBase(repo.url);
        repos[idx] = { id: repo.id, name: repo.name || "Stremio add-on", version: repo.version || "", url: repo.url, providerCount: 1, kind: "stremio", forced: !!repo.forced };
        providers[idx] = [{ id: "stremio", name: repo.name || "Stremio add-on", description: "Stremio stream endpoint", version: repo.version || "", types: "movie | tv", repoId: repo.id, repoName: repo.name, url: base + "/manifest.json", kind: "stremio", enabled: !dis.has("stremio") }];
        return;
      }
      try {
        const m = await loadManifest(repo.url, 8000, fresh);
        const items = scraperList(m, repo.url);
        const rname = m.name || repo.name || "Repository";
        repos[idx] = { id: repo.id, name: rname, version: m.version || "1.0.0", url: repo.url, providerCount: items.length, kind: "nuvio", forced: !!repo.forced };
        providers[idx] = items.map((p) => {
          const t = p.supportedTypes || p.types;
          const pid = String(p.id || p.name || "");
          return {
            id: pid,
            name: p.name || p.id || "Provider",
            description: p.description || "",
            version: p.version || "1.0.0",
            types: Array.isArray(t) ? t.join(" | ") : p.type || "movie | tv",
            repoId: repo.id,
            repoName: rname,
            url: p.url,
            enabled: !dis.has(pid),
          };
        });
      } catch (e) {
        repos[idx] = { id: repo.id, name: repo.name || "Repository", version: "", url: repo.url, providerCount: 0, error: "Couldn't load the manifest" };
        providers[idx] = [];
      }
    })
  );
  return { repos: repos.filter(Boolean), providers: [].concat(...providers.filter(Boolean)) };
}

// Clears Cloudflare's cached copies after an admin change, so every phone sees it right away
async function bustCache(url, paths) {
  try {
    if (typeof caches === "undefined" || !caches.default) return;
    await Promise.all(paths.map((p) => caches.default.delete(new Request(url.origin + p, { method: "GET" }))));
  } catch (e) {}
}
const bustRows = (url) => bustCache(url, ["/api/rows?type=movie", "/api/rows?type=tv"]);
const bustPicks = (url) =>
  bustCache(url, ["/api/row?type=movie&name=upcoming_boa", "/api/row?type=tv&name=upcoming_boa"]);

async function handleApi(url, env, request, ctx) {
  const send = (data, status = 200, cache) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": cache || (status === 200 ? "public, max-age=300" : "no-store"),
      },
    });
  const media = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  try {

    const path = url.pathname;
    if (path === "/api/plugin-streams" || path === "/api/plugin-test") {
      const keyOk =
        env.ALLOW_LOCAL_DEV === "1" ||
        (env.STREAM_KEY && request && request.headers.get("x-stream-key") === env.STREAM_KEY);
      if (!keyOk) return send({ error: "unauthorized" }, 401, "no-store");
      if (path === "/api/plugin-test") {
        const r = await testScraper(env, {
          url: url.searchParams.get("u") || "",
          type: url.searchParams.get("type") || "movie",
          id: url.searchParams.get("id") || "550",
          s: url.searchParams.get("s") || 1,
          e: url.searchParams.get("e") || 1,
          kind: url.searchParams.get("kind") || "",
        });
        return send(r, 200, "no-store");
      }
      const out = await fetchPluginStreams(
        env,
        url.searchParams.get("id") || "",
        url.searchParams.get("type") || "movie",
        Number(url.searchParams.get("s")) || 1,
        Number(url.searchParams.get("e")) || 1
      );
      return send(out, 200, "no-store");
    }
    if (path === "/api/streams") {
      const id = url.searchParams.get("id") || "";
      const s = url.searchParams.get("s") || "1";
      const e = url.searchParams.get("e") || "1";
      if (!/^\d{1,9}$/.test(id)) return send({ error: "bad id" }, 400);
      try {
        const fresh = !!url.searchParams.get("r") && url.searchParams.get("r") !== "0";
        if (url.searchParams.get("warm") === "1") {            // details page opened: start (or reuse) the lookup, answer at once
          const wj = await streamsFor(env, ctx, id, media, s, e, false);
          return send({ ok: true, n: wj.bag.length, done: wj.fin }, 200, "no-store");
        }
        if (url.searchParams.get("p") === "1") {               // progressive: whatever has arrived so far, long-polled
          const since = Number(url.searchParams.get("n")) || 0;
          const job = await streamsFor(env, ctx, id, media, s, e, fresh);
          await jobWait(job, since, 2500);
          return send({ streams: await signStreamSubs(env, job.bag.slice()), n: job.bag.length, done: job.fin }, 200, "no-store");
        }
        const streams = await fetchPluginStreams(env, id, media, s, e, fresh, ctx);
        return send(Array.isArray(streams) ? await signStreamSubs(env, streams) : [], 200, "no-store");
      } catch (err) {
        console.error("Plugin fetch error:", err.message);
        return send({ error: err.message }, 500);
      }
    }
    if (path === "/api/providers") {
      // owner only (kept for older panels; the new panel uses /api/admin/providers)
      if (request) {
        const who = await ownerCheck(request, env);
        if (!who.ok) return send({ error: "owner only" }, 403, "no-store");
      }
      return send(await providersPayload(env, url.searchParams.get("fresh") === "1"), 200, "no-store");
    }
    if (path === "/api/rows") {
      const base = ROW_ORDER[media].map((k) => ({ key: k, title: ROW_DEFS[media][k].title }));
      const extra = await importedRowList(env, media);
      // imported add-on rows go right after Trending and Boa Picks
      let mode = "builtin";
      try { if (env.BOT_USERS) mode = (await env.BOT_USERS.get("cfg:homemode")) || "builtin"; } catch (e) {}
      if (mode === "addons" && extra.length) return send(extra, 200, "no-store");
      base.splice(2, 0, ...extra);
      return send(base);
    }
    if (path === "/api/row") {
      const rows = await getRow(env, media, url.searchParams.get("name") || "");
      return rows ? send(rows) : send({ error: "not found" }, 404);
    }
    if (path === "/api/title" || path === "/api/movie") {
      const id = url.searchParams.get("id") || "";
      const cm = /^c(\d{1,2})$/.exec(id);
      if (cm) {
        const picked = curatedTitle(await getPicks(env), +cm[1]);
        return picked ? send(picked) : send({ error: "not found" }, 404);
      }
      if (!/^\d{1,9}$/.test(id)) return send({ error: "bad id" }, 400);
      return send(await getTitleApi(env, path === "/api/movie" ? "movie" : media, id));
    }
    if (path === "/api/season") {
      const id = url.searchParams.get("id") || "";
      const n = url.searchParams.get("n") || "";
      if (!/^\d{1,9}$/.test(id) || !/^\d{1,3}$/.test(n)) return send({ error: "bad id" }, 400);
      return send(await getSeasonApi(env, id, n));
    }
    if (path === "/api/logo") {
      const id = url.searchParams.get("id") || "";
      if (!/^\d{1,9}$/.test(id)) return send({ error: "bad id" }, 400);
      return send(await getLogoApi(env, media, id));
    }
    if (path === "/api/subs") {
      const mt = url.searchParams.get("type") === "tv" ? "tv" : "movie";
      const id = url.searchParams.get("id") || "";
      if (!/^\d{1,9}$/.test(id)) return send([], 200, "no-store");
      return send(await findSubs(env, mt, id, url.searchParams.get("s"), url.searchParams.get("e")), 200, "no-store");
    }
    if (path === "/api/ads/config") {
      const a = await getAds(env), ic = await integGet(env, "ads");
      return send({ on: !!((a.on || ic) && adTagFor(a, ic, "pre")), pre: a.pre, mid: a.mid, lock: a.lock, skip: a.skip, movie: a.movie, tv: a.tv, view: ic && ic.opts && ic.opts.viewgate === false ? 0 : (a.view == null ? 5 : a.view) }, 200, "no-store");
    }
    if (path === "/api/ads/vast") {
      const a = await getAds(env), ic = await integGet(env, "ads");
      const tag = adTagFor(a, ic, url.searchParams.get("kind") === "mid" ? "mid" : "pre");
      if (!(a.on || ic) || !tag) return send({ ad: null }, 200, "no-store");
      try { return send({ ad: await fetchVast(tag, request, 0) }, 200, "no-store"); }
      catch (e) { return send({ ad: null, why: String((e && e.message) || e).slice(0, 120) }, 200, "no-store"); }
    }
    if (path === "/api/relay-sign") {
      const u = url.searchParams.get("u") || "";
      if (!relayAllowed(u)) return send({ error: "bad link" }, 400, "no-store");
      return send({ u: await relaySign(env, u, relayHdrClean(url.searchParams.get("h") || "")) }, 200, "no-store");
    }
    if (path === "/api/relay-check") {
      const out = await relayCheck(request, url);
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } });
    }
    if (path === "/api/torrent-bridge") {
      const out = await bridgeResolve(env, String(url.searchParams.get("m") || ""));
      return send(out, 200, "no-store");
    }
    if (path === "/api/notices") {
      const act = sortNotices((await getNotices(env)).filter((x) => x.on)).map((x) => ({ id: x.id, t: x.title, b: x.body, p: x.pri }));
      const v = act.length ? fnv(JSON.stringify(act)) : "";
      return send({ v, n: act }, 200, "public, max-age=60");
    }
    if (path === "/api/notice") {
      let n = "", p = 0;
      try {
        if (env.BOT_USERS) { n = (await env.BOT_USERS.get("cfg:notice")) || ""; p = n && (await env.BOT_USERS.get("cfg:notice_pri")) === "1" ? 1 : 0; }
      } catch (e) {}
      return send({ n, p }, 200, "no-store");
    }
    if (path === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      if (q.length < 2) return send([]);
      const data = await tmdb(env, "/search/multi", `include_adult=false&query=${encodeURIComponent(q)}`);
      const found = (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv");
      return send(slimList(found).slice(0, 18));
    }
    return send({ error: "not found" }, 404);
  } catch (e) {
    return send({ error: "upstream" }, 502);
  }
}

// ============================================================================
// 14. BOA CINEMA: the Mini App page (Nuvio-style)
// ============================================================================

const APP_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="1b41a7e31a565725c622166c6dbd75c59cb3bdf2" content="1b41a7e31a565725c622166c6dbd75c59cb3bdf2" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0a0a0a">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Boa Cinema: Movies, Series and Coming Soon</title>
<meta name="description" content="Discover movies and series by Boa Entertainment: Nollywood, Hollywood, K-Drama, Bollywood, Netflix picks, trailers, where to watch and what is coming soon.">
<meta property="og:title" content="Boa Cinema">
<meta property="og:description" content="Discover movies and series: trailers, where to watch, Nollywood, Netflix picks and coming soon.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Boa Cinema">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<link rel="preconnect" href="https://image.tmdb.org" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>
:root{--accent-rgb:229,9,20;--on-accent:#fff;--bg:#0a0a0a;--card:#1b1b1d;--card2:#252528;--text:#fff;--muted:#a3a3a8;--line:#2b2b2e;--gold:#f5c518;--accent:var(--accent);--ok:#46d369;--sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
body{overflow-x:hidden}
button{font-family:inherit;cursor:pointer;color:inherit}
:focus-visible{outline:2px solid #fff;outline-offset:2px}
svg{display:block}
.sk{background:linear-gradient(90deg,#161618 25%,#222225 50%,#161618 75%);background-size:200% 100%;animation:sh 1.3s infinite linear}
@keyframes sh{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.sk{animation:none}*{scroll-behavior:auto!important}}

.view{display:none;min-height:100vh;padding-bottom:calc(var(--sab) + 110px)}
.view.on{display:block}

/* ---------- top switch (movies / series) ---------- */
#v-home{position:relative}
#brand{position:absolute;top:calc(var(--sat) + 12px);left:14px;z-index:7;height:38px;display:flex;align-items:center;background:none;border:0;padding:0;color:#fff;font-size:21px;font-weight:800;letter-spacing:-.5px;text-shadow:0 2px 10px rgba(0,0,0,.7)}
#brand b{color:var(--accent);font-weight:900}
#seg{position:absolute;top:calc(var(--sat) + 12px);right:62px;left:auto;transform:none;z-index:6;display:flex;padding:4px;border-radius:999px;background:rgba(20,20,22,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1)}
#bell{position:absolute;top:calc(var(--sat) + 12px);right:14px;z-index:7;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(20,20,22,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:#fff;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
#bell svg{width:19px;height:19px}
#bell .bdot{position:absolute;top:8px;right:9px;width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px #151517;display:none}
#bell.new .bdot{display:block}
#bell[aria-expanded="true"]{background:#fff;color:#000}
#npop{position:fixed;top:calc(var(--sat) + 60px);right:12px;width:min(92vw,360px);max-height:min(66vh,540px);z-index:55;background:rgba(18,18,20,.97);border:1px solid #2a2a2e;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.75);display:none;flex-direction:column;overflow:hidden;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
#npop.on{display:flex;animation:npIn .18s ease both}
#npop .nph{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;font-weight:800;font-size:15px;border-bottom:1px solid #26262a}
#npop .nph span{font-size:12px;font-weight:700;color:#a1a1aa}
#npop .npl{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:6px}
#npop .npi{display:block;width:100%;text-align:left;border:0;background:none;color:#fff;font:inherit;padding:10px 10px;border-radius:12px;cursor:pointer}
#npop .npi:hover,#npop .npi:focus-visible{background:#202024;outline:none}
#npop .npt{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;line-height:1.3}
#npop .npt i{flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:#52525b}
#npop .npt i.p1{background:#3b82f6}#npop .npt i.p2{background:#e50914}
#npop .npb{margin:5px 0 0 16px;color:#a1a1aa;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#npop .npi.open .npb{display:block;-webkit-line-clamp:unset;color:#d4d4d8}
#npop .npe{padding:22px 16px;text-align:center;color:#a1a1aa;font-size:14px}
#npop .npf{padding:10px 12px 12px;border-top:1px solid #26262a}
#npop .npf button{width:100%;border:0;border-radius:999px;padding:11px;font:inherit;font-weight:800;font-size:14px;background:#e50914;color:#fff;cursor:pointer}
@keyframes npIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#npop.on{animation:none}}
#seg button{border:0;background:none;color:#d4d4d8;font-size:13px;font-weight:700;padding:7px 16px;border-radius:999px}
#seg button.on{background:#fff;color:#000}

/* ---------- hero ---------- */
#hero{position:relative;height:min(64vh,620px);min-height:380px;overflow:hidden;background:#111}
.slide{position:absolute;inset:0;opacity:0;transition:opacity .6s ease;pointer-events:none}
.slide.on{opacity:1;pointer-events:auto}
.slide>img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 20%}
#hero.ready::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(10,10,10,.35) 0%,rgba(10,10,10,0) 28%,rgba(10,10,10,.55) 62%,var(--bg) 100%);pointer-events:none;z-index:1}
.hinfo{position:absolute;left:0;right:0;bottom:44px;z-index:2;padding:0 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}
.hlogo{max-width:72%;max-height:92px;object-fit:contain;filter:drop-shadow(0 2px 10px rgba(0,0,0,.6))}
.htitle{font-size:32px;font-weight:800;line-height:1.05;margin:0;letter-spacing:-.5px;text-shadow:0 2px 14px rgba(0,0,0,.7)}
.hmeta{font-size:15px;font-weight:600;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.8)}
.pillbtn{border:0;border-radius:999px;background:#fff;color:#000;font-size:16px;font-weight:700;padding:13px 34px}
.dots{position:absolute;left:0;right:0;bottom:16px;z-index:3;display:flex;justify-content:center;gap:9px}
.dot{width:10px;height:10px;border-radius:50%;border:0;padding:0;background:#fff;opacity:.95;transition:width .25s}
.dot.on{width:44px;border-radius:6px}
.dot:not(.on){opacity:.95}

/* ---------- category pills ---------- */
.pills{display:flex;gap:8px;overflow-x:auto;padding:4px 16px 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.pills::-webkit-scrollbar{display:none}
.pill{flex:0 0 auto;border:0;background:var(--card);color:#e4e4e7;border-radius:999px;padding:9px 16px;font-size:13px;font-weight:700;white-space:nowrap}
.pill.sel{background:#fff;color:#000}

/* ---------- categories dropdown (Netflix style) ---------- */
.catbar{display:flex;padding:4px 16px 2px}
.catbtn{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.08);color:#fff;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:700}
.catbtn svg{width:14px;height:14px}
#catmenu{position:fixed;inset:0;z-index:80;display:none;background:rgba(8,8,8,.95);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
#catmenu.open{display:block}
#catlist{position:absolute;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;align-items:center;padding:calc(var(--sat) + 56px) 20px calc(var(--sab) + 130px);text-align:center}
.catitem{border:0;background:none;color:#a3a3a8;font-size:20px;font-weight:600;padding:12px 16px;width:100%}
.catitem:active{color:#fff}
.catitem.first{color:#fff;font-size:22px;font-weight:800}
#catclose{position:absolute;left:50%;bottom:calc(var(--sab) + 30px);transform:translateX(-50%);width:58px;height:58px;border-radius:50%;border:0;background:#fff;color:#000;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.6)}
#catclose svg{width:26px;height:26px}
body.catopen{overflow:hidden}
body.catopen #nav{display:none}

/* ---------- rows and cards ---------- */
.row{margin:22px 0 6px}
.row h2{font-size:20px;font-weight:700;margin:0 16px 14px;letter-spacing:-.2px}
.strip{display:flex;gap:12px;overflow-x:auto;padding:0 16px;scroll-padding:0 16px;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.strip::-webkit-scrollbar{display:none}
.card{flex:0 0 31.5%;max-width:168px;min-width:108px;scroll-snap-align:start;background:none;border:0;padding:0;text-align:left;display:block}
.card.skc{pointer-events:none}
.poster{position:relative;aspect-ratio:2/3;border-radius:20px;overflow:hidden;background:var(--card)}
.poster img{width:100%;height:100%;object-fit:cover;display:block}
.card:active .poster{transform:scale(.97)}
.poster{transition:transform .15s ease}
.ct{font-size:14.5px;font-weight:600;margin:9px 2px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cy{font-size:12.5px;color:var(--muted);margin:0 2px;font-weight:500}
.badge{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;font-weight:800;letter-spacing:.4px;padding:3px 7px;border-radius:6px}
.ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:15px;font-weight:800;line-height:1.2;background:linear-gradient(160deg,#3a0d12,#161618 70%)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 10px;padding:0 14px}
.grid .card{max-width:none;min-width:0;width:100%}
.note{color:var(--muted);font-size:14px;padding:12px 16px;line-height:1.5}
.note.center{text-align:center;padding:60px 24px}
.retry{border:0;background:var(--card2);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700;margin-left:6px}
.vh{font-size:26px;font-weight:800;margin:0;padding:calc(var(--sat) + 18px) 16px 14px;letter-spacing:-.4px}

/* ---------- search ---------- */
.sbox{padding:0 14px 22px}
.vh.big{font-size:46px;letter-spacing:-1px;padding-top:calc(var(--sat) + 40px);padding-bottom:18px}
.dh{font-size:40px;font-weight:400;margin:14px 16px 18px;letter-spacing:-.8px}
.dsel{display:flex;gap:10px;overflow-x:auto;padding:0 16px;scrollbar-width:none}
.dsel::-webkit-scrollbar{display:none}
.dsel select{flex:0 0 auto;appearance:none;-webkit-appearance:none;border:0;border-radius:18px;background-color:var(--card);color:#fff;font:inherit;font-size:16px;font-weight:600;padding:15px 40px 15px 18px;outline:none;background-repeat:no-repeat;background-position:right 15px center;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='m5 9 7 7 7-7'/></svg>");max-width:72vw;text-overflow:ellipsis}
.dsub{color:var(--muted);font-size:16px;margin:18px 16px 16px}
.grid .ct{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:15.5px}
.nfb{position:absolute;top:7px;left:8px;color:var(--accent);font-size:22px;font-weight:800;line-height:1;font-family:Georgia,"Times New Roman",serif;text-shadow:0 1px 6px rgba(0,0,0,.8)}
.badge.soon{background:var(--accent);color:#fff;font-size:10px;margin:0}
#q{width:100%;border:0;border-radius:999px;background:var(--card);color:#fff;font:inherit;font-size:16px;padding:14px 20px;outline:none}
#q::placeholder{color:#7d7d83}
#q::-webkit-search-cancel-button{display:none}

/* ---------- bottom pill nav ---------- */
#nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--sab) + 14px);z-index:40;width:min(92vw,430px);display:flex;justify-content:space-between;gap:2px;padding:6px;border-radius:999px;background:rgba(34,34,36,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 30px rgba(0,0,0,.5)}
.ni{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 4px 8px;border:0;border-radius:999px;background:none;color:#a3a3a8;font-size:12px;font-weight:700}
.ni.on{background:rgba(255,255,255,.14);color:#fff}
.ni svg{width:26px;height:26px}
.av{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#ff7a8a,var(--accent));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;overflow:hidden}
.av img{width:100%;height:100%;object-fit:cover}
body.lock #nav{display:none}

/* ---------- details page ---------- */
#detail{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;overflow-x:hidden;display:none;-webkit-overflow-scrolling:touch}
#detail.open{display:block}
#dbar{position:fixed;top:0;left:0;right:0;z-index:65;display:none;align-items:center;justify-content:space-between;gap:10px;padding:calc(var(--sat) + 8px) 14px 12px;background:linear-gradient(to bottom,rgba(0,0,0,.7),rgba(0,0,0,0));transition:background .2s}
#dbar.show{display:flex}
#dbar.solid{background:var(--bg);box-shadow:0 1px 0 var(--line)}
.ib{width:42px;height:42px;border-radius:50%;border:0;background:rgba(30,30,32,.7);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.ib svg{width:22px;height:22px}
#dbt{flex:1;min-width:0;text-align:center;font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .2s}
#dbar.solid #dbt{opacity:1}
.dmedia{position:relative;aspect-ratio:4/5;max-height:74vh;width:100%;background:#111;overflow:hidden}
.dmedia>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top}
.dmedia::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(10,10,10,.1) 0%,rgba(10,10,10,0) 40%,var(--bg) 100%);pointer-events:none}
.dmedia.playing{aspect-ratio:16/9;max-height:none;margin-top:0;background:#000}
.dmedia.playing::after{display:none}
.dmedia iframe{position:absolute;inset:0;width:100%;height:100%;border:0;z-index:2}
.dinfo{position:relative;z-index:2;margin-top:-150px;padding:0 16px}
.dmedia.playing+.dinfo{margin-top:0;padding-top:calc(var(--sat) + 0px)}
.dtitle{font-size:34px;font-weight:800;line-height:1.05;margin:0 0 10px;letter-spacing:-.6px}
.dlogo{max-width:78%;max-height:100px;object-fit:contain;object-position:left bottom;margin:0 0 12px;display:block}
.dmeta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:#d4d4d8;font-size:14px;font-weight:600;margin-bottom:12px}
.cert{border:1.5px solid #8b8b90;border-radius:4px;padding:0 5px;font-size:12px;line-height:17px;color:#d4d4d8}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.chip{background:var(--card);border-radius:999px;padding:8px 15px;font-size:13.5px;font-weight:600;color:#e4e4e7}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}
.btn{border:0;border-radius:12px;padding:13px 20px;font-size:15px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.btn svg{width:18px;height:18px}
.btn.primary{background:#fff;color:#000}
.btn.ghost{background:#3a3a3e;color:#fff}
.btn.block{width:100%}
.soon{color:var(--ok);font-weight:700;font-size:14px;margin:0 0 12px}
.tag{color:var(--muted);font-style:italic;font-size:15px;margin:0 0 12px}
.ov{font-size:15px;line-height:1.6;color:#e4e4e7;margin:0}
.ov.clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.more{border:0;background:none;color:#fff;font-weight:700;font-size:14px;padding:6px 0}
.by{font-size:15px;color:#e4e4e7;margin:14px 0 0}
.by b{font-weight:700}
.sec{margin-top:30px}
.sec>h3{font-size:22px;font-weight:700;margin:0 16px 14px;letter-spacing:-.3px}
.sec .strip{padding-top:2px}
.cast{flex:0 0 84px;text-align:center}
.cast .cp{width:72px;height:72px;border-radius:50%;background:var(--card);margin:0 auto 8px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:800;color:#7d7d83;font-size:22px}
.cast .cp img{width:100%;height:100%;object-fit:cover}
.cast .cn{font-size:12.5px;font-weight:600;line-height:1.25}
.cast .cc{font-size:11.5px;color:var(--muted);line-height:1.25;margin-top:2px}

/* episodes */
.ep{flex:0 0 84%;max-width:360px;height:190px;border-radius:22px;overflow:hidden;position:relative;background:var(--card);border:1px solid var(--line);scroll-snap-align:start}
.ep>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ep::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(10,10,10,.35),rgba(10,10,10,.88) 62%)}
.ep .ei{position:absolute;inset:0;z-index:2;padding:14px 16px;display:flex;flex-direction:column}
.eb{align-self:flex-start;background:rgba(80,80,84,.85);border-radius:9px;padding:4px 10px;font-size:12.5px;font-weight:700}
.et{font-size:22px;font-weight:800;margin:8px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.3px}
.eo{font-size:14px;line-height:1.4;color:#d4d4d8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ef{margin-top:auto;display:flex;align-items:center;gap:12px;font-size:14px;color:#d4d4d8;font-weight:500}
.ef .r{color:var(--gold);font-weight:700}
.ef .d{margin-left:auto}

/* where to watch */
.wnote{color:var(--muted);font-size:13.5px;line-height:1.5;margin:0 16px 14px}
.wcta{margin:0 16px 6px}
.wgroup{margin:18px 0 0}
.wlabel{font-size:15px;font-weight:700;margin:0 16px 10px;color:#e4e4e7}
.prow{display:flex;gap:10px;overflow-x:auto;padding:0 16px 2px;scrollbar-width:none}
.prow::-webkit-scrollbar{display:none}
.prov{flex:0 0 auto;display:flex;align-items:center;gap:10px;background:var(--card);border:1.5px solid transparent;border-radius:16px;padding:8px 14px 8px 8px;text-align:left}
.prov.sel{border-color:#fff}
.prov.mine{background:#14301c}
.pl{width:40px;height:40px;border-radius:11px;overflow:hidden;background:var(--card2);flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:800}
.pl img{width:100%;height:100%;object-fit:cover}
.pn{font-size:14px;font-weight:700;line-height:1.2;max-width:130px}
.pc{font-size:12px;color:var(--muted);margin-top:1px}
.prov.mine .pc{color:var(--ok);font-weight:700}
.pdet{margin:12px 16px 0;background:var(--card);border-radius:18px;padding:14px}
.pdet .pt{font-size:14px;font-weight:700;margin-bottom:10px}
.cl{display:flex;flex-wrap:wrap;gap:7px}
.cc2{background:var(--card2);border-radius:999px;padding:6px 11px;font-size:12.5px;font-weight:600}
.cc2.me{background:#14301c;color:#9bf0b2}
.nostream{margin:0 16px;background:var(--card);border-radius:20px;padding:18px}
.nostream b{display:block;font-size:16px;margin-bottom:6px}
.nostream span{color:var(--muted);font-size:14px;line-height:1.5}

/* show details table */
.tbl{margin:0 16px}
.tr{display:flex;justify-content:space-between;gap:16px;padding:20px 0;border-bottom:1px solid var(--line);font-size:17px}
.tr:last-child{border-bottom:0}
.tr .k{color:#b9b9be;font-weight:600}
.tr .v{font-weight:600;text-align:right}
.credit{margin:26px 16px 0;font-size:12px;color:#808086;text-align:right}
.dbottom{height:calc(var(--sab) + 60px)}
.load{padding:120px 16px;color:var(--muted);text-align:center}

/* library and profile */
.me{display:flex;flex-direction:column;align-items:center;padding:calc(var(--sat) + 36px) 16px 8px;text-align:center}
.me .big{width:92px;height:92px;border-radius:50%;background:linear-gradient(135deg,#ff7a8a,var(--accent));display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:800;overflow:hidden}
.me .big img{width:100%;height:100%;object-fit:cover}
.me h2{margin:14px 0 2px;font-size:22px;font-weight:800}
.me p{margin:0;color:var(--muted);font-size:14px}
.list{margin:22px 16px 0;background:var(--card);border-radius:22px;overflow:hidden}
.li{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;border:0;background:none;padding:18px 18px;font-size:16px;font-weight:600;border-bottom:1px solid var(--line);text-align:left}
.li:last-child{border-bottom:0}
.li span{color:var(--muted);font-size:14px;font-weight:600}
.li.danger{color:#ff6b6b}

footer{margin-top:34px;padding:26px 16px 10px;border-top:1px solid var(--line);color:#8b8b90;font-size:11.5px;text-align:center;line-height:1.55}
footer .fl{font-size:14px;font-weight:800;color:#e4e4e7;letter-spacing:.3px}
footer a{color:var(--accent);font-weight:700;text-decoration:none}
footer p{max-width:94%;margin:8px auto 0}
.toast{position:fixed;left:50%;bottom:calc(var(--sab) + 100px);transform:translateX(-50%);background:#fff;color:#000;font-weight:700;font-size:14px;padding:10px 18px;border-radius:999px;z-index:1000001;opacity:0;pointer-events:none;transition:opacity .2s}
.toast.on{opacity:1}

/* ---------- site notice + owner panel ---------- */
.notice{display:none;margin:12px 16px 0;padding:12px 40px 12px 14px;border-radius:14px;background:linear-gradient(135deg,#3a0b10,#1b1b1d);border:1px solid rgba(var(--accent-rgb),.35);font-weight:600;line-height:1.45;position:relative}
.notice.on{display:block}
.notice button{position:absolute;right:6px;top:6px;width:30px;height:30px;border:0;background:none;color:#a3a3a8;font-size:22px;line-height:1}
#admin{position:fixed;inset:0;z-index:75;background:var(--bg);overflow-y:auto;overflow-x:hidden;display:none;-webkit-overflow-scrolling:touch;padding:calc(var(--sat) + 14px) 16px calc(var(--sab) + 60px)}
#admin.open{display:block}
.ahead{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.ahead h1{font-size:24px;margin:0;font-weight:800;letter-spacing:-.4px}
.acard{background:var(--card);border-radius:18px;padding:16px;margin:0 0 14px}
.acard h3{margin:0 0 10px;font-size:16px}
.acard p{margin:0 0 12px;color:var(--muted);font-size:14px;line-height:1.5}
.ainp{display:block;width:100%;background:#111;border:1px solid var(--line);border-radius:12px;color:#fff;font:inherit;font-size:16px;padding:12px 13px;margin:0 0 10px}
textarea.ainp{min-height:72px;resize:vertical}
.abtn{border:0;border-radius:999px;background:#fff;color:#000;font-weight:700;font-size:15px;padding:11px 20px;margin:0 8px 6px 0}
.abtn.alt{background:#2a2a2d;color:#fff}
.abtn.red{background:#3a1216;color:#ff8a93}
.arow{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--line)}
.arow.first{border-top:0}
.achk{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:15px}
.achk input{width:20px;height:20px;flex:0 0 auto}
.arow div{flex:1;min-width:0}
.arow b{display:block;font-size:15px}
.arow span{color:var(--muted);font-size:13px}
/* ---------- universal play button & stream modal ---------- */
.pplay{position:absolute;right:8px;bottom:8px;width:34px;height:34px;border-radius:50%;border:0;background:rgba(var(--accent-rgb),.92);color:var(--on-accent);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.6)}
.pplay svg{width:16px;height:16px;margin-left:2px}
#streammodal{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.92);display:none;flex-direction:column;padding:calc(var(--sat) + 14px) 16px calc(var(--sab) + 20px);overflow-y:auto}
#streammodal.open{display:flex}
.shead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.shead h2{margin:0;font-size:20px;font-weight:800}
.splayer{width:100%;aspect-ratio:16/9;background:#000;border-radius:16px;overflow:hidden;margin-bottom:16px;display:none}
.splayer video,.splayer iframe{width:100%;height:100%;border:0}

.srv{background:var(--card);border-radius:16px;padding:14px;margin-bottom:12px;border:1px solid #232328}
.srvtop{display:flex;align-items:center;gap:12px}
.srvdot{width:12px;height:12px;border-radius:50%;flex:none}
.srvtx{flex:1;min-width:0}
.srvtx b{display:block;font-size:15px;letter-spacing:.2px}
.srvtx span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
.srvact{display:flex;gap:8px;flex:none}
.splaybtn.vlc{background:#2a2a2e;color:#fff}
.splaybtn.vlcon{background:#ff8800;color:#000}
.srvhint{font-size:12px;color:#fca5a5;margin-top:10px;line-height:1.4}
.srvmore{background:none;border:0;color:#a1a1aa;font-size:12.5px;font-weight:700;margin-top:10px;padding:4px 0}
.srvalts{margin-top:8px;border-top:1px solid #2a2a2e;padding-top:8px}
.srvalt{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0}
.srvalt span{flex:1 1 100%;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.srvalt .splaybtn{padding:7px 14px;font-size:12px}
.srvalt .note{flex:1 1 100%}
.srvdisc{font-size:11.5px;color:#71717a;text-align:center;padding:14px 8px 6px;line-height:1.5}
.sitem{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card);border-radius:14px;padding:13px 15px;margin-bottom:10px}
.sitem b{display:block;font-size:15px}
.sitem span{font-size:12.5px;color:var(--muted)}
.splaybtn{border:0;border-radius:999px;background:#fff;color:#000;font-weight:800;font-size:13px;padding:9px 16px;flex:0 0 auto}
.sitem{box-sizing:border-box;width:100%;max-width:100%;overflow:hidden;align-items:center}
.sitem>div:first-child{flex:1 1 0;min-width:0;max-width:100%}
.sitem b,.sitem span,.sitem .note{display:block;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
.sitem>div:last-child{flex:0 0 auto;display:flex;align-items:center;gap:8px;margin-left:auto}
.sitem .splaybtn{margin-left:0!important;white-space:nowrap;flex:0 0 auto}
@media (max-width:360px){.sitem{padding:11px 12px;gap:8px}.sitem .splaybtn{padding:8px 12px}}
/* ---------- wide screens (website on laptop/tablet): keep the phone layout, centred ---------- */

.btn.disabled{background:#2a2a2e;color:#8a8a90}
.pplay.off{background:rgba(70,70,76,.92);color:#9a9aa0}
.ep.off{opacity:.45}
.prog{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.25)}
.prog i{display:block;height:100%;background:var(--accent)}
.xbtn{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:0;background:rgba(0,0,0,.8);color:#fff;font-size:18px;line-height:26px;padding:0;z-index:3}
.whoami{display:flex;align-items:center;gap:10px;margin:calc(var(--sat) + 14px) 16px 4px;background:#1c1c1f;border:1px solid #2a2a2e;color:#fff;border-radius:999px;padding:6px 16px 6px 6px;font-size:14px;font-weight:700}
.pav{width:96px;height:96px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#fff;position:relative}
.pav.sm{width:30px;height:30px;border-radius:50%;font-size:14px}
.pav.big{width:120px;height:120px;font-size:52px;margin:0 auto 18px}
.pav.add{background:#2a2a2e;color:#a1a1aa;font-size:44px}
.pav .pen{position:absolute;inset:0;border-radius:20px;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:30px}
#profiles{position:fixed;inset:0;z-index:70;background:#0b0b0c;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;overflow:auto;text-align:center}
#profiles.open{display:flex}
#profiles h1{font-size:26px;margin:0 0 26px;font-weight:800}
.pfgrid{display:flex;flex-wrap:wrap;gap:20px;justify-content:center;max-width:380px}
.who{background:none;border:0;color:#d4d4d8;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:14px;font-weight:600;width:100px}
.who.cur .pav{outline:3px solid #fff}
.pfbtn{margin-top:22px;padding:12px 26px;border-radius:12px;border:0;background:#fff;color:#000;font-size:15px;font-weight:700;min-width:200px}
.pfbtn.ghost{background:#2a2a2e;color:#fff;margin-top:10px}
.pfbtn.danger{background:#3b1215;color:#ff6b6b;margin-top:10px}
.pfin{max-width:260px;text-align:center;margin:0 auto}
.pfsw{display:flex;gap:10px;justify-content:center;margin-top:14px}
.sw{width:30px;height:30px;border-radius:50%;border:2px solid transparent;padding:0}
.sw.on{border-color:#fff}
.libbar{display:flex;gap:8px;overflow-x:auto;padding:0 16px 12px;scrollbar-width:none}
.atabs{display:flex;gap:8px;padding:0 16px 12px;position:sticky;top:0;z-index:5;background:var(--bg);overflow-x:auto;scrollbar-width:none}
.atab[aria-current=page]{background:#fff;color:#000;box-shadow:0 0 0 2px #e50914}
.atab:focus-visible,.ncard:focus-visible{outline:2px solid #fff;outline-offset:2px}
.asechead{display:flex;align-items:center;gap:10px;margin:0 0 12px}
.asechead h2{margin:0;font-size:20px;outline:0}
.asback{flex:none;width:auto;margin:0;padding:10px 14px}
.sbanner{margin:0 0 12px;padding:12px 14px;border-radius:14px;background:#14291c;border:1px solid #16a34a;color:#d1fae5;font-size:14px;line-height:1.4}
.sbanner.warn{background:#2b2108;border-color:#f59e0b;color:#fde68a}
.sbanner.err{background:#2a1215;border-color:#e50914;color:#fecaca}
.ncards{display:grid;gap:10px;margin:0 0 14px}
textarea.ainp{min-height:110px;resize:vertical}
.npri{display:flex;gap:6px;margin:0 0 10px}.npri button{flex:1;padding:10px 4px;border-radius:12px;border:1px solid var(--line);background:#111;color:#d4d4d8;font:inherit;font-size:13px;font-weight:700}
.npri button.on{background:#e50914;border-color:#e50914;color:#fff}
.nbadge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:999px;background:#27272a;color:#d4d4d8}
.nbadge.p2{background:#e50914;color:#fff}.nbadge.p1{background:#1e3a5f;color:#bfdbfe}.nbadge.p0{background:#27272a;color:#a1a1aa}
#nslide{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.88);display:none;align-items:center;justify-content:center;padding:18px;overscroll-behavior:contain;touch-action:pan-y}
#nslide.on{display:flex;animation:pfUp .35s ease both}
#nslide .nbox{width:100%;max-width:440px;background:#121214;border:1px solid #2a2a2e;border-radius:22px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.8);display:flex;flex-direction:column;max-height:86vh}
#nslide .nhead{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 0}
#nslide .nstep{font-size:13px;color:#a1a1aa;font-weight:700}
#nslide .nview{overflow:hidden;flex:1;min-height:0}
#nslide .ntrack{display:flex;height:100%;transition:transform .35s cubic-bezier(.22,1,.36,1);will-change:transform}
#nslide .nsl{flex:0 0 100%;min-width:0;padding:14px 18px;overflow-y:auto;max-height:52vh;-webkit-overflow-scrolling:touch}
#nslide .nsl h2{margin:6px 0 10px;font-size:21px;line-height:1.25}
.nlink{color:#60a5fa;text-decoration:underline;text-underline-offset:2px;word-break:break-all;font-weight:600}
.nlink.seen{color:#a78bfa}
.nlink:focus-visible{outline:2px solid #60a5fa;outline-offset:2px;border-radius:3px}
#nslide .nsl p{margin:0;color:#d4d4d8;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
#nslide .ndots{display:flex;gap:6px;justify-content:center;padding:6px 0 2px}
#nslide .ndots i{width:7px;height:7px;border-radius:50%;background:#3f3f46;transition:background .2s,transform .2s}
#nslide .ndots i.on{background:#e50914;transform:scale(1.35)}
#nslide .ndots i.seen{background:#7f1d1d}
#nslide .nfoot{display:flex;gap:10px;padding:12px 16px 16px}
#nslide .nfoot button{flex:1;border:0;border-radius:999px;padding:13px;font:inherit;font-size:15px;font-weight:800}
#nslide .nprev{background:#27272a;color:#fff}.nprev[disabled]{opacity:.35}
#nslide .nnext{background:#e50914;color:#fff}.nnext[disabled]{opacity:.45}
#nslide .nhint{text-align:center;font-size:12px;color:#a1a1aa;padding:0 16px 2px}
@media (prefers-reduced-motion:reduce){#nslide .ntrack{transition:none}#nslide.on{animation:none}}
#tplayer{position:fixed;inset:0;z-index:1000000;background:#000;display:none;overflow:hidden;touch-action:manipulation}
#tplayer.open{display:block}
#tplayer video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#tplayer .tbar{position:absolute;top:0;left:0;right:0;z-index:3;display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top) + 10px) 14px 26px;background:linear-gradient(rgba(0,0,0,.8),rgba(0,0,0,0))}
#tplayer .ttl{flex:1;min-width:0;font-weight:800;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff}
#tplayer .tx{width:40px;height:40px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:24px;line-height:1}
#tplayer .tpanel{position:absolute;z-index:2;left:50%;top:50%;width:min(340px,88vw);transform:translate(-50%,-50%);background:rgba(18,18,20,.94);border:1px solid #2a2a2e;border-radius:20px;padding:18px;text-align:center;color:#fff}
#tplayer .tpanel h3{margin:0 0 6px;font-size:17px}
#tplayer .tpanel p{margin:0 0 10px;font-size:14px;line-height:1.45;color:#d4d4d8}
#tplayer .tstats{display:flex;justify-content:space-between;gap:6px;margin:10px 0 8px;font-size:12px;color:#a1a1aa}
#tplayer .tstats b{display:block;font-size:15px;color:#fff}
#tplayer .tbarp{height:5px;border-radius:3px;background:#2a2a2e;overflow:hidden}
#tplayer .tbarp i{display:block;height:100%;width:100%;background:#e50914;transform:scaleX(0);transform-origin:left;transition:transform .4s linear}
#tplayer .tbtns{display:flex;flex-direction:column;gap:8px;margin-top:6px}
#tplayer .tbtns button{border:0;border-radius:999px;padding:13px;font:inherit;font-size:15px;font-weight:800}
#tplayer .tb1{background:#e50914;color:#fff}.tb2{background:#27272a;color:#fff}
.ncard{position:relative;display:block;width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 38px 14px 16px;color:#fff;font:inherit}
.ncard:active{background:#232326;border-color:#e50914}
.ncard b{display:block;font-size:16px}
.ncard span{display:block;margin-top:3px;font-size:14px;color:#d4d4d8}
.ncard em{display:block;margin-top:2px;font-style:normal;font-size:12px;color:var(--muted)}
.ncard i{position:absolute;right:16px;top:50%;transform:translateY(-50%);font-style:normal;font-size:26px;color:#e50914}
.igrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.icard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;color:#fff;text-align:left;font:inherit;min-height:92px}
.icard b{display:block;font-size:15px;margin-bottom:4px}
.icard span{display:block;color:var(--muted);font-size:12px;line-height:1.4}
.icard i{font-style:normal;display:inline-block;margin-top:8px;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:#2a2a2d;color:#d4d4d8}
.icard i.on{background:#16a34a;color:#fff}
.swrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:15px}
.sw{flex:none;width:50px;height:30px;border-radius:999px;border:0;background:#3a3a3e;position:relative;padding:0}
.sw:after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .15s}
.sw.on{background:#16a34a}
.sw.on:after{left:23px}
.keyrow{display:flex;gap:8px;align-items:center;margin:0 0 10px}
.keyrow .ainp{margin:0;flex:1}
.eye{flex:none;width:46px;height:46px;border-radius:12px;border:1px solid var(--line);background:#111;color:#fff;font-size:18px}
.atab{flex:1 0 auto;padding:10px 14px;border-radius:999px;border:0;background:#1c1c1f;color:#d4d4d8;font-weight:700;font-size:14px}
.atab.on{background:#fff;color:#000}
.abtn.mini{padding:7px 12px;font-size:12px;margin:0;border-radius:10px;width:auto}
.arow2{display:flex;gap:8px;margin:8px 0}
.achk2{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}
.apv{display:flex;gap:8px;overflow-x:auto;padding:6px 0}
.apvi{flex:none;width:84px;font-size:11px;color:#d4d4d8}
.apvi img{width:84px;height:120px;object-fit:cover;border-radius:8px;display:block;margin-bottom:4px;background:#222}
.adon{background:#18181b;border:1px solid #27272a;border-radius:14px;padding:12px;margin:10px 0}
.adtop b{display:block;font-size:16px}
.adtop span{font-size:12px;color:#a1a1aa}
.adbtns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.tpanel{display:flex;flex-direction:column;gap:8px}
.tout{font-size:13px;color:#d4d4d8;word-break:break-word}

.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px 12px}
.stat{background:linear-gradient(160deg,#1c1c20,#141416);border:1px solid #2a2a2e;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:2px}
.stat svg{width:22px;height:22px;margin-bottom:8px}
.stat b{font-size:26px;font-weight:800;letter-spacing:-.5px}
.stat span{font-size:13px;font-weight:700;color:#d4d4d8}
.stat i{font-style:normal;font-size:11px;color:#71717a}
.notice.pri{background:#3b0d10;border-color:var(--accent)}
#smpriv{padding:8px 16px;font-size:13px;color:#d4d4d8;display:flex;align-items:center;gap:10px}
#smpriv input{width:20px;height:20px}

body.amoled{--bg:#000;--card:#09090a;--card2:#111113;--line:#18181a}
.themec{margin:calc(var(--sat) + 4px) 16px 14px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px}
.themec h4{margin:0 0 12px;font-size:15px}
.throw{display:flex;gap:12px;flex-wrap:wrap}
.thb{background:none;border:0;color:var(--muted);font-size:11px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:6px;width:56px}
.thb i{width:36px;height:36px;border-radius:50%;border:2px solid var(--line);display:block}
.thb.on{color:var(--text)}
.thb.on i{border-color:var(--text)}
.thsw{margin-top:14px;display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700}
.tgl{width:50px;height:30px;border-radius:999px;border:0;background:#3a3a3e;position:relative;padding:0}
.tgl::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .15s}
.tgl.on{background:var(--accent)}
.tgl.on::after{left:23px}
.thcol{margin-top:12px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}
.thcol input{width:46px;height:34px;border:0;background:none;padding:0}
#libgrid .sec{margin-top:28px}
#libgrid .sec h3{font-size:20px;font-weight:800;letter-spacing:-.3px;padding:0 16px;margin:0 0 12px}
#libgrid .strip{gap:12px;padding-bottom:6px}
#libgrid .strip .card{flex:0 0 38%;max-width:190px}
.poster{box-shadow:0 6px 18px rgba(0,0,0,.45);transition:transform .18s ease,box-shadow .18s ease}
@media (hover:hover){.card:hover .poster{transform:translateY(-4px) scale(1.04);box-shadow:0 14px 30px rgba(0,0,0,.7)}}
.prog.under{position:static;margin-top:8px;height:4px;border-radius:3px;overflow:hidden}
.inlib{position:absolute;top:8px;left:8px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:1px solid rgba(255,255,255,.4);z-index:2}

.wcard{position:relative;flex:0 0 74%;max-width:310px;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:var(--card);scroll-snap-align:start;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);transition:transform .18s ease,box-shadow .18s ease}
.wcard img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wshade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,0) 40%,rgba(0,0,0,.85) 100%)}
.wbadge{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);border-radius:8px;padding:4px 8px;font-size:11px;font-weight:800}
.wtitle{position:absolute;left:12px;right:60px;bottom:14px;font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wplay{position:absolute;right:10px;bottom:12px;width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,255,255,.85);background:rgba(0,0,0,.45);color:#fff;display:flex;align-items:center;justify-content:center;padding:0}
.wplay svg{width:18px;height:18px;margin-left:2px}
.wprog{position:absolute;left:0;right:0;bottom:0;height:5px;background:rgba(255,255,255,.28)}
.wprog i{display:block;height:100%;background:var(--accent)}
.wcard:active{transform:scale(.97)}
@media (hover:hover){.wcard:hover{transform:translateY(-4px) scale(1.03);box-shadow:0 14px 30px rgba(0,0,0,.7)}}
#libgrid .grid{grid-template-columns:repeat(3,1fr)}
.instcard{margin:0 16px 14px;background:linear-gradient(160deg,#1c1c20,#141416);border:1px solid var(--line);border-radius:18px;padding:14px;position:relative}
.instcard h4{margin:0 0 6px;font-size:15px}
.instcard p{margin:0 0 10px;font-size:13px;color:var(--muted);line-height:1.4}
.instcard .pfbtn{margin:0;min-width:0;padding:10px 18px;background:var(--accent);color:var(--on-accent)}
.instcard .cls{position:absolute;top:8px;right:10px;background:none;border:0;color:var(--muted);font-size:20px}
#instbar{position:fixed;left:12px;right:12px;bottom:calc(var(--sab) + 84px);z-index:40;background:#1c1c20;border:1px solid var(--line);border-radius:16px;padding:12px 14px;display:none;align-items:center;gap:10px;font-size:13px;font-weight:700}
#instbar.on{display:flex}
#instbar span{flex:1}
#instbar button{border:0;border-radius:999px;padding:9px 16px;font-weight:800;background:var(--accent);color:var(--on-accent)}
#instbar button.x{background:none;color:var(--muted);padding:6px;font-size:18px}
#smpriv .ipst{font-size:12px;margin:4px 0 0 30px;font-weight:700}

#player{position:fixed;inset:0;z-index:999999;background:#000;display:none;opacity:0;transition:opacity .25s ease;user-select:none;-webkit-user-select:none;touch-action:none;overflow:hidden}
#player.open{display:block;opacity:1}
#player .pvid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1}
#player .pamb{position:absolute;inset:-10%;width:120%;height:120%;filter:blur(70px) saturate(1.6);opacity:0;transition:opacity .4s;z-index:0}
#player.amb .pamb{opacity:.55}
#player video::cue{background:rgba(0,0,0,.6);color:#fff;font-size:.9em;text-shadow:0 1px 3px #000,0 0 6px #000}
#player.ccs-s video::cue{font-size:.7em}
#player.ccs-m video::cue{font-size:.9em}
#player.ccs-l video::cue{font-size:1.3em}
#player .ptop,#player .pbot{position:absolute;left:0;right:0;z-index:3;transition:opacity .3s ease}
#player .ptop{top:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(var(--sat) + 12px) 14px 26px;background:linear-gradient(180deg,rgba(0,0,0,.85),rgba(0,0,0,0))}
#player .ptitle{font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
#player .pright{display:flex;gap:4px;flex:none}
#player .pbot{bottom:0;padding:22px 16px calc(var(--sab) + 14px);background:linear-gradient(0deg,rgba(0,0,0,.85),rgba(0,0,0,0))}
#player .pbot>*{position:relative}
#player .pbot::before{content:"";position:absolute;left:10px;right:10px;bottom:calc(var(--sab) + 6px);top:18px;border-radius:18px;background:rgba(30,30,34,.45);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);z-index:0}
#player.hide .ptop,#player.hide .pbot{opacity:0;pointer-events:none}
#player.hide{cursor:none}
#player .pbtn{background:none;border:0;padding:8px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;color:#fff;border-radius:50%;flex:none}
#player .pbtn:active{background:rgba(255,255,255,.14)}
#player .pbtn svg{width:26px;height:26px}
#player .pbtn em{position:absolute;font-style:normal;font-size:9px;font-weight:800;top:50%;left:50%;transform:translate(-50%,-42%)}
#player .pscrub{height:22px;margin:0 6px;display:flex;align-items:center;cursor:pointer;touch-action:none}
#player .pscrub::before{content:"";position:absolute;left:0;right:0;height:5px;border-radius:3px;background:rgba(255,255,255,.25)}
#player .pscrub i{position:absolute;left:0;height:5px;border-radius:3px;width:0}
#player .sbuf{background:rgba(255,255,255,.4)}
#player .sfill{background:var(--accent)}
#player .sthumb{position:absolute;left:0;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(0,0,0,.35)}
#player .stip{position:absolute;bottom:26px;transform:translateX(-50%);background:rgba(0,0,0,.8);padding:3px 8px;border-radius:6px;font-size:12px;font-weight:700;opacity:0;pointer-events:none}
#player .prow{display:flex;align-items:center;gap:2px;padding:0 4px}
#player .ptime{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:8px;white-space:nowrap}
#player .pspace{flex:1}
#player .pvol{width:80px;accent-color:var(--accent);margin-left:2px}
#player .pcc{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:10px;padding:7px 8px;font-size:12px;font-weight:700;max-width:110px}
#player .pcc option{color:#000}
#player .pspin{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;border:4px solid rgba(255,255,255,.2);border-top-color:var(--accent);animation:pspin .8s linear infinite;z-index:2;display:none;pointer-events:none}
#player .pspin.on{display:block}
@keyframes pspin{to{transform:rotate(360deg)}}
#player .pmsg{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);text-align:center;font-size:15px;font-weight:700;z-index:2;display:none;line-height:1.5}
#player .pmsg.on{display:block}
@media (max-width:480px){#player .pvol{display:none}#player .ptime{font-size:12px;margin-left:4px}}

.livecard{margin:0 16px 12px;background:linear-gradient(160deg,#10231a,#0d1a14);border:1px solid #1f4d36;border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:14px}
.livedot{width:12px;height:12px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.7);animation:livepulse 1.8s infinite;flex:none}
@keyframes livepulse{70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.livecard b{font-size:34px;font-weight:800;letter-spacing:-1px;color:#4ade80}
.livetxt{display:flex;flex-direction:column;gap:2px}
.livetxt span{font-size:14px;font-weight:800}
.livetxt em{font-style:normal;font-size:11px;color:#86efac}
.chart{margin:4px 0 2px}
.adlab{display:flex;flex-direction:column;gap:6px;margin:12px 0;font-size:13px;color:var(--muted);font-weight:700}
.adlab .arow2{align-items:center;color:var(--text)}
#player .padbox{position:absolute;inset:0;z-index:6;background:#000}
#player .padbox video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#player .adtag{position:absolute;top:calc(var(--sat) + 14px);left:14px;background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:800;z-index:7}
#player .adskip{position:absolute;right:14px;bottom:calc(var(--sab) + 30px);z-index:7;background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.6);color:#fff;border-radius:6px;padding:11px 16px;font-size:14px;font-weight:800}
#player .adskip.ready{background:#fff;color:#000}
#player .adlearn{position:absolute;left:14px;bottom:calc(var(--sab) + 30px);z-index:7;background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:6px;padding:11px 16px;font-size:13px;font-weight:700}
#player .adbar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.25);z-index:7}
#player .adbar i{display:block;height:100%;width:0;background:#facc15}
#player .adclose{position:absolute;top:calc(var(--sat) + 8px);right:8px;z-index:7;background:none;border:0;width:44px;height:44px;padding:8px}
#player.adon .ptop,#player.adon .pbot{display:none}
#player.adon .pnext,#player.adon .srvroom{display:none}
#player .pwhy{font-size:13px;font-weight:600;color:#d4d4d8;margin:8px 0 4px;line-height:1.45}
#player .pfrow{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px}
#player .pvlc{margin-top:0;pointer-events:auto}
#player .pvlc.pgrey{background:#3a3a40;color:#fff}
#player .srvroom{position:absolute;left:10px;right:10px;bottom:calc(var(--sab) + 128px);max-width:460px;max-height:52%;overflow:auto;margin:0 auto;background:rgba(12,12,14,.97);border:1px solid #2c2c31;border-radius:16px;padding:10px;z-index:9;touch-action:pan-y;box-shadow:0 10px 40px rgba(0,0,0,.7)}
#player .srhd{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 8px}
#player .srhd b{font-size:12px;letter-spacing:.18em;color:#a1a1aa}
#player .srx{background:none;border:0;color:#a1a1aa;font-size:22px;line-height:1;padding:2px 8px}
#player .srrow{display:flex;align-items:center;gap:10px;background:#18181b;border:1px solid #26262b;border-radius:12px;padding:10px 10px;margin-bottom:8px}
#player .srrow.on{border-color:#e50914;background:#1f1214}
#player .srn{font:800 13px/1 ui-monospace,Menlo,monospace;color:#71717a;width:22px}
#player .srdot{width:12px;height:12px;border-radius:50%;flex:none}
#player .srmid{flex:1;min-width:0}
#player .srt1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#player .srt1 b{font-size:14px}
#player .sbadge{font-size:10.5px;font-weight:800;background:#2a2a2e;border-radius:999px;padding:3px 8px;color:#e4e4e7}
#player .srlive{font-size:10px;font-weight:900;letter-spacing:.1em;background:#e50914;color:#fff;border-radius:6px;padding:3px 6px}
#player .srupd{font-size:10px;font-weight:900;letter-spacing:.1em;background:#14351f;color:#86efac;border-radius:6px;padding:3px 6px}
#player .srbad{font-size:10px;font-weight:900;letter-spacing:.1em;background:#3f1d1d;color:#fca5a5;border-radius:6px;padding:3px 6px}
#player .srsub{display:block;font-size:12px;color:#a1a1aa;margin-top:3px;overflow-wrap:anywhere}
#player .srcp{background:#2a2a2e;color:#fff;border:0;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:700;flex:none;touch-action:manipulation}
.tierbar{margin:0 0 10px}
.tierrow{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:6px}
.tierrow::-webkit-scrollbar{display:none}
.tierlb{flex:0 0 auto;font-size:11px;font-weight:800;letter-spacing:.08em;color:#8b8b94;min-width:62px;text-transform:uppercase}
.tierchip{flex:0 0 auto;background:#18181b;border:1px solid #2a2a30;border-radius:999px;color:#d4d4d8;font-size:12px;font-weight:700;padding:6px 11px}
.tierchip.on{background:#e50914;border-color:#e50914;color:#fff}
#player .ptry{position:absolute;top:calc(var(--sat) + 70px);left:50%;transform:translateX(-50%);display:none;background:rgba(0,0,0,.78);color:#fff;border:1px solid #2c2c31;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;z-index:8;pointer-events:none;white-space:nowrap}
#player .ptry.on{display:block}
#player .pepi{max-height:62%}
#player .pepnx{margin-bottom:8px}
#player .pepgo{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;background:#1f1214;border:1px solid #e50914;border-radius:12px;padding:10px 12px;color:#fff;font-size:14px}
#player .pepl{font-size:10px;font-weight:900;letter-spacing:.14em;color:#fca5a5;text-transform:uppercase}
#player .pepchips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:8px}
#player .pepchips::-webkit-scrollbar{display:none}
#player .pepc{flex:0 0 auto;background:#18181b;border:1px solid #26262b;border-radius:999px;color:#d4d4d8;font-size:12px;font-weight:700;padding:6px 12px}
#player .pepc.on{background:#e50914;border-color:#e50914;color:#fff}
#player .pepr{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#18181b;border:1px solid #26262b;border-radius:12px;padding:10px;margin-bottom:6px;color:#fff;font-size:14px}
#player .pepr.on{border-color:#e50914;background:#1f1214}
#player .pepr.off{opacity:.5}
#player .pepn{flex:0 0 34px;font-size:12px;font-weight:800;color:#a1a1aa}
#player .pepm{display:flex;flex-direction:column;gap:3px;min-width:0;align-items:flex-start}
#player .pepm b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
#player .pepd{font-size:11px;color:#8b8b94}
#player .srnote{font-size:12px;color:#8b8b94;padding:4px 6px 2px;line-height:1.45}
#player .pnext{position:absolute;right:12px;bottom:calc(var(--sab) + 140px);z-index:7;max-width:min(360px,calc(100% - 24px));background:rgba(14,14,16,.95);border:1px solid #33333a;border-radius:14px;padding:10px 10px 10px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 28px rgba(0,0,0,.6)}
#player .pnt{flex:1;min-width:0}
#player .pnt span{display:block;font-size:11px;color:#a1a1aa;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
#player .pnt b{display:block;font-size:13px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#player .pnplay{background:#fff;color:#000;border:0;border-radius:999px;padding:9px 16px;font-weight:800;font-size:13px;flex:none;touch-action:manipulation}
#player .pnx{background:none;border:0;color:#a1a1aa;font-size:22px;line-height:1;padding:2px 6px;flex:none}

#player .ptop,#player .pbot{touch-action:manipulation}
#player .pscrub{touch-action:none}
#player.rot{inset:auto;top:0;left:100vw;width:100vh;height:100vw;transform-origin:top left;transform:rotate(90deg)}
#player .pdim{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:2}
#player .phud{position:absolute;top:22%;left:50%;transform:translateX(-50%);z-index:8;background:rgba(0,0,0,.72);border-radius:999px;padding:10px 18px;display:none;align-items:center;gap:10px;font-weight:800;font-size:15px;pointer-events:none;white-space:nowrap}
#player .phud.on{display:flex}
#player .phud svg{width:22px;height:22px;flex:none}
#player .prow2{display:flex;align-items:center;gap:8px;padding:8px 4px 0;overflow-x:auto;scrollbar-width:none}
#player .prow2::-webkit-scrollbar{display:none}
#player .ptxt{flex:none;background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:800;touch-action:manipulation}
#player .pmenu{position:absolute;left:12px;right:12px;bottom:calc(var(--sab) + 130px);max-height:50%;overflow:auto;background:rgba(20,20,20,.97);border:1px solid #333;border-radius:14px;padding:8px;z-index:9;touch-action:pan-y}
#player .pmenu b{display:block;padding:8px 10px;font-size:13px;color:#aaa}
#player .pmenu button{display:block;width:100%;text-align:left;background:none;border:0;color:#fff;padding:12px 10px;font-size:14px;font-weight:700;border-radius:8px}
#player .pmenu button.on{background:#e50914}
#player .pvlc{display:inline-block;margin-top:12px;background:#ff8800;color:#000;border:0;border-radius:10px;padding:11px 16px;font-weight:800;font-size:14px}

@media (min-width:720px){
  html{background:#000}
  body{max-width:560px;margin:0 auto;background:var(--bg);min-height:100vh;box-shadow:0 0 0 1px #1b1b1d,0 0 80px rgba(var(--accent-rgb),.08)}
  #detail,#dbar,#catmenu,#admin,#profiles{left:50%;right:auto;width:560px;margin-left:-280px}
  #player{left:0;right:0;width:auto;margin:0}
  #detail,#catmenu,#admin{top:0;bottom:0}
}
</style>
</head>
<body>
<style>
html.splashlock,html.splashlock body{overflow:hidden!important;height:100%;overscroll-behavior:none}
#bsplash{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;touch-action:none;overflow:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);-webkit-user-select:none;user-select:none}
#bsplash.free{pointer-events:none}
#bsplash.out{opacity:0;pointer-events:none;transition:opacity .5s ease}
#bsplash .bs-bg{position:absolute;inset:0;background:#000}
#bsplash .bs-word{position:relative;display:flex;align-items:center;font:900 22vw/1.15 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.04em;overflow:hidden;padding:.06em .1em;will-change:transform}
#bsplash .bs-B{color:#E50914;display:inline-block;opacity:0;transform:scale(1.12);animation:bsB 1s cubic-bezier(.2,.7,.2,1) .5s forwards}
#bsplash .bs-oa{display:inline-block;width:1.2em;overflow:hidden;margin-left:-.02em}
#bsplash .bs-oa i{display:block;font-style:normal;color:#fff;transform:translateX(-105%);animation:bsOa 1.2s cubic-bezier(.22,1,.36,1) 2s forwards}
#bsplash .bs-shine{position:absolute;top:0;bottom:0;left:0;width:40%;background:linear-gradient(100deg,transparent 0,rgba(255,255,255,.9) 50%,transparent 100%);mix-blend-mode:overlay;transform:translateX(-120%) skewX(-18deg);animation:bsShine 1.2s ease-in-out 2.9s forwards;pointer-events:none}
#bsplash .bs-halo{position:absolute;width:80vw;height:80vw;max-width:520px;max-height:520px;border-radius:50%;background:radial-gradient(circle,rgba(229,9,20,.42),rgba(229,9,20,0) 66%);opacity:0;transform:scale(.4);animation:bsHalo 1.8s ease-out .2s forwards;will-change:transform,opacity}
#bsplash .bs-beam{position:absolute;left:50%;top:-10vh;width:56vw;max-width:380px;height:120vh;margin-left:-28vw;background:linear-gradient(to right,rgba(255,120,100,0),rgba(255,150,130,.16) 50%,rgba(255,120,100,0));opacity:0;transform:scaleX(.05);animation:bsBeam 1.6s ease-out 1s forwards;will-change:transform,opacity}
@media (min-width:600px){#bsplash .bs-beam{margin-left:-190px}}
#bsplash .bs-slit{position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;background:linear-gradient(to right,rgba(255,255,255,0),#fff 50%,rgba(255,255,255,0));box-shadow:0 0 18px 2px rgba(255,90,80,.7);transform:scaleX(0);opacity:0;animation:bsSlit 1.1s ease-out .1s forwards}
#bsplash .bs-sh{position:absolute;left:0;right:0;height:50.5%;background:#000;will-change:transform}
#bsplash .bs-t{top:0;animation:bsTop 1.1s cubic-bezier(.7,0,.2,1) 1s forwards}
#bsplash .bs-b{bottom:0;animation:bsBot 1.1s cubic-bezier(.7,0,.2,1) 1s forwards}
#bsplash.settle .bs-word{transform:translateY(var(--dy,-30vh)) scale(var(--s,.34));transition:transform .95s cubic-bezier(.65,0,.2,1)}
#bsplash.settle .bs-bg{opacity:0;transition:opacity .7s ease .3s}
#bsplash.settle .bs-halo,#bsplash.settle .bs-beam,#bsplash.settle .bs-slit{opacity:0!important;transition:opacity .5s ease;animation:none}
@keyframes bsB{from{opacity:0;transform:scale(1.12)}to{opacity:1;transform:none}}
@keyframes bsOa{from{transform:translateX(-105%)}to{transform:none}}
@keyframes bsShine{from{transform:translateX(-120%) skewX(-18deg)}to{transform:translateX(320%) skewX(-18deg)}}
@keyframes bsHalo{0%{opacity:0;transform:scale(.4)}45%{opacity:1}100%{opacity:.5;transform:scale(1)}}
@keyframes bsBeam{0%{opacity:0;transform:scaleX(.05)}40%{opacity:1}100%{opacity:.8;transform:scaleX(1)}}
@keyframes bsSlit{0%{opacity:1;transform:scaleX(0)}70%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1)}}
@keyframes bsTop{to{transform:translateY(-101%)}}
@keyframes bsBot{to{transform:translateY(101%)}}
@media (min-width:600px){#bsplash .bs-word{font-size:132px}}
@media (prefers-reduced-motion:reduce){
#bsplash .bs-B{animation:none;opacity:1;transform:none}
#bsplash .bs-oa i{animation:none;transform:none}
#bsplash .bs-shine,#bsplash .bs-beam,#bsplash .bs-slit,#bsplash .bs-sh{display:none;animation:none}
#bsplash .bs-halo{animation:none;opacity:.45;transform:none}
#bsplash.settle .bs-word{transition:none}
#bsplash.settle .bs-bg{transition:opacity .3s ease}
}
#upbar{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 78px);z-index:1000002;background:#0a0a0a;border:1px solid #2a2a2e;border-radius:16px;padding:10px 10px 10px 16px;display:none;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.7);max-width:520px;margin:0 auto}
#upbar.on{display:flex;animation:pfUp .35s ease both}
#upbar span{flex:1;font-size:14px;font-weight:700;color:#fff}
#upbar .upgo{background:#E50914;color:#fff;border:0;border-radius:999px;padding:10px 20px;font-weight:800;font-size:14px}
#upbar .upx{background:none;border:0;color:#a1a1aa;font-size:24px;line-height:1;padding:4px 8px}
#profiles{background:#000!important;transition:opacity .45s ease}
#profiles.fade{opacity:0;pointer-events:none}
#profiles.open h1{animation:pfUp .6s ease both}
#profiles.open .pfgrid{animation:pfUp .6s ease .12s both}
@keyframes pfUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
</style>
<div id="bsplash" aria-hidden="true"><div class="bs-bg"></div><div class="bs-halo"></div><div class="bs-beam"></div><div class="bs-word"><span class="bs-B">B</span><span class="bs-oa"><i>oa</i></span><span class="bs-shine"></span></div><div class="bs-sh bs-t"></div><div class="bs-sh bs-b"></div><div class="bs-slit"></div></div>
<script>
(function () {
  var d = document, root = d.documentElement, el = d.getElementById("bsplash");
  var pwa = false;
  try { pwa = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; } catch (e) {}
  root.className += pwa ? " is-pwa" : " is-web";
  var seen = false;
  try { seen = !!sessionStorage.getItem("boa_sp"); sessionStorage.setItem("boa_sp", "1"); } catch (e) {}
  if (seen) { if (el && el.parentNode) el.parentNode.removeChild(el); window.__boaGate = false; return; }
  window.__boaGate = true;
  root.className += " splashlock";
  var rm = false;
  try { rm = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
  var locked = true, gone = false, tries = 0;
  function trap(e) { if (!locked) return; try { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (x) {} return false; }
  var ev = ["pointerdown", "pointerup", "touchstart", "touchmove", "touchend", "click", "dblclick", "wheel", "contextmenu", "mousedown"];
  for (var i = 0; i < ev.length; i++) el.addEventListener(ev[i], trap, { passive: false });
  var kv = ["keydown", "keyup", "keypress"];
  for (var k = 0; k < kv.length; k++) d.addEventListener(kv[k], trap, true);
  function release() {
    locked = false;
    for (var k2 = 0; k2 < kv.length; k2++) d.removeEventListener(kv[k2], trap, true);
    el.className += " free";
  }
  function remove() { if (gone) return; gone = true; release(); if (el.parentNode) el.parentNode.removeChild(el); }
  function dismiss() {
    if (gone) return;
    release();
    el.className = "free out";
    setTimeout(remove, 600);
  }
  window.__boaUnlock = function () { root.className = root.className.replace(/\s*splashlock/g, ""); dismiss(); };
  function settle() {
    var pf = d.getElementById("profiles"), h = pf && pf.getElementsByTagName("h1")[0], w = el.querySelector(".bs-word");
    if (!pf || pf.className.indexOf("open") < 0 || !h || !w) { dismiss(); return; }
    try {
      var hr = h.getBoundingClientRect(), wr = w.getBoundingClientRect(), s = 0.34;
      var hh = wr.height * s, cy = hr.top - 18 - hh / 2;
      var minY = (window.innerHeight * 0.04) + hh / 2;
      if (cy < minY) cy = minY;
      el.style.setProperty("--s", String(s));
      el.style.setProperty("--dy", Math.round(cy - (wr.top + wr.height / 2)) + "px");
    } catch (e) { dismiss(); return; }
    el.className += " settle";
    setTimeout(release, rm ? 150 : 1000);
  }
  function finish() {
    if (typeof window.__boaOpenGate !== "function" && tries++ < 40) { setTimeout(finish, 150); return; }
    try { if (window.__boaOpenGate) window.__boaOpenGate(); } catch (e) {}
    if (window.requestAnimationFrame) window.requestAnimationFrame(settle); else settle();
  }
  setTimeout(finish, rm ? 1200 : 4300);
  setTimeout(function () { if (window.__boaUnlock && !window.__boaGateOpen) window.__boaUnlock(); }, 20000);
})();
</script>
<div id="streammodal" role="dialog" aria-label="Streams">
  <div class="shead">
    <h2 id="smtitle">Streams</h2>
    <button class="ib" id="smclose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div id="smpriv"></div>
  <div id="smsubs"></div>
  <div class="splayer" id="smplayer"></div>
  <div id="smlist"></div>
</div>
<div id="v-home" class="view on">
  <button id="brand" aria-label="Boa Cinema"><b>Boa</b>-cinema</button>
  <button id="bell" aria-label="Notices" aria-haspopup="dialog" aria-expanded="false" aria-controls="npop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><i class="bdot"></i></button>
  <div id="hero" class="sk">
    <div id="seg"><button id="segm" class="on">Movies</button><button id="segt">Series</button></div>
  </div>
  <div style="height:16px"></div>
  <div id="notice" class="notice"></div>
  <div id="nslide" role="dialog" aria-modal="true" aria-label="Important notices"></div>
  <div id="tplayer" role="dialog" aria-modal="true" aria-label="Torrent player"></div>
  <div id="chips" class="catbar"></div>
  <div id="catmenu" role="dialog" aria-label="Categories">
    <div id="catlist"></div>
    <button id="catclose" aria-label="Close categories"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div id="rows"></div>
  <footer>
    <div class="fl">Boa Cinema</div>
    <div>Curated by Boa Entertainment</div>
    <a href="https://t.me/Boa_entertainment_bot" id="fhandle">@Boa_entertainment_bot</a>
    <p>&copy; <span id="yr">2026</span> Boa Entertainment. All rights reserved. The Boa Cinema platform, design and curation belong to Boa Entertainment. All titles, posters, trailers and trademarks belong to their respective owners.</p>
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB. Netflix is a trademark of Netflix, Inc. Boa Entertainment is not affiliated with Netflix.</p>
  </footer>
</div>

<div id="v-search" class="view">
  <h1 class="vh big">Search</h1>
  <div class="sbox"><input id="q" type="search" placeholder="Search movies, shows..." autocomplete="off" enterkeyhint="search"></div>
  <div id="disc">
    <h2 class="dh">Discover</h2>
    <div class="dsel">
      <select id="dtype" aria-label="Type"><option value="movie">Movies</option><option value="tv">Series</option></select>
      <select id="dcat" aria-label="Catalog"></select>
      <select id="dgenre" aria-label="Genre"></select>
    </div>
    <div class="dsub" id="dsub"></div>
    <div id="dgrid"></div>
  </div>
  <div id="results" style="display:none"></div>
</div>

<div id="v-lib" class="view">
  <h1 class="vh">Library</h1>
  <div id="libgrid"></div>
</div>

<div id="v-me" class="view"></div>

<nav id="nav" aria-label="Main">
  <button class="ni on" data-tab="home"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.1 3 10.4V21h6.5v-6h5v6H21V10.4z"/></svg>Home</button>
  <button class="ni" data-tab="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>Search</button>
  <button class="ni" data-tab="lib"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v2H6zM4 7h16v2H4zM3 11h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm7 3v2h4v-2z"/></svg>Library</button>
  <button class="ni" data-tab="me"><span class="av" id="navav">B</span>Profile</button>
</nav>

<div id="detail">
  <div id="dbar">
    <button class="ib" id="dback" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m6-7-7 7 7 7"/></svg></button>
    <div id="dbt"></div>
    <button class="ib" id="dlib" aria-label="Add to library"></button>
  </div>
  <div id="dbody"></div>
</div>
<div id="admin" role="dialog" aria-label="Owner panel"></div>
<div id="profiles"></div>
<div id="player"></div>
<div id="instbar"><span>Install Boa Cinema on your phone</span><button id="instgo">Install</button><button class="x" id="instx" aria-label="Dismiss">\u00D7</button></div>
<div id="npop" role="dialog" aria-label="Notices"></div>
<div id="toast" class="toast"></div>

<script>
(function () {
  var IMG = "https://image.tmdb.org/t/p/";
  var tg = window.Telegram && window.Telegram.WebApp;
  var media = "movie", tab = "home", myCC = "";
  var homeSeq = 0, searchSeq = 0, detailSeq = 0;
  var heroItems = [], heroIdx = 0, heroTimer = null;
  var stack = [], titleCache = {}, seasonCache = {}, histOK = true;
  var LIB = [];
  var timer = null, toastTimer = null;
  var segEl = document.getElementById("seg");

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>'
  };

  try {
    var sm = localStorage.getItem("boa_media");
    if (sm === "tv") media = "tv";
  } catch (e) {}

  if (tg) {
    try { tg.ready(); tg.expand(); tg.setHeaderColor("#0a0a0a"); tg.setBackgroundColor("#0a0a0a"); } catch (e) {}
  }

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function imgUrl(p, size) { return /^https?:/.test(p) ? p : IMG + size + p; }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api(path, tries, timeoutMs) {
    tries = tries == null ? 1 : tries;
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 25000);
    var headers = {};
    if (tg && tg.initData) headers["x-tg-init"] = tg.initData;
    return fetch(path, { headers: headers, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(to);
        if (!r.ok) throw new Error("bad");
        return r.json();
      })
      .catch(function (e) {
        clearTimeout(to);
        if (tries > 0) return api(path, tries - 1, timeoutMs);
        throw e;
      });
  }
  function openLink(url) {
    if (tg && tg.openLink) { try { tg.openLink(url); return; } catch (e) {} }
    window.open(url, "_blank");
  }
  // Turns http(s) links inside notice text into real anchors. Built with DOM nodes only (no HTML parsing), so notice text can never inject markup.
  function linkify(parent, text) {
    var re = /https?:\/\/[^\s<>"']+/gi, s0 = String(text == null ? "" : text), last = 0, m;
    while ((m = re.exec(s0))) {
      var u = m[0], tail = "", tm = /[.,;:!?)\]}]+$/.exec(u);
      if (tm) { tail = tm[0]; u = u.slice(0, u.length - tail.length); }
      if (!/^https?:\/\/[^\s\/?#]{2,}/i.test(u)) continue;
      if (m.index > last) parent.appendChild(document.createTextNode(s0.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "nlink"; a.textContent = u;
      // opening a link never advances, closes or acknowledges a notice: it only marks the link as opened
      a.onclick = function (ev) {
        ev.stopPropagation();
        this.className = "nlink seen";
        if (tg && tg.openLink) { ev.preventDefault(); try { tg.openLink(this.href); } catch (e) { window.open(this.href, "_blank", "noopener"); } }
      };
      parent.appendChild(a);
      if (tail) parent.appendChild(document.createTextNode(tail));
      last = m.index + m[0].length;
    }
    if (last < s0.length) parent.appendChild(document.createTextNode(s0.slice(last)));
    return parent;
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast on";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, 1800);
  }
  function clean(t) { return String(t || "").replace(/^[^A-Za-z0-9]+/, ""); }
  function fmtDate(d) {
    if (!d) return "";
    try {
      return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  }
  function flag(cc) {
    try {
      return String.fromCodePoint.apply(null, cc.toUpperCase().split("").map(function (c) { return 127397 + c.charCodeAt(0); }));
    } catch (e) { return ""; }
  }
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) {}
  function cname(cc) {
    try { return (regionNames && regionNames.of(cc)) || cc; } catch (e) { return cc; }
  }
  function shortDate(d) {
    var p = d.split("-");
    var M = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return (+p[2]) + " " + M[(+p[1]) - 1];
  }
  function dur(min) {
    if (!min) return "";
    return min >= 60 ? Math.floor(min / 60) + "h " + (min % 60) + "m" : min + "m";
  }

  // ---------- profiles, library and watch history (per Telegram account, per profile) ----------
  var cloud = null;
  try {
    if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) cloud = tg.CloudStorage;
  } catch (e) {}
  var PROFILES = [];
  var PID = "p1";
  var WATCH = [];
  var AVC = ["#e50914", "#2563eb", "#16a34a", "#f59e0b", "#9333ea", "#0891b2"];
  var CUR = null;
  // Last playing stream per title / episode. Memory + sessionStorage only (never KV): a refresh, filter change or update keeps it.
  var LASTP = null;
  function lpKey(c) { return c ? [c.mt, c.id, c.s || 1, c.e || 1].join("|") : ""; }
  function lpLoad() {
    if (LASTP) return LASTP;
    LASTP = {};
    try { var j = JSON.parse(sessionStorage.getItem("boa_lp") || "{}"); if (j && typeof j === "object") LASTP = j; } catch (e) {}
    return LASTP;
  }
  function lpGet(c) { var k = lpKey(c), m = lpLoad(); return k && m[k] && m[k].url ? m[k] : null; }
  function lpSet(c, st0) {
    var k = lpKey(c), m = lpLoad();
    if (!k || !st0 || !st0.url || /^magnet:/i.test(st0.url)) return;
    var o = { url: st0.url, provider: st0.provider || "", title: st0.title || "", name: st0.name || "", quality: st0.quality || "", size: st0.size || "", t: Date.now() };
    if (st0.headers) o.headers = st0.headers;
    m[k] = o;
    var ks = Object.keys(m);
    if (ks.length > 30) { ks.sort(function (a, b) { return (m[a].t || 0) - (m[b].t || 0); }); for (var i = 0; i < ks.length - 30; i++) delete m[ks[i]]; }
    try { sessionStorage.setItem("boa_lp", JSON.stringify(m)); } catch (e) {}
  }
  var SEASON_LISTS = {};
  var STRM_TOK = 0, STRM_T = null;     // one pending stream re-check at most; a new title / closing the sheet cancels it
  var SUBS = [], SUBA = [], SUBT = [], SUBU = [], SUBBLOB = "", SUBTOK = 0;
  var SUBSEL = "", SUBUSER = false, SUBEN = false, SUBHKEY = "";
  var TIER = lsGet("boa_tier", "any"), MAXG = lsGet("boa_maxgb", "auto");   // stream picker: resolution tier + hard file-size ceiling (GB)
  var CCSIZE = lsGet("boa_ccsize", "m"), CCPOS = lsGet("boa_ccpos", "b"), CCHID = false;   // caption size (s/m/l) and position (b = bottom, m = lower-mid)
  function isEn(x) { return !!x && (x.lang === "eng" || x.lang === "en" || /english/i.test(x.label || x.name || "")); }
  var LANGS = { eng: "English", spa: "Spanish", fre: "French", fra: "French", por: "Portuguese", ara: "Arabic", ger: "German", deu: "German", ita: "Italian", rus: "Russian", hin: "Hindi", tur: "Turkish", chi: "Chinese", zho: "Chinese", jpn: "Japanese", kor: "Korean", dut: "Dutch", pol: "Polish", ind: "Indonesian", swa: "Swahili", yor: "Yoruba" };
  var DM = { en: ["eng"], fr: ["fre", "fra"], es: ["spa"], pt: ["por"], ar: ["ara"], de: ["ger", "deu"], it: ["ita"], ru: ["rus"], hi: ["hin"], tr: ["tur"], zh: ["chi", "zho"], ja: ["jpn"], ko: ["kor"], nl: ["dut"], pl: ["pol"], id: ["ind"], sw: ["swa"] };
  // .srt text -> valid WEBVTT
  function toVtt(t) {
    t = String(t || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    var vtt = /^\s*WEBVTT/.test(t);
    if (!vtt) t = t.replace(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}),(\d{1,3})/g, "$1.$2");
    // drop positioning after the timestamps (line / position / align / size) so captions never jump to the top
    t = t.replace(/^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})[^\n]*$/gm, "$1").replace(/\{\\an?\d\}/g, "");
    return vtt ? t.replace(/^\s+/, "") : "WEBVTT\n\n" + t.trim() + "\n";
  }
  function subName(x) { return x.label || (LANGS[x.lang] || x.lang) + (x.n > 1 ? " " + x.n : ""); }
  // one list for the CC menu: add-on subtitles, then stream-level ones, then uploads (the selection is kept by its address)
  function rebuildSubs() {
    var key = SUBS[+SUBSEL] ? SUBS[+SUBSEL].u : "";
    SUBS = SUBA.concat(SUBT, SUBU);
    if (key) { SUBSEL = ""; SUBS.forEach(function (x, i) { if (x.u === key) SUBSEL = String(i); }); }
  }
  function addStreamSubs(streams) {
    var seen = {}, n = 0;
    SUBT.forEach(function (x) { seen[x.u] = 1; n++; });
    (streams || []).forEach(function (st) {
      (st && st.subs || []).forEach(function (x) {
        if (!x || !x.u || seen[x.u] || n >= 10) return;
        seen[x.u] = 1; n++;
        SUBT.push({ lang: x.lang || "und", label: x.label || "", u: x.u, n: 1, from: "stream" });
      });
    });
    rebuildSubs(); autoPick();
    if (PLSUBREFRESH) { PLSUBREFRESH(); applySub(); }
  }
  // English first (en / eng / "English"); otherwise the device language. A viewer's own choice (including Off) is never overridden,
  // and a later-arriving English track replaces an automatic non-English pick.
  function autoPick() {
    if (SUBUSER || SUBEN || !SUBS.length) return;
    var want = DM[String(navigator.language || "en").slice(0, 2).toLowerCase()] || [], pick = -1, dev = -1;
    SUBS.forEach(function (x, i) { if (pick < 0 && isEn(x)) pick = i; if (dev < 0 && want.indexOf(x.lang) > -1) dev = i; });
    if (pick > -1) SUBEN = true; else pick = dev;
    if (pick > -1) SUBSEL = String(pick);
  }
  function dropTracks(v) {
    Array.prototype.slice.call(v.querySelectorAll("track")).forEach(function (t) { t.remove(); });
    if (SUBBLOB) { try { URL.revokeObjectURL(SUBBLOB); } catch (e) {} SUBBLOB = ""; }
  }
  // explicit: the chosen track is "showing", every other text track is "disabled"
  // captions sit above the control bar while it is showing and drop low when it is hidden (cue line counts from the bottom edge)
  function ccLineNow() { return CCPOS === "m" ? (CCHID ? -6 : -11) : (CCHID ? -2 : -8); }
  function liftCues(v) {
    var ln = ccLineNow();
    try {
      var tt = v.textTracks;
      for (var k = 0; k < tt.length; k++) {
        var cs = tt[k].mode === "showing" && tt[k].cues;
        if (!cs) continue;
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          c.snapToLines = true; c.line = ln;
          try { c.position = "auto"; c.align = "center"; c.size = 100; } catch (e2) {}
        }
      }
    } catch (e) {}
  }
  // the browser repaints a caption that is already on screen only after the track is toggled
  function refreshCC(v) {
    try { var tt = v.textTracks; for (var k = 0; k < tt.length; k++) if (tt[k].mode === "showing") { tt[k].mode = "hidden"; tt[k].mode = "showing"; } } catch (e) {}
  }
  // keep the chosen captions across a server switch: reuse the attached track, otherwise attach it again
  function keepSub(v) {
    var t = /^\d+$/.test(SUBSEL) && v.querySelector("track");
    if (t) { showOnly(v, t); liftCues(v); refreshCC(v); } else applySub();
  }
  function showOnly(v, tr) {
    try { var tt = v.textTracks; for (var i = 0; i < tt.length; i++) tt[i].mode = tr && tt[i] === tr.track ? "showing" : "disabled"; } catch (e) {}
  }
  function applySub() {
    var v = document.querySelector("#player video, #smplayer video");
    if (!v) return;
    var tok = ++SUBTOK;
    dropTracks(v);
    if (SUBSEL === "") { showOnly(v, null); return; }
    if (/^h/.test(SUBSEL)) return;                 // an HLS track is switched through hls.subtitleTrack
    var sb = SUBS[+SUBSEL];
    if (!sb) return;
    function attach(u, mine) {
      if (tok !== SUBTOK) { if (mine) { try { URL.revokeObjectURL(u); } catch (e) {} } return; }
      if (mine) SUBBLOB = u;
      var tr = document.createElement("track");
      tr.kind = "subtitles"; tr.label = subName(sb); tr.srclang = String(sb.lang).slice(0, 2); tr.src = u; tr.default = true;
      v.appendChild(tr);
      showOnly(v, tr);
      try { tr.track.mode = "showing"; } catch (e) {}
      // lift the captions clear of the control bar (cue line counts from the bottom edge)
      tr.addEventListener("load", function () { liftCues(v); });
    }
    if (sb.b) { attach(sb.b, false); return; }     // uploads are already a WEBVTT blob
    // fetched through the Worker (CORS-safe, text/vtt), converted to WEBVTT and attached as a blob
    fetch(sb.u).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) {
      attach(URL.createObjectURL(new Blob([toVtt(t)], { type: "text/vtt" })), true);
    }).catch(function () { attach(sb.u, false); });
  }
  function loadSubs(mt, id, s, e) {
    SUBS = []; SUBA = []; SUBT = []; SUBU = []; SUBSEL = ""; SUBUSER = false; SUBEN = false; SUBHKEY = "";
    var box = $("smsubs");
    if (!box) return;
    box.textContent = "";
    api("/api/subs?type=" + mt + "&id=" + encodeURIComponent(id) + "&s=" + (s || 1) + "&e=" + (e || 1), 0, 20000).then(function (list) {
      if (!list || !list.length) return;
      SUBA = list; rebuildSubs();
      var sel = h("select", "ainp");
      sel.style.cssText = "margin:0 16px 8px;width:calc(100% - 32px)";
      var o0 = h("option", null, "Subtitles: Off"); o0.value = ""; sel.appendChild(o0);
      list.forEach(function (x, i) {
        var o = h("option", null, "Subtitles: " + (LANGS[x.lang] || x.lang) + (x.n > 1 ? " " + x.n : "")); o.value = String(i); sel.appendChild(o);
      });
      sel.onchange = function () { SUBUSER = true; SUBSEL = sel.value; rebuildSubs(); applySub(); if (PLSUBREFRESH) PLSUBREFRESH(); };
      box.appendChild(sel);
      autoPick();
      sel.value = /^\d+$/.test(SUBSEL) && +SUBSEL < list.length ? SUBSEL : "";
      if (PLSUBREFRESH) { PLSUBREFRESH(); applySub(); }
    }).catch(function () {});
  }
  function RELAY_ON() { return lsGet("boa_relay", "0") === "1"; }
  // Address of the Cloudflare Worker. The page is served from it, so this is normally the page's own address; stream relay links and
  // subtitle links always point here, never at a Render server (Render never carries video).
  var WBASE = "@@WBASE@@";
  function wbase() { return /^https:\/\//i.test(WBASE) ? WBASE.replace(/\/+$/, "") : location.origin; }
  // Returns a signed relay address, or "" when the relay can't be reached (callers never fall back to a direct link silently).
  function relaySign(u, st0) {
    var hq = st0 && st0.headers ? "&h=" + encodeURIComponent(JSON.stringify(st0.headers)) : "";
    return api("/api/relay-sign?u=" + encodeURIComponent(u) + hq, 0, 15000).then(function (r) { return wbase() + r.u; }).catch(function () { toast(RELAY_ON() ? "Privacy relay unavailable" : "Stream proxy unavailable"); return ""; });
  }
  function paintPriv() {
    var b = $("smpriv");
    if (!b) return;
    b.textContent = "";
    var cb = h("input"); cb.type = "checkbox"; cb.checked = RELAY_ON();
    cb.onchange = function () { lsSet("boa_relay", cb.checked ? "1" : "0"); toast(cb.checked ? "Privacy relay ON for new plays" : "Privacy relay OFF"); };
    var l = h("label");
    l.style.cssText = "display:flex;align-items:center;gap:10px";
    l.appendChild(cb);
    l.appendChild(document.createTextNode("Privacy relay (optional): hide my IP from the stream host"));
    b.appendChild(l);
    var st = h("div", "ipst");
    b.appendChild(st);
    function status() {
      if (!cb.checked) {
        st.style.color = "#a3a3a8";
        st.textContent = "Direct (No Relay) \u2022 the stream host sees your own connection";
        return;
      }
      st.style.color = "#a3a3a8";
      st.textContent = "Checking relay\u2026";
      var ctl = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
      fetch(wbase() + "/api/relay-check", { cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.json(); }).then(function (j) {
        clearTimeout(to);
        if (!cb.checked) return;
        var host = wbase().replace(/^https?:\/\//i, "");
        if (!j || !j.ok) { st.style.color = "#f59e0b"; st.textContent = "Relay status could not be confirmed"; return; }
        if (j.masked === true) { st.style.color = "#46d369"; st.textContent = "Relay active \u2022 via " + host + " \u2022 exit IP " + j.ip; }
        else if (j.masked === false) { st.style.color = "#f59e0b"; st.textContent = "Direct (No Relay) \u2022 this relay runs on your own connection, so it doesn't hide your IP"; }
        else { st.style.color = "#46d369"; st.textContent = "Relay active \u2022 via " + host + " \u2022 exit IP not confirmed"; }
      }).catch(function () { clearTimeout(to); if (!cb.checked) return; st.style.color = "#f59e0b"; st.textContent = "Relay status could not be confirmed"; });
    }
    var prev = cb.onchange;
    cb.onchange = function () { prev(); status(); };
    status();
  }
  var LIBF = "all", LIBSORT = "recent", LIBEDIT = false;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function pById(id) { for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === id) return PROFILES[i]; return null; }
  function curProfile() { return pById(PID) || PROFILES[0]; }
  function tgName() {
    var u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return u && u.first_name ? u.first_name : "";
  }
  function profilesSave() {
    var s = JSON.stringify(PROFILES);
    lsSet("boa_profiles", s);
    if (cloud) { try { cloud.setItem("profiles", s); } catch (e) {} }
  }
  function profilesLoad() {
    try { PROFILES = JSON.parse(lsGet("boa_profiles", "[]")) || []; } catch (e) { PROFILES = []; }
    if (!PROFILES.length) { PROFILES = [{ id: "p1", n: tgName() || "Me", c: 0 }]; lsSet("boa_profiles", JSON.stringify(PROFILES)); }
    PID = lsGet("boa_pid", PROFILES[0].id);
    if (!pById(PID)) PID = PROFILES[0].id;
    if (cloud) {
      try {
        cloud.getItem("profiles", function (err, v) {
          if (err || !v) { profilesSave(); return; }
          try {
            var arr = JSON.parse(v);
            if (arr && arr.length && arr.length >= PROFILES.length) {
              PROFILES = arr;
              lsSet("boa_profiles", v);
              if (!pById(PID)) PID = PROFILES[0].id;
              refreshAll();
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
  }
  function libKey(mt, id) { return "l_" + PID + "_" + mt + "_" + id; }
  function watchKey(mt, id) { return "w_" + PID + "_" + mt + "_" + id; }
  function libIdx(mt, id) {
    for (var i = 0; i < LIB.length; i++) if (LIB[i].m === mt && String(LIB[i].i) === String(id)) return i;
    return -1;
  }
  function syncLibBadges() {
    Array.prototype.forEach.call(document.querySelectorAll(".card[data-k]"), function (c) {
      var po = c.firstChild;
      if (!po || c.getAttribute("data-nl")) return;
      var k = c.getAttribute("data-k").split("_");
      var has = libHas(k[0], k.slice(1).join("_"));
      var ex = po.querySelector(".inlib");
      if (has && !ex) po.appendChild(h("span", "inlib", "\u2713"));
      if (!has && ex) ex.remove();
    });
  }
  function libSaveLocal() { lsSet("boa_lib_" + PID, JSON.stringify(LIB)); syncLibBadges(); }
  function watchSaveLocal() { lsSet("boa_watch_" + PID, JSON.stringify(WATCH)); }
  function refreshAll() {
    paintNavAvatar();
    syncLibBadges();
    if (tab === "lib") renderLib();
    if (tab === "me") renderMe();
  }
  function dataLoad() {
    var raw = lsGet("boa_lib_" + PID, null);
    if (raw == null && PID === "p1") raw = lsGet("boa_lib", "[]");
    try { LIB = JSON.parse(raw || "[]") || []; } catch (e) { LIB = []; }
    try { WATCH = JSON.parse(lsGet("boa_watch_" + PID, "[]")) || []; } catch (e) { WATCH = []; }
    if (!cloud) return;
    var pid = PID;
    var pl = "l_" + pid + "_", pw = "w_" + pid + "_";
    try {
      cloud.getKeys(function (err, keys) {
        if (err || !keys || !keys.length || pid !== PID) return;
        var want = keys.filter(function (k) {
          if (k.indexOf(pl) === 0 || k.indexOf(pw) === 0) return true;
          return pid === "p1" && /^l_(movie|tv)_/.test(k);
        }).slice(0, 100);
        if (!want.length) return;
        cloud.getItems(want, function (err2, vals) {
          if (err2 || !vals || pid !== PID) return;
          var changed = false;
          want.forEach(function (k) {
            try {
              var o = JSON.parse(vals[k]);
              if (!o || !o.m || !o.i) return;
              if (k.charAt(0) === "l") {
                if (libIdx(o.m, o.i) < 0) { LIB.push(o); changed = true; }
              } else {
                var w = watchGet(o.m, o.i);
                if (!w) { WATCH.push(o); changed = true; }
                else if ((o.a || 0) > (w.a || 0)) { WATCH[WATCH.indexOf(w)] = o; changed = true; }
              }
            } catch (e) {}
          });
          if (changed) { libSaveLocal(); watchSaveLocal(); refreshAll(); }
        });
      });
    } catch (e) {}
  }
  function libHas(mt, id) { return libIdx(mt, id) > -1; }
  function libToggle(d) {
    var i = libIdx(d.mt, d.id);
    if (i > -1) {
      LIB.splice(i, 1);
      if (cloud) { try { cloud.removeItem(libKey(d.mt, d.id)); } catch (e) {} }
      toast("Removed from Library");
    } else {
      var p = d.p || d.b || null;
      if (p && p.length > 200) p = null;
      var o = { m: d.mt, i: d.id, t: d.t, p: p, y: d.y || "", a: Date.now() };
      LIB.unshift(o);
      if (LIB.length > 150) LIB.length = 150;
      if (cloud) { try { cloud.setItem(libKey(d.mt, d.id), JSON.stringify(o)); } catch (e) {} }
      toast("Added to Library");
    }
    libSaveLocal();
  }
  function libRemove(mt, id) {
    var i = libIdx(mt, id);
    if (i > -1) LIB.splice(i, 1);
    if (cloud) { try { cloud.removeItem(libKey(mt, id)); } catch (e) {} }
    libSaveLocal();
  }
  function paintLibBtn(d) {
    $("dlib").innerHTML = libHas(d.mt, d.id) ? ICON.check : ICON.plus;
    $("dlib").setAttribute("aria-label", libHas(d.mt, d.id) ? "Remove from library" : "Add to library");
  }
  // ----- watch history (Continue Watching / Watch Next) -----
  function watchGet(mt, id) {
    for (var i = 0; i < WATCH.length; i++) if (WATCH[i].m === mt && String(WATCH[i].i) === String(id)) return WATCH[i];
    return null;
  }
  function watchPush(o, force) {
    var now = Date.now();
    if (!force && o._cl && now - o._cl < 20000) return;
    o._cl = now;
    if (cloud) {
      var c = {}; for (var k in o) if (k !== "_cl") c[k] = o[k];
      try { cloud.setItem(watchKey(o.m, o.i), JSON.stringify(c)); } catch (e) {}
    }
  }
  function watchDrop(mt, id) {
    var w = watchGet(mt, id);
    if (w) WATCH.splice(WATCH.indexOf(w), 1);
    if (cloud) { try { cloud.removeItem(watchKey(mt, id)); } catch (e) {} }
    watchSaveLocal();
  }
  function recordWatch(c, pos, dur, force) {
    if (!c) return;
    var w = watchGet(c.mt, c.id);
    if (!w) {
      w = { m: c.mt, i: c.id, t: c.base || c.title, p: (c.meta && c.meta.p) || null, y: (c.meta && c.meta.y) || "", b: (c.meta && c.meta.b) || null };
      if (w.p && w.p.length > 200) w.p = null;
      WATCH.unshift(w);
      if (WATCH.length > 60) { var old = WATCH.pop(); if (cloud) { try { cloud.removeItem(watchKey(old.m, old.i)); } catch (e) {} } }
    }
    if (c.meta && c.meta.b && !w.b) w.b = c.meta.b;
    w.s = c.s || 1; w.e = c.e || 1; w.nx = 0;
    w.pos = Math.floor(pos || 0); w.dur = Math.floor(dur || 0); w.a = Date.now();
    if (c.mt === "movie" && dur > 60 && pos / dur > 0.93) { watchDrop(c.mt, c.id); return; }
    if (c.mt === "tv" && dur > 60 && pos / dur > 0.93) { w.e = w.e + 1; w.pos = 0; w.dur = 0; w.nx = 1; force = true; }
    watchSaveLocal();
    watchPush(w, force);
  }
  function watchClear() {
    WATCH.forEach(function (w) { if (cloud) { try { cloud.removeItem(watchKey(w.m, w.i)); } catch (e) {} } });
    WATCH = [];
    watchSaveLocal();
  }
  function trackVideo(v, c) {
    var last = 0;
    v.onloadedmetadata = function () {
      if (c.resumeAt > 10 && v.duration && c.resumeAt < v.duration - 30) { try { v.currentTime = c.resumeAt; } catch (e) {} }
    };
    v.ontimeupdate = function () {
      var now = Date.now();
      if (now - last < 4000) return;
      last = now;
      if (v.currentTime > 5) recordWatch(c, v.currentTime, v.duration || 0, false);
    };
    v.onpause = function () { if (v.currentTime > 5) recordWatch(c, v.currentTime, v.duration || 0, true); };
    v.onended = function () { recordWatch(c, v.duration || 1, v.duration || 1, true); };
  }
  // ----- unreleased titles -----
  function isUnreleased(m) {
    var today = new Date().toISOString().slice(0, 10);
    if (m && m.d && /^\d{4}-\d{2}-\d{2}/.test(m.d)) return m.d.slice(0, 10) > today;
    if (m && m.y && /^\d{4}$/.test(String(m.y))) return +m.y > new Date().getFullYear();
    return false;
  }
  // ----- Who's watching -----
  function avatarEl(p, cls) {
    var a = h("div", cls || "pav", String(p.n || "?").charAt(0).toUpperCase());
    a.style.background = AVC[(p.c || 0) % AVC.length];
    return a;
  }
  function setProfile(id) {
    if (!pById(id)) return;
    PID = id;
    lsSet("boa_pid", id);
    dataLoad();
    closeProfiles();
    refreshAll();
    toast("Watching as " + curProfile().n);
  }
  var GATE_ON = false;
  function closeProfiles() {
    var b = $("profiles");
    if (GATE_ON) {
      GATE_ON = false; window.__boaGateOpen = false;
      b.className = "open fade";
      if (window.__boaUnlock) window.__boaUnlock();
      setTimeout(function () { if (b.className.indexOf("fade") > -1) b.className = ""; }, 480);
      setTimeout(startNotices, 700);
      return;
    }
    b.className = "";
  }
  function openProfiles(manage) {
    var box = $("profiles");
    box.textContent = "";
    box.className = "open";
    box.appendChild(h("h1", null, manage === "edit" ? "Manage profiles" : "Who's Watching?"));
    var grid = h("div", "pfgrid");
    PROFILES.forEach(function (p) {
      var b = h("button", "who");
      var av = avatarEl(p);
      if (manage === "edit") av.appendChild(h("span", "pen", "✎"));
      b.appendChild(av);
      b.appendChild(h("span", null, p.n));
      if (p.id === PID && manage !== "edit") b.className = "who cur";
      b.onclick = function () { if (manage === "edit") editProfile(p); else setProfile(p.id); };
      grid.appendChild(b);
    });
    if (PROFILES.length < 5) {
      var add = h("button", "who");
      var pl = h("div", "pav add", "+");
      add.appendChild(pl);
      add.appendChild(h("span", null, "Add profile"));
      add.onclick = function () {
        var np = { id: "p" + Date.now().toString(36), n: "Profile " + (PROFILES.length + 1), c: PROFILES.length % AVC.length };
        PROFILES.push(np);
        profilesSave();
        editProfile(np);
      };
      grid.appendChild(add);
    }
    box.appendChild(grid);
    var mb = h("button", "pfbtn", manage === "edit" ? "Done" : "Manage profiles");
    mb.onclick = function () { openProfiles(manage === "edit" ? false : "edit"); };
    box.appendChild(mb);
    if (manage !== "edit" && manage !== false) {
      var cl = h("button", "pfbtn ghost", "Close");
      cl.onclick = closeProfiles;
      box.appendChild(cl);
    }
  }
  function editProfile(p) {
    var box = $("profiles");
    box.textContent = "";
    box.className = "open";
    box.appendChild(h("h1", null, "Edit profile"));
    var av = avatarEl(p, "pav big");
    box.appendChild(av);
    var inp = h("input", "ainp pfin");
    inp.type = "text"; inp.maxLength = 16; inp.value = p.n;
    inp.oninput = function () { av.textContent = (inp.value || "?").charAt(0).toUpperCase(); };
    box.appendChild(inp);
    var sw = h("div", "pfsw");
    AVC.forEach(function (c, i) {
      var s = h("button", "sw" + ((p.c || 0) === i ? " on" : ""));
      s.style.background = c;
      s.onclick = function () {
        p.c = i; av.style.background = c;
        Array.prototype.forEach.call(sw.children, function (x) { x.className = "sw"; });
        s.className = "sw on";
      };
      sw.appendChild(s);
    });
    box.appendChild(sw);
    var save = h("button", "pfbtn", "Save");
    save.onclick = function () {
      p.n = (inp.value || "").trim() || "Profile";
      profilesSave();
      openProfiles("edit");
      refreshAll();
    };
    box.appendChild(save);
    if (PROFILES.length > 1) {
      var del = h("button", "pfbtn danger", "Delete profile");
      del.onclick = function () {
        function go() {
          if (cloud) {
            var pre1 = "l_" + p.id + "_", pre2 = "w_" + p.id + "_";
            try { cloud.getKeys(function (e, ks) { (ks || []).forEach(function (k) { if (k.indexOf(pre1) === 0 || k.indexOf(pre2) === 0) { try { cloud.removeItem(k); } catch (x) {} } }); }); } catch (e) {}
          }
          try { localStorage.removeItem("boa_lib_" + p.id); localStorage.removeItem("boa_watch_" + p.id); } catch (e) {}
          PROFILES = PROFILES.filter(function (x) { return x.id !== p.id; });
          profilesSave();
          if (PID === p.id) { PID = PROFILES[0].id; lsSet("boa_pid", PID); dataLoad(); }
          openProfiles("edit");
          refreshAll();
        }
        if (tg && tg.showConfirm) { try { tg.showConfirm("Delete " + p.n + " and its library?", function (ok) { if (ok) go(); }); return; } catch (e) {} }
        if (window.confirm("Delete " + p.n + " and its library?")) go();
      };
      box.appendChild(del);
    }
    var back = h("button", "pfbtn ghost", "Back");
    back.onclick = function () { openProfiles("edit"); };
    box.appendChild(back);
  }

  // ---------- install app (PWA) ----------
  var DEFER = null;
  function isStandalone() { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; }
  function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function inTelegram() { return !!(tg && tg.initData); }
  window.addEventListener("beforeinstallprompt", function (ev) {
    ev.preventDefault();
    DEFER = ev;
    if (lsGet("boa_inst_x", "0") !== "1" && !isStandalone() && !inTelegram()) $("instbar").className = "on";
    if (tab === "me") renderMe();
  });
  window.addEventListener("appinstalled", function () { DEFER = null; $("instbar").className = ""; if (tab === "me") renderMe(); toast("Boa Cinema installed"); });
  function doInstall() {
    if (!DEFER) return;
    DEFER.prompt();
    DEFER.userChoice.then(function () { DEFER = null; $("instbar").className = ""; if (tab === "me") renderMe(); });
  }
  $("instgo").onclick = doInstall;
  $("instx").onclick = function () { lsSet("boa_inst_x", "1"); $("instbar").className = ""; };
  function installCard() {
    if (isStandalone()) return null;
    var c = h("div", "instcard");
    c.appendChild(h("h4", null, "Install Boa Cinema"));
    var x = h("button", "cls", "\u00D7");
    x.setAttribute("aria-label", "Dismiss");
    x.onclick = function () { lsSet("boa_inst_c", "1"); renderMe(); };
    if (lsGet("boa_inst_c", "0") === "1") return null;
    c.appendChild(x);
    if (inTelegram()) {
      c.appendChild(h("p", null, "To install, open the site in your phone's browser (Chrome on Android, Safari on iPhone), then add it to your home screen."));
      var ob = h("button", "pfbtn", "Open in browser");
      ob.onclick = function () { openLink(location.origin + "/app"); };
      c.appendChild(ob);
    } else if (DEFER) {
      c.appendChild(h("p", null, "Add Boa Cinema to your home screen for one-tap launch and a full-screen app feel."));
      var ib = h("button", "pfbtn", "Install App");
      ib.onclick = doInstall;
      c.appendChild(ib);
    } else if (isIOS()) {
      c.appendChild(h("p", null, "Tap the Share button in Safari, then choose \"Add to Home Screen\"."));
    } else {
      c.appendChild(h("p", null, "Open your browser menu and choose \"Install app\" or \"Add to Home screen\". If you don't see it, reload the page once and try again."));
    }
    return c;
  }

  // ---------- custom video player (Netflix style) ----------
  var HLS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
  var PLSUBREFRESH = null;
  var PI = {
    play: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><em>10</em>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg><em>10</em>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="#fff"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="#fff"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    pip: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1" fill="#fff"/></svg>',
    amb: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
    fs: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  function loadHls(cb) {
    if (window.Hls) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = HLS_URL;
    sc.onload = function () { cb(); };
    sc.onerror = function () { cb(); };
    document.head.appendChild(sc);
  }
  function loadDash(cb) {
    if (window.dashjs) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js";
    sc.onload = function () { cb(); };
    sc.onerror = function () { cb(); };
    document.head.appendChild(sc);
  }
  function vlcLink(u) {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) return "vlc://" + u;
    return "intent://" + String(u).replace(/^https?:\/\//i, "") + "#Intent;scheme=" + (/^http:/i.test(u) ? "http" : "https") + ";package=org.videolan.vlc;type=video/*;end";
  }
  // ---------- in-browser torrent playback: WebTorrent over WebRTC, no Debrid ----------
  // The WebTorrent script is fetched only when someone taps a torrent stream. It can only reach WebRTC-capable peers, so when none
  // connect within about 12 s the player stops cleanly and offers Open in Odyssey / Copy magnet link instead of freezing.
  var WT_SRC = "https://cdn.jsdelivr.net/npm/webtorrent@1.9.7/webtorrent.min.js";
  var WT_TR = ["wss://tracker.openwebtorrent.com", "wss://tracker.webtorrent.dev", "wss://tracker.btorrent.xyz", "wss://tracker.fastcast.nz"];
  var WT_LOAD = null, TP_CLOSE = null;
  function wtLoad() {
    if (window.WebTorrent) return Promise.resolve();
    if (WT_LOAD) return WT_LOAD;
    WT_LOAD = new Promise(function (res, rej) {
      var sc = document.createElement("script"), t = setTimeout(function () { rej(new Error("load")); }, 10000);
      sc.src = WT_SRC; sc.async = true;
      sc.onload = function () { clearTimeout(t); if (window.WebTorrent) res(); else rej(new Error("load")); };
      sc.onerror = function () { clearTimeout(t); rej(new Error("load")); };
      document.head.appendChild(sc);
    }).catch(function (e) { WT_LOAD = null; throw e; });
    return WT_LOAD;
  }
  function wtSpeed(b) { b = b || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + " MB/s" : Math.round(b / 1024) + " KB/s"; }
  function openTorrent(st) {
    var magnet = String((st && st.url) || "");
    if (!/^magnet:\?/i.test(magnet)) { toast("This torrent link can't be opened"); return; }
    if (TP_CLOSE) TP_CLOSE();
    var root = $("tplayer");
    root.textContent = "";
    root.className = "open";
    document.body.style.overflow = "hidden";
    var client = null, tick = null, gone = false, failed = false, playing = false, picked = false, t0 = Date.now(), tor = null;
    var v = document.createElement("video");
    v.controls = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", ""); v.preload = "auto"; v.style.display = "none";
    root.appendChild(v);
    var bar = h("div", "tbar"), ttl = h("div", "ttl", (st && st.title) || "Torrent"), xb = h("button", "tx", "×");
    xb.setAttribute("aria-label", "Close"); xb.type = "button";
    bar.appendChild(ttl); bar.appendChild(xb); root.appendChild(bar);
    var panel = h("div", "tpanel"), pt = h("h3", null, "Torrent (no Debrid)"), pm = h("p", null, "Starting…");
    var stats = h("div", "tstats"), sPeers = h("div"), sSpeed = h("div"), sProg = h("div");
    [[sPeers, "Peers"], [sSpeed, "Speed"], [sProg, "Loaded"]].forEach(function (x) { x[0].appendChild(h("b", null, "0")); x[0].appendChild(document.createTextNode(x[1])); stats.appendChild(x[0]); });
    var pb = h("div", "tbarp"), pbi = h("i"); pb.appendChild(pbi);
    panel.appendChild(pt); panel.appendChild(pm); panel.appendChild(stats); panel.appendChild(pb);
    root.appendChild(panel);
    panel.setAttribute("role", "status"); panel.setAttribute("aria-live", "polite");

    function stop() {
      if (tick) { clearInterval(tick); tick = null; }
      var c = client; client = null; tor = null;
      if (c) { try { c.destroy(); } catch (e) {} }
    }
    function close() {
      if (gone) return;
      gone = true; TP_CLOSE = null;
      stop();
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
      root.textContent = "";
      root.className = "";
      document.body.style.overflow = "";
    }
    TP_CLOSE = close;
    xb.onclick = close;
    function fail(reason) {
      if (gone || failed) return;
      failed = true;
      stop();
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
      v.style.display = "none";
      panel.textContent = "";
      panel.appendChild(h("h3", null, "Can't stream this one here"));
      panel.appendChild(h("p", null, reason + " You can open it in Odyssey or copy the magnet link."));
      var bt = h("div", "tbtns");
      var b1 = h("button", "tb1", "Open in Odyssey"); b1.type = "button";
      b1.onclick = function () {
        location.href = odysseyLink(magnet, (st && st.title) || "", null);
        setTimeout(function () { if (!document.hidden) toast("Odyssey isn't installed on this device"); }, 1500);
      };
      var b2 = h("button", "tb2", "Copy Magnet Link"); b2.type = "button";
      b2.onclick = function () {
        try { navigator.clipboard.writeText(magnet).then(function () { toast("Magnet link copied"); }, function () { toast("Couldn't copy the link"); }); } catch (e) { toast("Couldn't copy the link"); }
      };
      bt.appendChild(b1); bt.appendChild(b2); panel.appendChild(bt);
    }
    function paint() {
      if (gone || failed) return;
      var el = Math.floor((Date.now() - t0) / 1000), peers = tor ? tor.numPeers : 0;
      sPeers.firstChild.textContent = String(peers);
      sSpeed.firstChild.textContent = tor ? wtSpeed(tor.downloadSpeed) : "0 KB/s";
      var pr = tor ? Math.max(0, Math.min(1, tor.progress || 0)) : 0;
      sProg.firstChild.textContent = Math.round(pr * 100) + "%";
      pbi.style.transform = "scaleX(" + pr + ")";
      if (playing) return;
      if (!tor || !tor.numPeers) {
        pm.textContent = "Looking for peers… " + el + "s";
        if (el >= 12) fail("No browser peers connected.");
      } else if (!picked) {
        pm.textContent = "Connected to " + peers + " peer" + (peers === 1 ? "" : "s") + ". Reading the file list…";
        if (el >= 30) fail("The file list never arrived.");
      } else {
        pm.textContent = "Buffering… " + peers + " peer" + (peers === 1 ? "" : "s") + " • " + wtSpeed(tor.downloadSpeed);
        if (el >= 45 && !tor.downloaded) fail("Peers connected but sent no data.");
      }
    }
    v.addEventListener("playing", function () { playing = true; panel.style.display = "none"; });
    v.addEventListener("waiting", function () { if (playing && !gone && !failed) { panel.style.display = ""; pm.textContent = "Buffering…"; playing = false; } });
    v.addEventListener("error", function () { fail("This video format can't play in a browser."); });
    function startWT() {
    pm.textContent = "Starting torrent engine\u2026";
    wtLoad().then(function () {
      if (gone) return;
      t0 = Date.now();
      try {
        client = new window.WebTorrent({ maxConns: 40 });
        client.on("error", function () { fail("The torrent engine reported an error."); });
        tor = client.add(magnet, { announce: WT_TR }, function (t) {
          if (gone || failed) return;
          tor = t;
          var vids = t.files.filter(function (f) { return /\.(mp4|m4v|webm|mov)$/i.test(f.name); }).sort(function (a, b) { return b.length - a.length; });
          if (!vids.length) { fail("This torrent has no browser-playable file (it uses MKV or AVI)."); return; }
          var f = vids[0];
          t.files.forEach(function (x) { if (x !== f) { try { x.deselect(); } catch (e) {} } });
          picked = true;
          v.style.display = "";
          f.renderTo(v, { autoplay: true, controls: true }, function (err) { if (err) fail("This video format can't play in a browser."); });
        });
      } catch (e) { fail("The torrent engine couldn't start."); return; }
      tick = setInterval(function () { if (!tor && client && client.torrents && client.torrents[0]) tor = client.torrents[0]; paint(); }, 500);
      paint();
    }).catch(function () { fail("The torrent engine couldn't load."); });
    }
    // 1) torrent bridge (if the owner set one): the answer is a direct HTTP/HLS link played in the normal player; 2) browser WebRTC peers
    pm.textContent = "Checking for a torrent bridge\u2026";
    var bt0 = Date.now();
    tick = setInterval(function () { if (!gone && !failed) pm.textContent = "Asking the torrent bridge\u2026 " + Math.floor((Date.now() - bt0) / 1000) + "s"; }, 1000);
    api("/api/torrent-bridge?m=" + encodeURIComponent(magnet), 0, 25000).then(function (r) {
      if (tick) { clearInterval(tick); tick = null; }
      if (gone) return;
      if (r && r.ok && r.url) {
        var bu = r.url, bs = { title: (st && st.title) || "Torrent", url: bu, provider: "Torrent bridge", quality: (st && st.quality) || "" };
        close();
        openPlayer(bu, bs);
        return;
      }
      startWT();
    }).catch(function () {
      if (tick) { clearInterval(tick); tick = null; }
      if (!gone) startWT();
    });
  }

  // ---------- click-time size check ----------
  // Runs only when a stream/server is clicked (never while the server list is drawn, which uses the metadata already fetched).
  // Metadata size known and inside the limit = start at once; otherwise the real size is read from the host (1 byte, max ~3.5 s, then it just plays).
  var SZC = {}, SZP = {}, SZN = 0;
  function stGB(x) {
    var m = /(\d+(?:\.\d+)?)\s?(GB|GiB|MB|MiB)/i.exec(String((x && x.title) || "") + " " + String((x && x.name) || "") + " " + (x && typeof x.size === "string" ? x.size : ""));
    if (m) return /G/i.test(m[2]) ? +m[1] : +m[1] / 1024;
    var b = x ? +x.size : 0;
    return b > 1048576 ? b / 1073741824 : 0;
  }
  function sizeCheck(st0) {
    var u = String((st0 && st0.url) || "");
    if (!/^https?:/i.test(u) || /\.(m3u8|mpd)(\?|$)|\/embed\/|\.html?($|\?)/i.test(u)) return Promise.resolve({ state: "unknown" });
    if (SZC[u]) return Promise.resolve(SZC[u]);
    if (SZP[u]) return SZP[u];
    var p = new Promise(function (res) {
      var done = false, t = setTimeout(function () { fin({ state: "unknown" }); }, 3500);
      function fin(r) {
        if (done) return; done = true; clearTimeout(t); delete SZP[u];
        if (r.state === "ok" || r.state === "invalid") { SZC[u] = r; if (++SZN > 80) { SZC = {}; SZN = 0; } }
        res(r);
      }
      var hq = st0.headers ? "&h=" + encodeURIComponent(JSON.stringify(st0.headers)) : "";
      api("/api/relay-sign?u=" + encodeURIComponent(u) + hq, 0, 3000)
        .then(function (sg) { return api(String(sg.u).replace("/api/relay?", "/api/size?"), 0, 4000); })
        .then(function (j) { fin(j && j.ok ? j : { state: "unknown" }); })
        .catch(function () { fin({ state: "unknown" }); });
    });
    SZP[u] = p;
    return p;
  }
  function askBig(msg, yes) {
    if (tg && tg.showConfirm) { try { tg.showConfirm(msg, function (ok) { if (ok) yes(); }); return; } catch (e) {} }
    if (window.confirm(msg)) yes();
  }
  // go() is called when the stream may start. note = the small status line under a server card (or null inside the player).
  function sizeGate(st0, metaGB, note, go) {
    var lim = MAXG === "inf" ? 0 : MAXG === "auto" ? 5 : +MAXG;
    var limTxt = MAXG === "auto" ? "5 GB Auto" : MAXG + " GB";
    function say(t) { if (note) note.textContent = t; else if (t) toast(t); }
    function fmt(gb) { return gb >= 1 ? gb.toFixed(1) + " GB" : Math.max(1, Math.round(gb * 1024)) + " MB"; }
    function over(gb) {
      var m = "This file is " + fmt(gb) + ", over your " + limTxt + " limit.";
      say(m);
      askBig(m + " Play anyway?", function () { say(""); go(); });
    }
    if (metaGB > 0) {
      if (lim && metaGB > lim) over(metaGB); else go();
      return;
    }
    if (note) note.textContent = "Checking size…";
    sizeCheck(st0).then(function (r) {
      if (note && note.textContent === "Checking size…") note.textContent = "";
      if (r.state === "invalid") {
        var m = "This link reports an invalid file size, so it may be broken.";
        say(m);
        askBig(m + " Try anyway?", function () { say(""); go(); });
      } else if (r.state === "ok" && lim && r.gb > lim) over(r.gb);
      else go();
    });
  }

  // odyssey://play?url=<direct stream>&title=&sub=&headers=  The stream link is always the real upstream address (never a relay link).
  function odysseyLink(u, title, st0) {
    var q = "url=" + encodeURIComponent(u);
    if (title) q += "&title=" + encodeURIComponent(String(title).slice(0, 120));
    var sb = /^\d+$/.test(SUBSEL) ? SUBS[+SUBSEL] : null, su = sb && sb.u ? String(sb.u) : "";
    if (su.charAt(0) === "/") su = wbase() + su;
    if (/^https?:\/\//i.test(su)) q += "&sub=" + encodeURIComponent(su);
    if (st0 && st0.headers) { try { var hs = JSON.stringify(st0.headers); if (hs && hs !== "{}" && hs.length < 700) q += "&headers=" + encodeURIComponent(hs); } catch (e) {} }
    return "odyssey://play?" + q;
  }
  function fmtT(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60);
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return hh ? hh + ":" + p2(mm) + ":" + p2(ss) : p2(mm) + ":" + p2(ss);
  }
  function pbtn(html, label) {
    var b = h("button", "pbtn");
    b.innerHTML = html;
    b.setAttribute("aria-label", label);
    return b;
  }
  function detailLabel(d) {
    var w = watchGet(d.mt, d.id);
    if (isUnreleased(d)) return d.d ? "Releases " + fmtDate(d.d) : "Not released yet";
    if (d.mt === "tv") return w ? ((w.nx ? "Next: S" : "Resume S") + (w.s || 1) + " E" + (w.e || 1)) : "Play S1 E1";
    if (w && !w.nx) return "Resume" + (w.dur > 0 && w.pos > 0 ? " • " + Math.max(1, Math.round((w.dur - w.pos) / 60)) + "m left" : "");
    return "Play";
  }
  function openPlayer(url, st) {
    var ctx = CUR;
    var root = $("player");
    root.textContent = "";
    root.className = "open";
    document.body.style.overflow = "hidden";
    try { if (tg && tg.expand) tg.expand(); } catch (e) {}
    var hls = null, relayed = false, retried = false, hideT = null, saveT = null, seeking = false, closed = false, ambT = null, finished = false, adActive = false, adcfg = null, midAt = 0, midDone = false, midPlanned = false, prefetch = null, startAt = ctx ? ctx.resumeAt : 0;

    if (root.parentNode !== document.body) document.body.appendChild(root);
    window.__vPlaying = function () { return !closed && !adActive && !v.paused && !v.ended; };
    var srcGen = 0, triedU = {}, autoN = 0, curSt = st, probed = {}, whyEl = null, failedU = {}, dead = false, hadFail = {}, upd = {}, chkAt = {};
    var tried = {}, bad = {}, curSrv = -1, why = "", stallT = null, nextInfo = null, nextShown = false, nextDismissed = false, nextT = null, nextEl = null, wasPlaying = false;
    (function () { var L0 = (ctx && ctx.servers) || []; for (var i0 = 0; i0 < L0.length; i0++) if (L0[i0].urls.indexOf(url) > -1) { curSrv = i0; tried[i0] = 1; } })();
    var dash = null, menuEl = null, seekAfter = 0, BRI = 1, gestEnd = 0, rate = 1, fitI = 0, mqL = null;
    var dimEl = h("div", "pdim"), hud = h("div", "phud"), hudT = null;
    var amb = document.createElement("canvas");
    amb.className = "pamb"; amb.width = 32; amb.height = 18;
    root.appendChild(amb);
    var v = document.createElement("video");
    v.className = "pvid";
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.crossOrigin = null;
    root.appendChild(v);

    var spin = h("div", "pspin");
    root.appendChild(spin);
    root.appendChild(dimEl); root.appendChild(hud);
    var msg = h("div", "pmsg");
    root.appendChild(msg);

    // top bar
    var top = h("div", "ptop");
    var ttl = h("div", "ptitle", ctx && ctx.title ? ctx.title : (st && st.title) || "Now playing");
    top.appendChild(ttl);
    var tr = h("div", "pright");
    var bPip = pbtn(PI.pip, "Picture in picture");
    var bAmb = pbtn(PI.amb, "Ambient light");
    var bFs = pbtn(PI.fs, "Fullscreen");
    var bX = pbtn(PI.x, "Close");
    var canPip = !!(document.pictureInPictureEnabled || (v.webkitSupportsPresentationMode && v.webkitSetPresentationMode));
    if (canPip) tr.appendChild(bPip);
    var bVlc = h("button", "ptxt", "VLC");
    bVlc.setAttribute("aria-label", "Open in VLC");
    bVlc.onclick = function () { v.pause(); if (RELAY_ON()) relaySign(url, curSt).then(function (ru) { if (ru) location.href = vlcLink(ru); }); else location.href = vlcLink(url); };
    tr.appendChild(bVlc);
    var bOdy = h("button", "ptxt", "Odyssey");
    bOdy.setAttribute("aria-label", "Open in Odyssey");
    bOdy.onclick = function () {
      if (!url || /^magnet:/i.test(url)) return;
      v.pause();
      location.href = odysseyLink(url, (ctx && ctx.title) || (st && st.title) || "", curSt);
      setTimeout(function () { if (!document.hidden) toast("Odyssey isn't installed on this device"); }, 1500);
    };
    tr.appendChild(bOdy);
    tr.appendChild(bAmb); tr.appendChild(bFs); tr.appendChild(bX);
    top.appendChild(tr);
    root.appendChild(top);

    // bottom bar
    var bot = h("div", "pbot");
    var scrub = h("div", "pscrub");
    var sbuf = h("i", "sbuf"), sfill = h("i", "sfill"), sthumb = h("b", "sthumb"), stip = h("span", "stip");
    scrub.appendChild(sbuf); scrub.appendChild(sfill); scrub.appendChild(sthumb); scrub.appendChild(stip);
    bot.appendChild(scrub);
    var row = h("div", "prow");
    var bPlay = pbtn(PI.play, "Play");
    var bBack = pbtn(PI.back, "Back 10 seconds");
    var bFwd = pbtn(PI.fwd, "Forward 10 seconds");
    var bMute = pbtn(PI.vol, "Mute");
    var vol = h("input", "pvol");
    vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05";
    vol.value = lsGet("boa_vol", "1");
    var tim = h("span", "ptime", "00:00 / 00:00");
    var sp = h("span", "pspace");
    var cc = h("select", "pcc");
    cc.setAttribute("aria-label", "Subtitles and closed captions");
    row.appendChild(bPlay); row.appendChild(bBack); row.appendChild(bFwd); row.appendChild(bMute); row.appendChild(vol); row.appendChild(tim); row.appendChild(sp); row.appendChild(cc);
    bot.appendChild(row);
    var row2 = h("div", "prow2");
    var bSpd = h("button", "ptxt", "1x"), bFit = h("button", "ptxt", "Fit"), bAud = h("button", "ptxt", "Audio"), bSrv = h("button", "ptxt", "Servers"), bEps = h("button", "ptxt", "Episodes"), bAa = h("button", "ptxt", "Aa");
    bAa.setAttribute("aria-label", "Subtitle size and position");
    bEps.setAttribute("aria-label", "Episodes and up next");
    bSpd.setAttribute("aria-label", "Playback speed"); bFit.setAttribute("aria-label", "Picture fit: fit, fill or stretch"); bAud.setAttribute("aria-label", "Audio track"); bSrv.setAttribute("aria-label", "Servers");
    row2.appendChild(bSpd); row2.appendChild(bFit); row2.appendChild(bAud); row2.appendChild(bAa); row2.appendChild(bSrv);
    if (ctx && ctx.mt === "tv") row2.appendChild(bEps);
    bot.appendChild(row2);
    root.appendChild(bot);
    var fileIn = document.createElement("input");
    fileIn.type = "file"; fileIn.accept = ".srt,.vtt,text/vtt"; fileIn.style.display = "none";
    root.appendChild(fileIn);

    function fillCC() {
      cc.textContent = "";
      cc.style.display = "";
      var o0 = h("option", null, "CC: Off"); o0.value = ""; cc.appendChild(o0);
      if (!(SUBS && SUBS.length) && !(hls && hls.subtitleTracks && hls.subtitleTracks.length)) { var on = h("option", null, "No subtitles available"); on.disabled = true; cc.appendChild(on); }
      (SUBS || []).forEach(function (x, i) { var o = h("option", null, "CC: " + subName(x)); o.value = String(i); cc.appendChild(o); });
      if (hls && hls.subtitleTracks) hls.subtitleTracks.forEach(function (tr, i) { var o = h("option", null, "CC: " + (tr.name || tr.lang || "Stream " + (i + 1))); o.value = "h" + i; cc.appendChild(o); });
      var ou = h("option", null, "Upload .srt / .vtt"); ou.value = "__up"; cc.appendChild(ou);
      cc.value = SUBSEL;
    }
    fillCC();
    PLSUBREFRESH = fillCC;
    cc.onchange = function () {
      if (cc.value === "__up") { cc.value = SUBSEL; fileIn.click(); return; }
      SUBUSER = true; SUBSEL = cc.value;
      if (/^h/.test(SUBSEL)) { var ht = hls && hls.subtitleTracks && hls.subtitleTracks[+SUBSEL.slice(1)]; SUBHKEY = ht ? String(ht.lang || ht.name || "") : ""; applySub(); if (hls) { hls.subtitleDisplay = true; hls.subtitleTrack = +SUBSEL.slice(1); } }
      else { if (hls) hls.subtitleTrack = -1; applySub(); }
    };
    cc.onfocus = function () { if (cc.options.length && cc.options[1] && cc.options[1].disabled) toast("No subtitles available for this title. You can upload an .srt / .vtt."); };
    fileIn.onchange = function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var u = URL.createObjectURL(new Blob([toVtt(rd.result)], { type: "text/vtt" }));
        LANGS.upl = "Uploaded";
        SUBU.push({ lang: "upl", u: u, b: u, n: SUBU.length + 1 });
        SUBUSER = true; rebuildSubs();
        SUBSEL = String(SUBS.length - 1);
        if (hls) hls.subtitleTrack = -1;
        fillCC(); applySub(); toast("Subtitles loaded");
      };
      rd.readAsText(f);
      fileIn.value = "";
    };

    // ----- controls: one tap shows, one tap hides (no auto-dissolve timer) -----
    function showCtl() { root.classList.remove("hide"); }
    var ccMo = null;
    try { ccMo = new MutationObserver(function () { var hd = root.classList.contains("hide"); if (hd !== CCHID) { CCHID = hd; liftCues(v); refreshCC(v); } }); ccMo.observe(root, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
    function paintCCStyle() {
      root.classList.remove("ccs-s", "ccs-m", "ccs-l"); root.classList.add("ccs-" + CCSIZE);
      liftCues(v); refreshCC(v);
    }
    paintCCStyle();

    // ----- source -----
    function extOf(u) { var m = /\.(m3u8|mpd|mp4|mkv|avi|mov|flv|webm|ts)(\?|$)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }
    function mediaWhy(er) {
      var c = er && er.code, x = extOf(url);
      if (c === 2) return "The stream host dropped the connection (link expired, blocked or geo-restricted).";
      if (c === 3) return "The video or audio codec couldn't be decoded on this device.";
      if (c === 4) return (x === "mkv" || x === "avi" || x === "flv" || x === "mov") ? "The ." + x.toUpperCase() + " container isn't supported by mobile web players." : "This format or codec (HEVC, AC3, DTS) isn't supported by your browser.";
      return "The player couldn't open this stream.";
    }
    function hlsWhy(d) {
      var t = String((d && d.details) || "");
      if (/manifest|level|playlist/i.test(t)) return "The playlist couldn't be loaded (link expired or blocked by the host).";
      if (/frag|key|buffer/i.test(t)) return "Video segments failed to load (host too slow, blocked or link expired).";
      if (/codec|incompat/i.test(t)) return "The codec isn't supported by your browser.";
      return "HLS playback error" + (t ? " (" + t + ")" : "") + ".";
    }
    function copyLink(u) {
      u = u || url;
      var ok = function () { toast("Link copied"); };
      function fb() {
        var t = document.createElement("textarea");
        t.value = u; t.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(t); t.select();
        try { document.execCommand("copy"); ok(); } catch (e) { toast("Couldn't copy the link"); }
        t.remove();
      }
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(u).then(ok, fb); return; } } catch (e) {}
      fb();
    }
    // "Trying another server…" pill: shown while failover steps through servers, cleared the moment data / playback arrives
    var tryEl = h("div", "ptry"); tryEl.setAttribute("role", "status"); tryEl.setAttribute("aria-live", "polite");
    root.appendChild(tryEl);
    function showTry(n) { tryEl.textContent = "Trying another server\u2026" + (n ? " (SERVER " + n + ")" : ""); tryEl.className = "ptry on"; }
    function clearTry() { if (tryEl.className !== "ptry") { tryEl.className = "ptry"; tryEl.textContent = ""; } }
    function fail() {
      dead = true; clearTry(); root.classList.remove("hide"); spin.className = "pspin"; clearTimeout(stallT);
      msg.textContent = "";
      msg.appendChild(h("b", null, "This stream can't play in the app player"));
      whyEl = h("div", "pwhy", "Why: " + (why || "Checking the stream\u2026"));
      msg.appendChild(whyEl);
      var r = h("div", "pfrow");
      var b1 = h("button", "pvlc pgrey", "Servers"); b1.onclick = openServers; r.appendChild(b1);
      if (ctx && ctx.mt === "tv") { var bq = h("button", "pvlc pgrey", "Episodes"); bq.onclick = openEpisodes; r.appendChild(bq); }
      var b2 = h("button", "pvlc", "Open in VLC"); b2.onclick = function () { bVlc.onclick(); };
      var b3 = h("button", "pvlc pgrey", "Copy Link"); b3.onclick = function () { copyLink(); };
      r.appendChild(b2); r.appendChild(b3);
      msg.appendChild(r);
      msg.className = "pmsg on";
      var u0 = url;
      if (!probed[u0]) {
        probed[u0] = 1;
        console.warn("[Boa] stream failed:", u0, why);
        api("/api/relay-sign?u=" + encodeURIComponent(u0) + (curSt && curSt.headers ? "&h=" + encodeURIComponent(JSON.stringify(curSt.headers)) : ""), 0, 8000)
          .then(function (sg) { return api(String(sg.u).replace("/api/relay?", "/api/probe?"), 0, 9000); })
          .then(function (j) {
            console.warn("[Boa] stream diagnostic:", j);
            if (closed || u0 !== url || !j || !j.reason || !whyEl) return;
            why = j.reason;
            whyEl.textContent = "Why: " + j.reason;
          })
          .catch(function () { if (whyEl && !why) whyEl.textContent = "Why: Couldn't inspect the stream. It may be offline, blocked or in a format the browser can't play."; });
      }
    }
    // a stream that never reports a duration is treated as failed (the 00:00 / 00:00 case)
    function armWatch() {
      clearTimeout(stallT);
      stallT = setTimeout(function () {
        if (closed || adActive) return;
        if (!(v.duration > 0) || v.readyState < 2) { why = why || "No data after " + (autoN ? "10" : "15") + " seconds (stuck at 00:00 / 00:00): the host is too slow or is blocking this link."; if (fatalFn) fatalFn(); }
      }, autoN ? 10000 : 15000);
    }
    var fatalFn = null;
    function switchTo(i, auto) {
      var sv = ((ctx && ctx.servers) || [])[i];
      if (!sv) return;
      if (!auto && !sv.sizeOK && !sv.tor) {            // a manual pick: check the size first (automatic failover is not interrupted)
        sizeGate(sv.st, stGB(sv.st), null, function () { sv.sizeOK = 1; switchTo(i, false); });
        return;
      }
      tried[i] = 1; curSrv = i; bad[i] = 0; upd[i] = 0; paintDots();
      if (!auto) { autoN = 0; failedU[sv.st.url] = 0; triedU[sv.st.url] = 0; }   // a manual pick gets a fresh failover budget and a clean retry
      var t = v.currentTime || 0;
      if (t > 1) seekAfter = t;
      url = sv.st.url; curSt = sv.st; relayed = false; retried = false; why = "";
      msg.className = "pmsg"; msg.textContent = "";
      if (auto) showTry(sv.n); else { clearTry(); toast("SERVER " + sv.n); }
      startSource(url, false);
    }
    function stepOrFail() {
      var L = (ctx && ctx.servers) || [];
      failedU[url] = 1;
      if (curSrv > -1) { bad[curSrv] = 1; hadFail[curSrv] = 1; upd[curSrv] = 0; paintDots(); }
      console.warn("[Boa] playback failed on", url, why);
      if (autoN++ < 14) {
        // 1) the remaining web-friendly servers in rank order (SERVER 2-7)
        for (var i = 0; i < L.length; i++) {
          if (tried[i] || L[i].tier === "r" || L[i].tor || triedU[L[i].st.url] || failedU[L[i].st.url] || L[i].urls.indexOf(url) > -1) continue;
          switchTo(i, true);
          return;
        }
        // 2) other web-friendly links (alternate providers / mirrors) from the source list
        for (var k = 0; k < L.length; k++) {
          var al = L[k].alts || [];
          for (var m = 0; m < al.length; m++) {
            var a = al[m];
            if (a.heavy || a.tor || triedU[a.st.url] || failedU[a.st.url] || a.st.url === url || /\/embed\/|\.html?($|\?)/i.test(a.st.url)) continue;
            curSt = a.st; url = a.st.url; relayed = false; retried = false; why = "";
            curSrv = k; tried[k] = 1; bad[k] = 0; paintDots();   // the owning server is live through this link, so it is not shown as failed
            seekAfter = (v.currentTime || 0) > 1 ? v.currentTime : seekAfter;
            msg.className = "pmsg"; msg.textContent = "";
            showTry("");
            startSource(url, false);
            return;
          }
        }
        // 3) last resort: heavy servers (MKV / HEVC), some browsers and devices can still play them
        for (var j = 0; j < L.length; j++) {
          if (tried[j] || L[j].tor || triedU[L[j].st.url] || failedU[L[j].st.url] || L[j].urls.indexOf(url) > -1) continue;
          switchTo(j, true);
          return;
        }
      }
      fail();
    }
    function startSource(src0, useRelay) {
      var gen = ++srcGen;                       // any older pending start / relay retry is cancelled by this
      triedU[src0] = 1; dead = false;
      if (/^http:/i.test(src0) && location.protocol === "https:") { why = "This link is plain HTTP and browsers block it on a secure page."; src0 = src0.replace(/^http:/i, "https:"); }
      var isHls = /\.m3u8(\?|$)/i.test(src0), netFail = false;
      // HLS needs the stream proxy only when the plugin demands custom headers (Referer / User-Agent) or a direct load was blocked (CORS / 403)
      var hdrNeed = !!(curSt && curSt.headers && Object.keys(curSt.headers).length);
      var viaProxy = !RELAY_ON() && isHls && (!!useRelay || hdrNeed);
      msg.textContent = "";
      function go(src) {
        if (closed || gen !== srcGen) return;
        if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
        if (dash) { try { dash.reset(); } catch (e) {} dash = null; }
        msg.className = "pmsg";
        spin.className = "pspin on";
        var onFatal = function () {
          clearTimeout(stallT);
          if (gen !== srcGen) return;
          // the toggle is read live: a relay retry only happens while it is ON, and never when it is OFF
          if (RELAY_ON() && !relayed && !retried) { retried = true; toast("Retrying through the privacy relay"); startSource(src0, true); return; }
          // privacy relay OFF: a blocked HLS playlist (CORS / 403 / network) gets one retry through the stream proxy, with its own message
          if (!RELAY_ON() && isHls && !relayed && !retried && netFail) { retried = true; toast("Loading through the stream proxy"); startSource(src0, true); return; }
          stepOrFail();
        };
        fatalFn = onFatal;
        armWatch();
        if (/\.mpd(\?|$)/i.test(src0)) {
          loadDash(function () {
            if (closed) return;
            if (!window.dashjs) { onFatal(); return; }
            try { if (dash) dash.reset(); } catch (e) {}
            dash = window.dashjs.MediaPlayer().create();
            dash.on("error", function () { why = "The DASH stream failed to load (link expired or blocked)."; onFatal(); });
            dash.initialize(v, src, true);
          });
        } else if (isHls && window.Hls && window.Hls.isSupported()) {
          hls = new window.Hls({ maxBufferLength: 40, enableWorker: true, lowLatencyMode: false });
          hls.on(window.Hls.Events.ERROR, function (ev, d) {
            if (!d || !d.fatal) return;
            why = hlsWhy(d);
            netFail = d.type === window.Hls.ErrorTypes.NETWORK_ERROR;
            if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); return; } catch (e) {} }
            onFatal();
          });
          hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, function () { try { if (hls.audioTracks.length && hls.audioTrack < 0) hls.audioTrack = 0; } catch (e) {} paintAud(); });
          hls.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED, function () {
            try {
              var tr = hls.subtitleTracks || [], i;
              function en(t2) { var l = String(t2.lang || "").toLowerCase(); return l === "en" || l === "eng" || /^en[-_]/.test(l) || /english/i.test(t2.name || ""); }
              if (!SUBUSER && !SUBEN && tr.length) {
                for (i = 0; i < tr.length; i++) if (en(tr[i])) { SUBSEL = "h" + i; SUBEN = true; SUBHKEY = String(tr[i].lang || tr[i].name || ""); applySub(); break; }
                if (!SUBEN && SUBSEL === "") {
                  var want = DM[String(navigator.language || "en").slice(0, 2).toLowerCase()] || [];
                  for (i = 0; i < tr.length; i++) if (want.indexOf(String(tr[i].lang || "").toLowerCase()) > -1) { SUBSEL = "h" + i; SUBHKEY = String(tr[i].lang || ""); break; }
                }
              }
              // a new server brings a new track list: find the same language again before falling back to the old index
              if (/^h/.test(SUBSEL) && SUBHKEY) for (i = 0; i < tr.length; i++) if (String(tr[i].lang || tr[i].name || "") === SUBHKEY) { SUBSEL = "h" + i; break; }
              if (/^h/.test(SUBSEL) && +SUBSEL.slice(1) < tr.length) { hls.subtitleDisplay = true; hls.subtitleTrack = +SUBSEL.slice(1); }
              else if (SUBSEL !== "") hls.subtitleTrack = -1;    // an add-on / uploaded track is showing instead
              liftCues(v);
            } catch (e) {}
            fillCC();
          });
          if (window.Hls.Events.SUBTITLE_FRAG_PROCESSED) hls.on(window.Hls.Events.SUBTITLE_FRAG_PROCESSED, function () { liftCues(v); });
          hls.loadSource(src);
          hls.attachMedia(v);
          var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
        } else {
          v.src = src;
          v.onerror = function () { why = mediaWhy(v.error); netFail = isHls && !!v.error && (v.error.code === 2 || v.error.code === 4); onFatal(); };
          var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {});
        }
      }
      if (RELAY_ON() || viaProxy) {
        relayed = true;
        relaySign(src0, curSt).then(function (ru) {
          if (gen !== srcGen || closed) return;
          if (!RELAY_ON() && !viaProxy) { relayed = false; go(src0); return; }     // switched OFF while signing: go direct
          if (!ru) {
            if (!RELAY_ON()) { relayed = false; go(src0); return; }               // proxy unavailable: still try the direct link
            why = "The privacy relay is unavailable right now. Turn it off to play directly."; fail(); return;
          }
          go(ru);
        });
      } else { relayed = false; go(src0); }
    }
    // ----- VAST ads (pre-roll, mid-roll) -----
    function hms(x) { x = Math.max(0, x || 0); var a = Math.floor(x / 3600), b = Math.floor(x % 3600 / 60), c = (x % 60).toFixed(3); return (a < 10 ? "0" : "") + a + ":" + (b < 10 ? "0" : "") + b + ":" + (c < 10 ? "0" : "") + c; }
    function pixel(u, ph, as) { try { var im = new Image(); im.src = String(u).replace(/\[(CACHEBUSTER|TIMESTAMP|RANDOM)\]/gi, String(Date.now())).replace(/\[ERRORCODE\]/gi, "900").replace(/\[ADPLAYHEAD\]/gi, encodeURIComponent(hms(ph))).replace(/\[ASSETURI\]/gi, encodeURIComponent(as || "")); } catch (e) {} }
    function fire(list, ph, as) { (list || []).forEach(function (u) { pixel(u, ph, as); }); }
    function offSecs(o, d) { o = String(o || ""); if (!o) return -1; if (o.charAt(o.length - 1) === "%") return (parseFloat(o) || 0) / 100 * d; var p = o.split(":"); return p.length < 3 ? -1 : (+p[0]) * 3600 + (+p[1]) * 60 + (parseFloat(p[2]) || 0); }
    // state saved before an ad (memory + localStorage only) and put back afterwards: exact time, active server, subtitle choice
    var snap = null;
    function snapTake() {
      var t = v.currentTime || 0;
      snap = { t: t > 0.5 ? t : (startAt || 0), srv: curSrv, url: url, sub: SUBSEL, user: SUBUSER, at: Date.now() };
      try { localStorage.setItem("boa_adsnap", JSON.stringify({ t: Math.floor(snap.t), srv: snap.srv, sub: snap.sub, at: snap.at })); } catch (e) {}
    }
    function snapClear() { snap = null; try { localStorage.removeItem("boa_adsnap"); } catch (e) {} }
    function srvOk(i) { var sv = ((ctx && ctx.servers) || [])[i]; return !!sv && !bad[i] && !failedU[sv.st.url] && sv.tier !== "r" && !sv.tor; }
    function snapRestore(kind) {
      var s = snap;
      if (!s) { try { s = JSON.parse(localStorage.getItem("boa_adsnap") || "null"); } catch (e) { s = null; } if (s && Date.now() - s.at > 3600000) s = null; }
      snapClear();
      if (!s || closed) return;
      if (kind === "mid") {
        // keep the server that was playing; if it has failed meanwhile, prefer healthy green Server 1
        var want = s.srv > -1 && srvOk(s.srv) ? s.srv : (srvOk(0) ? 0 : -1);
        if (want > -1 && want !== curSrv) { switchTo(want, true); if (s.t > 1) seekAfter = s.t; }
        else if (s.t > 1 && Math.abs((v.currentTime || 0) - s.t) > 1.5) { try { v.currentTime = s.t; } catch (e) {} }
      }
      if (s.sub !== undefined) {
        if (SUBSEL !== s.sub) { SUBSEL = s.sub; SUBUSER = !!s.user; applySub(); } else keepSub(v);
      }
    }
    function getAdCfg(cb) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; cb({ on: false }); } }, 3000);
      api("/api/ads/config", 0, 3000).then(function (c) { if (!done) { done = true; clearTimeout(t); cb(c || { on: false }); } }).catch(function () { if (!done) { done = true; clearTimeout(t); cb({ on: false }); } });
    }
    function fetchAd(kind) { return api("/api/ads/vast?kind=" + kind, 0, 9000).then(function (r) { return r && r.ad ? r.ad : null; }).catch(function () { return null; }); }
    function playAd(ad, finish, kind) {
      var over = false, startedAt = 0, fired = {}, vis = 0, lastTk = 0, q = { 25: 0, 50: 0, 75: 0 };
      var viewSecs = adcfg && adcfg.view != null ? +adcfg.view : 5;
      function once(k, list) { if (fired[k]) return; fired[k] = 1; fire(list, av.currentTime || 0, ad.media); }
      var box = h("div", "padbox");
      var av = document.createElement("video");
      av.setAttribute("playsinline", ""); av.setAttribute("webkit-playsinline", "");
      av.preload = "auto"; try { av.volume = +vol.value; } catch (e) {} av.muted = !!v.muted;
      av.defaultPlaybackRate = 1; av.playbackRate = 1;                        // ads always play at normal speed
      av.addEventListener("ratechange", function () { if (av.playbackRate !== 1) av.playbackRate = 1; });
      box.appendChild(av);
      var tagEl = h("div", "adtag", "Ad");
      box.appendChild(tagEl);
      var bar = h("div", "adbar"), barI = h("i"); bar.appendChild(barI); box.appendChild(bar);
      var xb = pbtn(PI.x, "Close"); xb.className = "adclose pbtn"; xb.onclick = function () { closeP(); stop(false); }; box.appendChild(xb);
      // pre-roll: locked for the lock time (15 seconds by default) before the video may start; mid-roll: skip unlocks after the skip time (15 seconds)
      var skipSecs = kind === "pre" ? (adcfg && adcfg.lock != null ? +adcfg.lock : 15) : (adcfg && adcfg.skip != null ? +adcfg.skip : 15);
      if (!(skipSecs > 0)) skipSecs = 0;
      var so = ad.skipoff ? offSecs(ad.skipoff, ad.duration || 0) : -1;
      if (skipSecs && so > skipSecs) skipSecs = so;
      var viewNeed = Math.min(viewSecs, ad.duration > 0 ? ad.duration : viewSecs);
      function viewOk() { return vis >= viewNeed; }
      xb.style.display = viewNeed > 0 ? "none" : "";                          // no way out before a view has counted
      var sk = null;
      if (skipSecs) { sk = h("button", "adskip", "Skip in " + Math.max(skipSecs, viewNeed)); box.appendChild(sk); }
      if (ad.click) {
        var lb = h("button", "adlearn", "Learn more");
        lb.onclick = function () { fire(ad.clickTrk); openLink(ad.click); av.pause(); };
        box.appendChild(lb);
      }
      root.appendChild(box);
      root.classList.add("adon");
      adActive = true; setStreaming(false);
      var guard = setTimeout(function () { if (!startedAt) { fire(ad.trk.error); stop(false); } }, 9000);
      // nobody is ever stuck behind an ad: a hard cap, and a watchdog for an ad that freezes after it started
      var capT = setTimeout(function () { stop(false); }, ((ad.duration > 0 ? ad.duration : 120) + 25) * 1000);
      var lastProg = Date.now(), lastT = -1;
      var wdT = setInterval(function () {
        if (over || !startedAt || document.hidden) { lastProg = Date.now(); return; }
        if (Math.abs(av.currentTime - lastT) > 0.05) { lastT = av.currentTime; lastProg = Date.now(); }
        else if (!av.paused && Date.now() - lastProg > 10000) { fire(ad.trk.error, av.currentTime, ad.media); stop(false); }
      }, 2000);
      function onVis() {
        if (over) return;
        lastTk = 0;
        if (document.hidden) { try { av.pause(); } catch (e) {} }
        else { var pp = av.play(); if (pp && pp.catch) pp.catch(function () {}); }
      }
      document.addEventListener("visibilitychange", onVis);
      function stop(skipped) {
        if (over) return;
        over = true;
        clearTimeout(guard); clearTimeout(capT); clearInterval(wdT);
        document.removeEventListener("visibilitychange", onVis);
        if (skipped === true) once("skip", ad.trk.skip);
        else if (skipped === "done") {
          if (!q[75]) { q[75] = 1; once("q75", ad.trk.thirdQuartile); }
          once("complete", ad.trk.complete);
        }
        try { av.pause(); av.removeAttribute("src"); av.load(); } catch (e) {}
        if (box.parentNode) box.parentNode.removeChild(box);
        root.classList.remove("adon");
        adActive = false;
        if (!closed) finish();
      }
      if (sk) sk.onclick = function () { if (sk.className.indexOf("ready") > -1) stop(true); };
      av.addEventListener("playing", function () {
        spin.className = "pspin";
        av.playbackRate = 1;
        if (startedAt) { once("resume" + Date.now(), ad.trk.resume); return; }
        startedAt = Date.now();
        once("imp", ad.imp); once("cv", ad.trk.creativeView); once("start", ad.trk.start);
      });
      av.addEventListener("pause", function () { lastTk = 0; if (startedAt && !over && !av.ended && !document.hidden) fire(ad.trk.pause, av.currentTime, ad.media); });
      av.addEventListener("volumechange", function () { if (startedAt) once(av.muted ? "mute" : "unmute", av.muted ? ad.trk.mute : ad.trk.unmute); });
      av.addEventListener("timeupdate", function () {
        var d = av.duration || ad.duration || 0, t = av.currentTime, now = Date.now();
        if (lastTk && !av.paused && !document.hidden) vis += Math.min(1, (now - lastTk) / 1000);   // only visible, playing seconds count toward a view
        lastTk = av.paused || document.hidden ? 0 : now;
        if (d) barI.style.width = Math.min(100, t / d * 100) + "%";
        tagEl.textContent = "Ad • " + fmtT(Math.max(0, d - t));
        if (vis >= 2) once("viewable", ad.trk.viewable);
        (ad.prog || []).forEach(function (pg, i) { var os = offSecs(pg.o, d); if (os >= 0 && t >= os && !fired["pg" + i]) { fired["pg" + i] = 1; fire([pg.u], t, ad.media); } });
        if (d) {
          if (!q[25] && t >= d * 0.25) { q[25] = 1; once("q25", ad.trk.firstQuartile); }
          if (!q[50] && t >= d * 0.5) { q[50] = 1; once("q50", ad.trk.midpoint); }
          if (!q[75] && t >= d * 0.75) { q[75] = 1; once("q75", ad.trk.thirdQuartile); }
        }
        if (viewOk() && xb.style.display === "none") xb.style.display = "";
        if (sk) {
          var left = Math.ceil(Math.max(skipSecs - t, viewNeed - vis));
          if (left > 0) sk.textContent = "Skip in " + left; else { sk.textContent = "Skip Ad ▶"; sk.className = "adskip ready"; }
        }
      });
      av.addEventListener("ended", function () { stop("done"); });
      av.addEventListener("error", function () { fire(ad.trk.error, 0, ad.media); stop(false); });
      av.src = ad.media;
      var pr = av.play();
      if (pr && pr.catch) pr.catch(function () { av.muted = true; var p2 = av.play(); if (p2 && p2.catch) p2.catch(function () { stop(false); }); });
    }
    function runAd(kind, done) {
      if (closed) return;
      if (!adcfg || !adcfg.on || (kind === "pre" && !adcfg.pre) || (kind === "mid" && !adcfg.mid)) { done(); return; }
      snapTake();
      spin.className = "pspin on";
      var pending = kind === "mid" && prefetch ? prefetch : fetchAd(kind);
      prefetch = null;
      pending.then(function (ad) {
        spin.className = "pspin";
        if (closed) return;
        if (!ad) { snapClear(); done(); return; }
        playAd(ad, function () { snapRestore(kind); done(); }, kind);
      });
    }
    function planMid() {
      if (midPlanned || !adcfg || !adcfg.on || !adcfg.mid) return;
      var d = v.duration;
      if (!isFinite(d) || d <= 0) return;
      midPlanned = true;
      var mins = d / 60;
      if (mins < 25) { midDone = true; return; }
      var rng = mins >= 120 ? adcfg.movie : adcfg.tv;
      var a = rng[0], b = Math.max(rng[1], rng[0]);
      midAt = (a + Math.random() * (b - a)) * 60;
      if (midAt > d - 300) { midDone = true; return; }
      if (startAt > midAt) midDone = true;
    }
    function midCheck() {
      if (midDone || !midAt || adActive || closed) return;
      var t = v.currentTime;
      if (!prefetch && t >= midAt - 15) prefetch = fetchAd("mid");
      if (t >= midAt) {
        midDone = true;
        save(true);               // progress is saved at the exact timestamp before the ad
        v.pause();
        adActive = true;          // keeps progress frozen while the ad plays
        runAd("mid", function () {
          adActive = false;
          var pp = v.play(); if (pp && pp.catch) pp.catch(function () {});
        });
      }
    }
    function beginMain() {
      if (/\.m3u8(\?|$)/i.test(url)) loadHls(function () { startSource(url, false); });
      else startSource(url, false);
    }
    getAdCfg(function (c) { adcfg = c; runAd("pre", beginMain); });

    // ----- state -> UI -----
    function paintPlay() { bPlay.innerHTML = v.paused ? PI.play : PI.pause; bPlay.setAttribute("aria-label", v.paused ? "Play" : "Pause"); }
    function paintTime() {
      var d = v.duration || 0, c = v.currentTime || 0;
      tim.textContent = fmtT(c) + " / " + fmtT(d);
      if (!seeking) {
        var pc = d ? Math.min(100, c / d * 100) : 0;
        sfill.style.width = pc + "%"; sthumb.style.left = pc + "%";
      }
      try { if (v.buffered && v.buffered.length && d) sbuf.style.width = Math.min(100, v.buffered.end(v.buffered.length - 1) / d * 100) + "%"; } catch (e) {}
    }
    function save(force) {
      if (!ctx || finished || adActive || !(v.currentTime > 1)) return;
      recordWatch(ctx, v.currentTime, v.duration || 0, !!force);
    }
    v.addEventListener("play", function () { paintPlay(); });
    v.addEventListener("pause", function () { paintPlay(); root.classList.remove("hide"); save(true); });
    v.addEventListener("waiting", function () { spin.className = "pspin on"; });
    // UPDATED never re-labels the stream that failed: the server gets a different, working stream (another provider first).
    function uk(u) {
      if (/^magnet:/i.test(u)) return String(u).slice(0, 60);
      var p = String(u).replace(/#.*$/, ""), q = p.indexOf("?");
      return q > -1 && /\.[a-z0-9]{2,5}$/i.test(p.slice(0, q)) ? p.slice(0, q) : p;
    }
    function swapMain(sv, a, owner) {
      var old = sv.st.url, nu = a.st.url;
      if (owner) {
        var ix = owner.alts.indexOf(a); if (ix > -1) owner.alts.splice(ix, 1);
        if (owner !== sv) owner.urls = owner.urls.filter(function (x) { return x !== nu; });
      }
      a.st.label = sv.st.label;
      sv.st = a.st; sv.f = a.f || sv.f; sv.q = a.q || sv.q;
      sv.urls = [nu].concat(sv.urls.filter(function (x) { return x !== old && x !== nu; }));
      failedU[old] = 1;
    }
    // best unused playable link for server i: another provider first, then a distinct endpoint of the same provider
    function pickRepl(i, skip) {
      var L = (ctx && ctx.servers) || [], sv = L[i], mine = {}, best = null, bs = -1;
      if (!sv) return null;
      L.forEach(function (s0) { mine[uk(s0.st.url)] = 1; });
      var pv0 = String(sv.st.provider || "").toLowerCase().trim();
      L.forEach(function (o) {
        (o.alts || []).forEach(function (a) {
          var u = a.st && a.st.url;
          if (!u || a.heavy || a.tor || mine[uk(u)] || failedU[u] || triedU[u] || skip[u] || /^magnet:/i.test(u) || /\/embed\/|\.html?($|\?)/i.test(u)) return;
          var sc = (+a.sc || 0) + (String(a.st.provider || "").toLowerCase().trim() !== pv0 ? 1000 : 0);
          if (sc > bs) { bs = sc; best = { a: a, o: o }; }
        });
      });
      return best;
    }
    function resolveRepl(i, done) {
      var skip = {}, n = 0;
      (function next() {
        var c = pickRepl(i, skip);
        if (!c || n++ >= 2 || closed) return done(null);
        var cu = c.a.st.url; skip[cu] = 1;
        api("/api/relay-sign?u=" + encodeURIComponent(cu) + (c.a.st.headers ? "&h=" + encodeURIComponent(JSON.stringify(c.a.st.headers)) : ""), 0, 8000)
          .then(function (sg) { return api(String(sg.u).replace("/api/relay?", "/api/probe?"), 0, 9000); })
          .then(function (j) { if (j && j.ok) done(c); else next(); })
          .catch(function () { next(); });
      })();
    }
    // a server that failed earlier and now plays is healthy again: it shows UPDATED once playback moves elsewhere
    function markOk() {
      var i = curSrv, sv = ((ctx && ctx.servers) || [])[i];
      if (!sv || dead || adActive || !hadFail[i]) return;
      if (url !== sv.st.url) {                       // playing through a different link: that link becomes the server's stream
        var ao = null; (sv.alts || []).forEach(function (a) { if (a.st.url === url) ao = a; });
        if (!ao) return;
        swapMain(sv, ao, sv);
      }
      hadFail[i] = 0; upd[i] = 1; bad[i] = 0; failedU[sv.st.url] = 0; failedU[url] = 0; paintDots();
    }
    v.addEventListener("playing", function () { spin.className = "pspin"; msg.className = "pmsg"; clearTimeout(stallT); clearTry(); setStreaming(!adActive); markOk(); if (!adActive && curSt) { lpSet(ctx, curSt); markLast(); } });
    // the stream that is playing / was last used is flagged on its server (survives refreshes in lpSet memory)
    function markLast() {
      ((ctx && ctx.servers) || []).forEach(function (sv) { sv.last = !!(curSt && sv.urls.indexOf(curSt.url) > -1); });
    }
    // the server list is rebuilt (filter change, refresh): carry each server's state over by URL and keep the playing server selected
    if (ctx) {
      ctx.keep = function () {
        var snap = [];
        ((ctx.servers) || []).forEach(function (sv, i) { snap.push({ urls: sv.urls.slice(), bad: bad[i], tried: tried[i], had: hadFail[i], upd: upd[i] }); });
        return snap;
      };
      ctx.rebind = function (snap) {
        var nb = {}, nt = {}, nh = {}, nu = {}, L = ctx.servers || [], cs = -1;
        L.forEach(function (sv, j) {
          for (var q = 0; q < snap.length; q++) {
            var hit = false;
            for (var w = 0; w < sv.urls.length && !hit; w++) if (snap[q].urls.indexOf(sv.urls[w]) > -1) hit = true;
            if (hit) { nb[j] = snap[q].bad; nt[j] = snap[q].tried; nh[j] = snap[q].had; nu[j] = snap[q].upd; break; }
          }
          if (!dead && sv.urls.indexOf(url) > -1 && cs < 0) cs = j;
        });
        bad = nb; tried = nt; hadFail = nh; upd = nu;
        if (cs > -1) curSrv = cs;
        markLast(); paintDots();
      };
    }
    v.addEventListener("pause", function () { setStreaming(false); });
    v.addEventListener("ended", function () { setStreaming(false); });
    v.addEventListener("error", function () { setStreaming(false); });
    v.addEventListener("canplay", function () { spin.className = "pspin"; clearTimeout(stallT); clearTry(); markOk(); });
    v.addEventListener("timeupdate", function () { paintTime(); midCheck(); nextCheck(); });
    v.addEventListener("progress", paintTime);
    v.addEventListener("durationchange", paintTime);
    v.addEventListener("seeking", function () { if (v.currentTime < (v.duration || 1) * 0.9) finished = false; });
    v.addEventListener("ended", function () { finished = true; if (ctx) recordWatch(ctx, v.duration || 1, v.duration || 1, true); root.classList.remove("hide"); paintPlay(); nextEnded(); });
    v.addEventListener("loadedmetadata", function () {
      if (ctx && ctx.resumeAt > 10 && v.duration && ctx.resumeAt < v.duration - 30) { try { v.currentTime = ctx.resumeAt; } catch (e) {} ctx.resumeAt = 0; }
      clearTimeout(stallT); clearTry();
      planMid(); planNext();
      keepSub(v); paintAud();
      paintTime();
    });
    try { v.volume = +vol.value; } catch (e) {}
    paintPlay();
    saveT = setInterval(function () { if (!v.paused) save(false); }, 5000);

    // ----- actions -----
    function toggle() { if (v.paused) { var q = v.play(); if (q && q.catch) q.catch(function () {}); } else v.pause(); }
    function seekBy(n) { if (v.duration) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + n)); showCtl(); }
    // iOS Safari ignores video.volume (the physical buttons own loudness); only mute works there
    var CAN_VOL = (function () { try { var t = document.createElement("video"); t.volume = 0.5; return t.volume === 0.5; } catch (e) { return false; } })();
    var lastVol = +vol.value > 0 ? +vol.value : 1;
    if (!CAN_VOL) vol.style.display = "none";
    function isMuted() { return !!v.muted || (CAN_VOL && v.volume === 0); }
    function paintVol() {
      var m = isMuted();
      bMute.innerHTML = m ? PI.mute : PI.vol;
      bMute.setAttribute("aria-label", m ? "Unmute" : "Mute");
      if (CAN_VOL) vol.value = String(m ? 0 : v.volume);
    }
    v.addEventListener("volumechange", function () { if (CAN_VOL && !v.muted && v.volume > 0) lastVol = v.volume; paintVol(); });
    bPlay.onclick = toggle;
    bBack.onclick = function () { seekBy(-10); };
    bFwd.onclick = function () { seekBy(10); };
    bMute.onclick = function () {
      if (isMuted()) { v.muted = false; if (CAN_VOL && v.volume === 0) v.volume = lastVol > 0 ? lastVol : 0.5; }   // unmuting from 0 restores a audible level
      else v.muted = true;
      paintVol();
    };
    vol.oninput = function () {
      var n = +vol.value;
      if (CAN_VOL) v.volume = n;
      v.muted = n === 0;                      // raising above 0 always unmutes
      if (n > 0) { lastVol = n; lsSet("boa_vol", String(n)); }
      paintVol();
    };
    bPip.onclick = function () {
      try {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else if (v.requestPictureInPicture) v.requestPictureInPicture();
        else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode(v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
      } catch (e) { toast("Picture in picture isn't available"); }
    };
    function ambDraw() {
      try { amb.getContext("2d").drawImage(v, 0, 0, 32, 18); } catch (e) {}
    }
    var ambOn = lsGet("boa_amb", "0") === "1";
    function paintAmb() {
      root.classList.toggle("amb", ambOn);
      bAmb.style.opacity = ambOn ? "1" : ".6";
      clearInterval(ambT);
      if (ambOn) { ambDraw(); ambT = setInterval(ambDraw, 400); }
    }
    bAmb.onclick = function () { ambOn = !ambOn; lsSet("boa_amb", ambOn ? "1" : "0"); paintAmb(); toast(ambOn ? "Ambient light on" : "Ambient light off"); };
    paintAmb();
    function isFs() { return document.fullscreenElement || document.webkitFullscreenElement; }
    function lockLand() { try { if (screen.orientation && screen.orientation.lock) return screen.orientation.lock("landscape").catch(function () {}); } catch (e) {} }
    function unlockO() { try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {} }
    var isPortrait = function () { return window.innerHeight > window.innerWidth; };
    bFs.onclick = function () {
      try {
        if (isFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); unlockO(); return; }
        if (root.classList.contains("rot")) { root.classList.remove("rot"); return; }
        var p = root.requestFullscreen ? root.requestFullscreen() : (root.webkitRequestFullscreen ? root.webkitRequestFullscreen() : null);
        if (p && p.then) p.then(lockLand).catch(function () { if (isPortrait()) root.classList.add("rot"); });
        else if (isPortrait()) root.classList.add("rot");   // iOS Safari / PWA: rotate the picture with CSS
      } catch (e) { if (isPortrait()) root.classList.add("rot"); }
    };
    // real rotation of the phone: drop the CSS rotation and fill the screen
    try {
      mqL = window.matchMedia("(orientation: landscape)");
      var onRot = function () { if (mqL.matches) root.classList.remove("rot"); };
      if (mqL.addEventListener) mqL.addEventListener("change", onRot); else if (mqL.addListener) mqL.addListener(onRot);
      mqL._f = onRot;
    } catch (e) {}

    // ----- swipe gestures: horizontal = seek, left half vertical = brightness, right half vertical = volume -----
    var IC_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
    var IC_VOL = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
    var IC_SEEK = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M13 6v12l8.5-6L13 6zM3 6v12l8.5-6L3 6z"/></svg>';
    function showHud(icon, text) {
      hud.innerHTML = icon + "<span></span>";
      hud.lastChild.textContent = text;
      hud.className = "phud on";
      clearTimeout(hudT);
    }
    function hideHud(ms) { clearTimeout(hudT); hudT = setTimeout(function () { hud.className = "phud"; }, ms || 600); }
    function signT(n) { return (n < 0 ? "-" : "+") + fmtT(Math.abs(n)); }
    var g = null, DEAD = 14;
    // touch point in the player's own frame (x right, y down). When the picture is CSS-rotated (portrait phone, landscape view)
    // screen-down is player-right and screen-left is player-down.
    function pt(t) {
      var r = root.getBoundingClientRect();
      if (root.classList.contains("rot")) return { x: t.clientY - r.top, y: r.right - t.clientX, w: r.height || 1, h: r.width || 1 };
      return { x: t.clientX - r.left, y: t.clientY - r.top, w: r.width || 1, h: r.height || 1 };
    }
    root.addEventListener("touchstart", function (ev) {
      if (ev.touches.length !== 1 || adActive) { g = null; return; }
      if (ev.target !== v && ev.target !== root && ev.target !== spin) { g = null; return; }   // taps on buttons/menus never start a gesture
      var p = pt(ev.touches[0]);
      g = { x: p.x, y: p.y, axis: "", w: p.w, h: p.h, bot: p.y > p.h * 0.7, left: p.x < p.w / 2, t0: v.currentTime || 0, v0: v.muted ? 0 : v.volume, b0: BRI, to: 0, sx: p.x, sy: p.y };
    }, { passive: true });
    root.addEventListener("touchmove", function (ev) {
      if (!g) return;
      if (ev.touches.length !== 1) { g = null; seeking = false; hud.className = "phud"; return; }
      var p = pt(ev.touches[0]), dx = p.x - g.x, dy = p.y - g.y, ax = Math.abs(dx), ay = Math.abs(dy);
      if (!g.axis) {
        if (Math.max(ax, ay) < DEAD) return;                         // deadzone: small finger jitter is still a tap
        if (ax >= ay * 1.25) g.axis = "seek";                        // clearly horizontal
        else if (ay >= ax * 1.25) g.axis = g.bot && dy < 0 && ctx && ctx.mt === "tv" && ay > ax * 1.5 ? "eps" : (g.left ? "bri" : "vol");
        else if (Math.max(ax, ay) > DEAD * 2) g.axis = ax > ay ? "seek" : (g.left ? "bri" : "vol");   // diagonal: larger side wins once it is unmistakable
        if (!g.axis) return;
        g.sx = p.x; g.sy = p.y;                                      // measure from where the axis locked, so there is no jump
        seeking = g.axis === "seek";
      }
      if (ev.cancelable) ev.preventDefault();
      if (g.axis === "eps") {
        g.dy = p.y - g.y;
        if (g.dy < -60) showHud("", "Release for Episodes"); else hud.className = "phud";
        return;
      }
      if (g.axis === "seek") {                                       // vertical motion is ignored once locked to seek
        var d = v.duration || 0;
        if (!d || !isFinite(d)) return;
        var off = (p.x - g.sx) / g.w * 180;
        g.to = Math.max(0, Math.min(d, g.t0 + off));
        showHud(IC_SEEK, signT(Math.round(g.to - g.t0)) + "  (" + fmtT(g.to) + " / " + fmtT(d) + ")");
      } else if (g.axis === "bri") {
        BRI = Math.max(0, Math.min(1, g.b0 - (p.y - g.sy) / (g.h * 0.7)));
        dimEl.style.opacity = String((1 - BRI) * 0.85);
        showHud(IC_SUN, Math.round(BRI * 100) + "%");
      } else {                                                       // vertical on the right half = volume; horizontal motion is ignored
        if (!CAN_VOL) { showHud(IC_VOL, "Use the volume buttons"); return; }
        var nv = Math.max(0, Math.min(1, g.v0 - (p.y - g.sy) / (g.h * 0.7)));
        v.volume = nv; v.muted = nv === 0;                           // above 0 always unmutes
        showHud(IC_VOL, Math.round(nv * 100) + "%");
      }
    }, { passive: false });
    function endG() {
      if (!g) return;
      if (g.axis === "seek" && v.duration) v.currentTime = g.to;
      if (g.axis === "vol" && CAN_VOL && v.volume > 0) lsSet("boa_vol", String(v.volume));
      if (g.axis === "eps" && g.dy < -60) openEpisodes();
      if (g.axis) { gestEnd = Date.now(); hideHud(g.axis === "eps" ? 50 : 700); }
      seeking = false;
      g = null;
    }
    root.addEventListener("touchend", endG, { passive: true });
    root.addEventListener("touchcancel", endG, { passive: true });

    // single tap on the picture toggles the controls (double-tap skipping is gone)
    root.addEventListener("click", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest(".pbot,.ptop,.srvroom,.pmenu,.pnext,.pmsg")) return;
      if (menuEl && !menuEl.contains(ev.target)) { closeMenu(); return; }
      if (ev.target !== v && ev.target !== root && ev.target !== spin) return;
      if (Date.now() - gestEnd < 450) return;
      if (root.classList.contains("hide")) showCtl();
      else { clearTimeout(hideT); root.classList.add("hide"); }
    });

    // ----- extra controls: speed, aspect, audio, servers -----
    function popMenu(title, items) {
      closeMenu();
      var m = h("div", "pmenu");
      m.appendChild(h("b", null, title));
      items.forEach(function (it) {
        var b = h("button", it.on ? "on" : "", it.label);
        b.onclick = function () { closeMenu(); it.fn(); };
        m.appendChild(b);
      });
      root.appendChild(m); menuEl = m;
      clearTimeout(hideT);
    }
    function closeMenu() { if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; showCtl(); }
    var RATES = [0.5, 1, 1.25, 1.5, 2];
    bSpd.onclick = function () {
      var i = RATES.indexOf(rate); rate = RATES[(i + 1) % RATES.length];
      v.playbackRate = rate; bSpd.textContent = rate + "x";
    };
    var FITS = [["Fit", "contain"], ["Fill", "cover"], ["Stretch", "fill"]];
    bFit.onclick = function () {
      fitI = (fitI + 1) % FITS.length;
      v.style.objectFit = FITS[fitI][1]; bFit.textContent = FITS[fitI][0];
    };
    v.addEventListener("loadedmetadata", function () {
      if (seekAfter > 0) { try { v.currentTime = seekAfter; } catch (e) {} seekAfter = 0; }
      v.playbackRate = rate;
    });
    bAud.onclick = function () {
      var items = [];
      if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
        hls.audioTracks.forEach(function (tr, i) { items.push({ label: (tr.name || tr.lang || "Track " + (i + 1)), on: hls.audioTrack === i, fn: function () { hls.audioTrack = i; } }); });
      } else if (v.audioTracks && v.audioTracks.length > 1) {
        for (var k = 0; k < v.audioTracks.length; k++) (function (n) {
          var tr = v.audioTracks[n];
          items.push({ label: (tr.label || tr.language || "Track " + (n + 1)), on: tr.enabled, fn: function () { for (var q = 0; q < v.audioTracks.length; q++) v.audioTracks[q].enabled = q === n; } });
        })(k);
      }
      if (!items.length) { toast("This stream has only one audio track"); return; }
      popMenu("Audio track", items);
    };
    var LIGHT = { g: "Green light: strong, web ready", y: "Yellow light: backup server", r: "Red light: heavy file, best opened in VLC" };
    var LCOL = { g: "#22c55e", y: "#facc15", r: "#ef4444" };
    function pad2(n) { return ("0" + n).slice(-2); }
    // a failing server never keeps a green light: its dot (here and on the stream list) turns red until it recovers
    function paintDots() {
      ((ctx && ctx.servers) || []).forEach(function (sv, i) {
        if (!sv.dot) return;
        var c = LCOL[bad[i] || failedU[sv.st.url] ? "r" : sv.tier];
        sv.dot.style.background = c; sv.dot.style.boxShadow = "0 0 10px " + c;
      });
    }
    function openServers() {
      closeMenu();
      var L = ((ctx && ctx.servers) || []).slice(0, 7);
      var m = h("div", "srvroom");
      m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Server room");
      var hd = h("div", "srhd");
      hd.appendChild(h("b", null, "SERVER ROOM"));
      var cx = h("button", "srx", "×"); cx.setAttribute("aria-label", "Close server room"); cx.onclick = closeMenu;
      hd.appendChild(cx); m.appendChild(hd);
      if (!L.length) m.appendChild(h("div", "srnote", "Only this stream is available for this title."));
      var chk = 0;
      L.forEach(function (sv, i) {
        var row = h("div", "srrow");
        row.tabIndex = 0; row.setAttribute("role", "button");
        row.appendChild(h("span", "srn", pad2(sv.n)));
        var dot = h("i", "srdot");
        dot.setAttribute("role", "img");
        row.appendChild(dot);
        var mid = h("div", "srmid");
        var t1 = h("div", "srt1");
        t1.appendChild(h("b", null, "SERVER " + sv.n));
        t1.appendChild(h("span", "sbadge", sv.label));
        var slot = h("span", "srslot");
        t1.appendChild(slot);
        mid.appendChild(t1);
        var sub = h("span", "srsub");
        function setSub() { sub.textContent = (sv.q ? sv.q + "p • " : "") + (sv.tor ? "TORRENT" : String(sv.f || "").toUpperCase()) + " • " + (sv.st.provider || "Plugin") + (isOn() ? " • Playing" : sv.last ? " • Last used" : ""); }
        setSub();
        mid.appendChild(sub);
        row.appendChild(mid);
        // one badge per row: LIVE (playing) > UPDATED (recovered, safe to switch back) > FAILED
        function isOn() { return !dead && sv.urls.indexOf(url) > -1; }
        function isFail() { return !!(bad[i] || failedU[sv.st.url]); }
        function paint() {
          var on = isOn(), fl = !on && isFail(), up = !on && !fl && !!upd[i], lu = !on && !fl && !up && !!sv.last;
          setSub();
          var col = LCOL[fl || bad[i] ? "r" : sv.tier];
          dot.style.background = col; dot.style.boxShadow = "0 0 8px " + col;
          dot.setAttribute("aria-label", fl ? "Red light: failed" : LIGHT[sv.tier]);
          row.className = "srrow" + (on ? " on" : "");
          slot.textContent = "";
          if (sv.tor) slot.appendChild(h("span", "srupd", "TORRENT"));
          else if (on) slot.appendChild(h("span", "srlive", "LIVE"));
          else if (up) slot.appendChild(h("span", "srupd", "UPDATED"));
          else if (fl) slot.appendChild(h("span", "srbad", "FAILED"));
          else if (lu) slot.appendChild(h("span", "srupd", "LAST USED"));
          row.setAttribute("aria-label", "Server " + sv.n + ", " + LIGHT[sv.tier] + (on ? ", currently playing" : up ? ", updated and healthy, tap to switch back" : fl ? ", failed, tap to retry" : lu ? ", last used" : ""));
        }
        paint();
        var cp = h("button", "srcp", "Copy"); cp.setAttribute("aria-label", "Copy link for server " + sv.n);
        cp.onclick = function (ev) { ev.stopPropagation(); copyLink(sv.st.url); };
        row.appendChild(cp);
        row.onclick = function () {
          if (sv.tor) { try { if (navigator.clipboard) navigator.clipboard.writeText(sv.st.url); } catch (e) {} toast("Opening your torrent app\u2026 (link also copied)"); try { location.href = sv.st.url; } catch (e) {} return; }
          closeMenu(); if (!isOn()) switchTo(i, false);
        };
        row.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); row.onclick(); } };
        m.appendChild(row);
        // a FAILED server is re-checked (at most 2 per opening, not again within a minute): it is only marked UPDATED once a
        // different, probe-verified stream (another provider first) has replaced the failing one; otherwise it stays FAILED
        if (!sv.tor && !isOn() && isFail() && chk < 2 && Date.now() - (chkAt[sv.st.url] || 0) > 60000) {
          chk++; chkAt[sv.st.url] = Date.now();
          var u0 = sv.st.url;
          resolveRepl(i, function (c) {
            if (!c || closed || isOn() || sv.st.url !== u0) return;
            swapMain(sv, c.a, c.o);
            bad[i] = 0; failedU[sv.st.url] = 0; triedU[sv.st.url] = 0; tried[i] = 0; hadFail[i] = 0; upd[i] = 1;
            if (menuEl === m) { setSub(); paint(); }
            paintDots();
          });
        }
      });
      m.appendChild(h("div", "srnote", "Stream stutters or won't load? Tap another server. Your place in the video is kept."));
      root.appendChild(m); menuEl = m;
    }
    bSrv.onclick = openServers;
    function paintAud() {
      var n = 0;
      try {
        if (hls && hls.audioTracks) n = hls.audioTracks.length;
        else if (dash && dash.getTracksFor) n = dash.getTracksFor("audio").length;
        else if (v.audioTracks) n = v.audioTracks.length;
      } catch (e) {}
      bAud.textContent = n > 1 ? "Audio (" + n + ")" : "Audio";
    }
    try { if (v.audioTracks && v.audioTracks.addEventListener) v.audioTracks.addEventListener("addtrack", paintAud); } catch (e) {}
    // ----- next episode (library-connected) -----
    function planNext() {
      if (nextInfo !== null) return;
      nextInfo = false;
      if (!ctx || ctx.mt !== "tv") return;
      var sN = ctx.s || 1, eN = ctx.e || 1;
      function season(n, cb) {
        var key = ctx.id + ":" + n;
        if (seasonCache[key]) { cb(seasonCache[key]); return; }
        api("/api/season?id=" + ctx.id + "&n=" + n, 1, 15000).then(function (eps) { seasonCache[key] = eps; cb(eps); }).catch(function () { cb(null); });
      }
      season(sN, function (eps) {
        if (closed || !eps) return;
        var nx = null;
        eps.forEach(function (x) { if (!nx && x.n === eN + 1) nx = { s: sN, e: x.n, t: x.t }; });
        if (nx) { nextInfo = nx; return; }
        season(sN + 1, function (e2) { if (!closed && e2 && e2.length) nextInfo = { s: sN + 1, e: e2[0].n, t: e2[0].t }; });
      });
    }
    function playNext() {
      clearTimeout(nextT);
      var nx = nextInfo;
      if (!nx || !ctx) return;
      if (v.duration) recordWatch(ctx, v.duration, v.duration, true);
      var c0 = ctx;
      closeP();
      openStreams("tv", c0.id, c0.base + " (S" + nx.s + "E" + nx.e + ")", nx.s, nx.e, c0.meta, 0, true);
    }
    function showNext() {
      if (nextShown || !nextInfo) return;
      nextShown = true;
      var c = h("div", "pnext");
      c.setAttribute("role", "region"); c.setAttribute("aria-label", "Next episode");
      var tx = h("div", "pnt");
      tx.appendChild(h("span", null, "Up next"));
      tx.appendChild(h("b", null, "Next: S" + pad2(nextInfo.s) + "E" + pad2(nextInfo.e) + " — " + nextInfo.t));
      var go = h("button", "pnplay", "Play"); go.setAttribute("aria-label", "Play next episode"); go.onclick = playNext;
      var x = h("button", "pnx", "×"); x.setAttribute("aria-label", "Dismiss next episode");
      x.onclick = function () { nextDismissed = true; clearTimeout(nextT); if (c.parentNode) c.parentNode.removeChild(c); nextEl = null; };
      c.appendChild(tx); c.appendChild(go); c.appendChild(x);
      root.appendChild(c); nextEl = c; c._go = go;
    }
    function nextCheck() {
      if (!nextInfo || nextDismissed || adActive || nextShown) return;
      var d = v.duration;
      if (d && isFinite(d) && d > 300 && d - v.currentTime <= 45) showNext();
    }
    // ----- Episodes & Up Next drawer: open any time (swipe up from the bottom edge, the Episodes button, or the E key) -----
    function epsSeason(n, cb) {
      var key = ctx.id + ":" + n;
      if (seasonCache[key]) { cb(seasonCache[key]); return; }
      api("/api/season?id=" + ctx.id + "&n=" + n, 1, 15000).then(function (eps) { seasonCache[key] = eps; cb(eps); }).catch(function () { cb(null); });
    }
    function playEp(s2, e2) {
      var c0 = ctx;
      if (!c0 || closed) return;
      // the episode being left counts as watched once it is (nearly) finished; the progress save is skipped so it can't undo that
      if (v.duration && v.currentTime / v.duration > 0.9) { recordWatch(c0, v.duration, v.duration, true); finished = true; }
      var w = watchGet("tv", c0.id), ra = w && !w.nx && w.s === s2 && w.e === e2 ? w.pos : 0;
      clearTimeout(nextT);
      closeP();
      openStreams("tv", c0.id, c0.base + " (S" + s2 + "E" + e2 + ")", s2, e2, c0.meta, ra, true);
    }
    function openEpisodes() {
      if (!ctx || ctx.mt !== "tv" || adActive) return;
      closeMenu();
      var m = h("div", "srvroom pepi");
      m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Episodes and up next");
      var hd = h("div", "srhd");
      hd.appendChild(h("b", null, "EPISODES & UP NEXT"));
      var cx = h("button", "srx", "\u00d7"); cx.setAttribute("aria-label", "Close episodes"); cx.onclick = closeMenu;
      hd.appendChild(cx); m.appendChild(hd);
      var nxBox = h("div", "pepnx"), chips = h("div", "pepchips"), listEl = h("div", "peplist");
      m.appendChild(nxBox); m.appendChild(chips); m.appendChild(listEl);
      var sel = ctx.s || 1, seq = 0;
      function paintNext(nx) {
        nxBox.textContent = "";
        if (!nx) return;
        var b = h("button", "pepgo");
        b.setAttribute("aria-label", "Play next episode");
        b.appendChild(h("span", "pepl", "Up next"));
        b.appendChild(h("b", null, "Next: S" + pad2(nx.s) + "E" + pad2(nx.e) + " \u2014 " + nx.t));
        b.onclick = function () { playEp(nx.s, nx.e); };
        nxBox.appendChild(b);
      }
      function paintList(eps, n) {
        listEl.textContent = "";
        if (!eps || !eps.length) { listEl.appendChild(h("div", "srnote", eps ? "No episode details yet for this season." : "Couldn't load episodes. Check your connection and reopen this panel.")); return; }
        var today = new Date().toISOString().slice(0, 10), curRow = null, nx = null;
        eps.forEach(function (x) {
          var cur = n === (ctx.s || 1) && x.n === (ctx.e || 1);
          var fut = x.d && x.d.slice(0, 10) > today;
          if (n === (ctx.s || 1) && x.n === (ctx.e || 1) + 1 && !fut) nx = { s: n, e: x.n, t: x.t };
          var r = h("button", "pepr" + (cur ? " on" : "") + (fut ? " off" : ""));
          r.appendChild(h("span", "pepn", "E" + x.n));
          var mid = h("div", "pepm");
          mid.appendChild(h("b", null, x.t || "Episode " + x.n));
          if (cur) mid.appendChild(h("span", "srlive", "NOW PLAYING")); else if (fut) mid.appendChild(h("span", "pepd", "Airs " + String(x.d).slice(0, 10)));
          r.appendChild(mid);
          r.onclick = function () { if (fut) { toast("Not aired yet"); return; } if (cur) { closeMenu(); return; } playEp(n, x.n); };
          listEl.appendChild(r);
          if (cur) curRow = r;
        });
        paintNext(nx || (n === (ctx.s || 1) ? nextInfo || null : null));
        if (curRow) setTimeout(function () { try { m.scrollTop = Math.max(0, curRow.offsetTop - 120); } catch (e) {} }, 0);
      }
      function pick(n) {
        var my = ++seq; sel = n;
        Array.prototype.forEach.call(chips.children, function (c) { c.className = "pepc" + (+c._n === n ? " on" : ""); });
        listEl.textContent = ""; listEl.appendChild(h("div", "srnote", "Loading episodes\u2026"));
        epsSeason(n, function (eps) { if (my === seq && !closed && menuEl === m) paintList(eps, n); });
      }
      function paintChips(list) {
        chips.textContent = "";
        if (!list || list.length < 2) return;
        list.forEach(function (x) { var c = h("button", "pepc", "S" + x.n); c._n = x.n; c.onclick = function () { pick(x.n); }; chips.appendChild(c); });
        Array.prototype.forEach.call(chips.children, function (c) { c.className = "pepc" + (+c._n === sel ? " on" : ""); });
      }
      root.appendChild(m); menuEl = m;
      clearTimeout(hideT);
      pick(sel);
      if (SEASON_LISTS[ctx.id]) paintChips(SEASON_LISTS[ctx.id]);
      else api("/api/title?type=tv&id=" + encodeURIComponent(ctx.id), 1, 15000).then(function (d) {
        var L = (d && d.seasons || []).filter(function (x) { return x && x.n >= 1; });
        SEASON_LISTS[ctx.id] = L;
        if (menuEl === m) paintChips(L);
      }).catch(function () {});
    }
    bEps.onclick = openEpisodes;
    // subtitle size and position, remembered on this device
    function openCCStyle() {
      function setS(k) { CCSIZE = k; lsSet("boa_ccsize", k); paintCCStyle(); openCCStyle(); }
      function setP(k) { CCPOS = k; lsSet("boa_ccpos", k); liftCues(v); refreshCC(v); openCCStyle(); }
      popMenu("Subtitle style", [
        { label: "Text size: Small", on: CCSIZE === "s", fn: function () { setS("s"); } },
        { label: "Text size: Medium", on: CCSIZE === "m", fn: function () { setS("m"); } },
        { label: "Text size: Large", on: CCSIZE === "l", fn: function () { setS("l"); } },
        { label: "Position: Bottom", on: CCPOS === "b", fn: function () { setP("b"); } },
        { label: "Position: Lower-mid", on: CCPOS === "m", fn: function () { setP("m"); } }
      ]);
    }
    bAa.onclick = openCCStyle;
    function nextEnded() {
      if (!nextInfo || nextDismissed || adActive) return;
      showNext();
      if (!nextEl || !nextEl._go) return;
      var n = 8, go = nextEl._go;
      go.textContent = "Playing in " + n;
      (function tick() { nextT = setTimeout(function () { n--; if (closed || nextDismissed) return; if (n <= 0) { playNext(); return; } go.textContent = "Playing in " + n; tick(); }, 1000); })();
    }

    // scrubbing
    function pos(ev) {
      var r = scrub.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      return Math.max(0, Math.min(1, x / r.width));
    }
    function dragMove(ev) {
      var f = pos(ev), d = v.duration || 0;
      sfill.style.width = f * 100 + "%"; sthumb.style.left = f * 100 + "%";
      stip.textContent = fmtT(f * d); stip.style.left = f * 100 + "%"; stip.style.opacity = "1";
      tim.textContent = fmtT(f * d) + " / " + fmtT(d);
      return f;
    }
    var dragging = false;
    scrub.addEventListener("pointerdown", function (ev) { dragging = true; seeking = true; try { scrub.setPointerCapture(ev.pointerId); } catch (e) {} dragMove(ev); showCtl(); });
    scrub.addEventListener("pointermove", function (ev) { if (dragging) dragMove(ev); });
    scrub.addEventListener("pointerup", function (ev) {
      if (!dragging) return;
      dragging = false;
      var f = dragMove(ev);
      if (v.duration) v.currentTime = f * v.duration;
      seeking = false;
      stip.style.opacity = "0";
      showCtl();
    });
    scrub.addEventListener("pointercancel", function () { dragging = false; seeking = false; stip.style.opacity = "0"; });

    // ----- close (saves progress first) -----
    function onKey(ev) {
      if (ev.key === " " || ev.key === "k") { ev.preventDefault(); toggle(); }
      else if (ev.key === "ArrowLeft") seekBy(-10);
      else if (ev.key === "ArrowRight") seekBy(10);
      else if (ev.key === "e" && ctx && ctx.mt === "tv") openEpisodes();
      else if (ev.key === "f") bFs.onclick();
      else if (ev.key === "m") bMute.onclick();
      else if (ev.key === "Escape" && !isFs()) closeP();
    }
    function onHide() { if (document.hidden) { wasPlaying = !v.paused && !adActive; save(true); } }
    function onShow() {
      if (document.hidden || closed || adActive) return;
      if (wasPlaying && v.paused && !v.ended && !document.pictureInPictureElement) { var q = v.play(); if (q && q.catch) q.catch(function () {}); }
      if (hls && !v.paused) { try { hls.startLoad(); } catch (e) {} }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("pagehide", onHide);
    function closeP() {
      if (closed) return;
      closed = true;
      if (ctx) { ctx.keep = null; ctx.rebind = null; }
      save(true);
      clearInterval(saveT); clearInterval(ambT); clearTimeout(hideT);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pagehide", onHide);
      clearTimeout(stallT); clearTimeout(nextT);
      PLSUBREFRESH = null;
      if (ccMo) { try { ccMo.disconnect(); } catch (e) {} ccMo = null; }
      if (SUBBLOB) { try { URL.revokeObjectURL(SUBBLOB); } catch (e) {} SUBBLOB = ""; }
      setStreaming(false); window.__vPlaying = null;
      unlockO(); closeMenu();
      try { if (mqL) { if (mqL.removeEventListener) mqL.removeEventListener("change", mqL._f); else if (mqL.removeListener) mqL.removeListener(mqL._f); } } catch (e) {}
      if (dash) { try { dash.reset(); } catch (e) {} dash = null; }
      try { if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
      try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch (e) {}
      if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
      root.className = "";
      root.textContent = "";
      document.body.style.overflow = "";
      // update the Library and the detail button right away
      if (tab === "lib") renderLib();
      if (tab === "me") renderMe();
      syncLibBadges();
      if (DETAILREF && ctx && String(DETAILREF.d.id) === String(ctx.id)) {
        DETAILREF.btn.innerHTML = ICON.play;
        DETAILREF.btn.appendChild(document.createTextNode(detailLabel(DETAILREF.d)));
      }
    }
    bX.onclick = closeP;
    showCtl();
  }
  var DETAILREF = null;

  // ---------- visitor heartbeat (anonymous; the server hashes the IP) ----------
  var STREAMING = false;
  function sourceName() {
    try {
      if (inTelegram() || (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData)) return "bot";
      if (isStandalone() || (window.matchMedia && (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches)) || window.navigator.standalone === true) return "app";
    } catch (e) {}
    return "web";
  }
  function setStreaming(on) {
    on = !!on;
    if (STREAMING === on) return;
    STREAMING = on;
    pingNow(true);
  }
  function rid() {
    var a = "", cs = "abcdefghijklmnopqrstuvwxyz0123456789";
    try { var u = new Uint8Array(12); crypto.getRandomValues(u); for (var i = 0; i < 12; i++) a += cs[u[i] % 36]; }
    catch (e) { for (var j = 0; j < 12; j++) a += cs[Math.floor(Math.random() * 36)]; }
    return a;
  }
  var VID = "", SID = "";
  try { VID = localStorage.getItem("boa_vid") || ""; if (!VID) { VID = rid(); localStorage.setItem("boa_vid", VID); } } catch (e) {}
  try { SID = sessionStorage.getItem("boa_sid") || ""; if (!SID) { SID = rid(); sessionStorage.setItem("boa_sid", SID); } } catch (e) {}
  if (!VID) VID = rid();
  if (!SID) SID = VID;
  function pingNow(edge) {
    try {
      fetch("/api/analytics/ping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: sourceName(), streaming: !!STREAMING, edge: edge === true, vid: VID, sid: SID }), keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pingNow); else pingNow();
  setInterval(function () { if (document.visibilityState === "visible") pingNow(); }, 60000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { if (window.__vPlaying && window.__vPlaying()) setStreaming(true); else pingNow(); }
    else setStreaming(false);
  });

  // ---------- themes ----------
  var THEMES = { crimson: ["#e50914", "229,9,20", "#fff"], white: ["#ffffff", "255,255,255", "#000"], ocean: ["#0ea5e9", "14,165,233", "#fff"], emerald: ["#10b981", "16,185,129", "#fff"] };
  function hexParts(hx) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hx || "");
    var n = parseInt(m ? m[1] : "e50914", 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function applyTheme() {
    var t = lsGet("boa_theme", "crimson");
    var am = lsGet("boa_amoled", "0") === "1";
    var c;
    if (t === "custom") {
      var hx = lsGet("boa_custom", "#e50914");
      var q = hexParts(hx);
      c = [hx, q.join(","), (q[0] * 299 + q[1] * 587 + q[2] * 114) / 1000 > 150 ? "#000" : "#fff"];
    } else c = THEMES[t] || THEMES.crimson;
    var r = document.documentElement.style;
    r.setProperty("--accent", c[0]); r.setProperty("--accent-rgb", c[1]); r.setProperty("--on-accent", c[2]);
    document.body.classList.toggle("amoled", am);
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute("content", am ? "#000000" : "#0a0a0a");
  }
  function themeCard() {
    var box = h("div", "themec");
    box.appendChild(h("h4", null, "Appearance"));
    var row = h("div", "throw");
    var cur = lsGet("boa_theme", "crimson");
    [["custom", "Custom"], ["white", "White"], ["crimson", "Crimson"], ["ocean", "Ocean"], ["emerald", "Emerald"]].forEach(function (t) {
      var b = h("button", "thb" + (cur === t[0] ? " on" : ""));
      var sw = h("i");
      if (t[0] === "custom") sw.style.background = "conic-gradient(#e50914,#f59e0b,#10b981,#0ea5e9,#9333ea,#e50914)";
      else sw.style.background = THEMES[t[0]][0];
      b.appendChild(sw);
      b.appendChild(document.createTextNode(t[1]));
      b.onclick = function () { lsSet("boa_theme", t[0]); applyTheme(); renderMe(); };
      row.appendChild(b);
    });
    box.appendChild(row);
    if (cur === "custom") {
      var cr = h("div", "thcol");
      var inp = h("input"); inp.type = "color"; inp.value = lsGet("boa_custom", "#e50914");
      inp.oninput = function () { lsSet("boa_custom", inp.value); applyTheme(); };
      cr.appendChild(inp);
      cr.appendChild(document.createTextNode("Pick your accent color"));
      box.appendChild(cr);
    }
    var sw2 = h("div", "thsw");
    sw2.appendChild(h("span", null, "AMOLED Black"));
    var tg2 = h("button", "tgl" + (lsGet("boa_amoled", "0") === "1" ? " on" : ""));
    tg2.setAttribute("aria-label", "AMOLED Black");
    tg2.onclick = function () { lsSet("boa_amoled", lsGet("boa_amoled", "0") === "1" ? "0" : "1"); applyTheme(); tg2.className = "tgl" + (lsGet("boa_amoled", "0") === "1" ? " on" : ""); };
    sw2.appendChild(tg2);
    box.appendChild(sw2);
    return box;
  }

  // ---------- tabs ----------
  function showTab(t) {
    tab = t;
    ["home", "search", "lib", "me"].forEach(function (k) { $("v-" + k).className = "view" + (k === t ? " on" : ""); });
    Array.prototype.forEach.call(document.querySelectorAll(".ni"), function (b) {
      b.className = "ni" + (b.getAttribute("data-tab") === t ? " on" : "");
    });
    if (t === "lib") renderLib();
    if (t === "me") renderMe();
    if (t === "search" && !discReady) discInit();
    window.scrollTo(0, 0);
    syncHash();
    if (typeof closePop === "function" && popOpen()) closePop();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".ni"), function (b) {
    b.onclick = function () {
      var t = b.getAttribute("data-tab");
      if (t === tab && t === "home") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      showTab(t);
    };
  });

  // ---------- cards ----------
  function makeCard(m, opts) {
    opts = opts || {};
    var b = h("button", "card");
    b.setAttribute("aria-label", m.t);
    var p = h("div", "poster");
    if (m.p) {
      var img = h("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = imgUrl(m.p, "w342");
      p.appendChild(img);
    } else {
      p.appendChild(h("span", "ph", m.t));
    }
    if (opts.badge && m.mt === "tv") p.appendChild(h("span", "badge", "SERIES"));
    if (opts.soon && m.d) p.appendChild(h("span", "badge soon", shortDate(m.d)));
    if (opts.nf) p.appendChild(h("span", "nfb", "N"));
    b.setAttribute("data-k", m.mt + "_" + m.id);
    if (opts.nolib) b.setAttribute("data-nl", "1");
    else if (libHas(m.mt, m.id)) p.appendChild(h("span", "inlib", "\u2713"));
    var unrelC = isUnreleased(m);
    var plBadge = h("span", "pplay" + (unrelC ? " off" : ""));
    plBadge.innerHTML = ICON.play;
    plBadge.onclick = function (ev) {
      ev.stopPropagation();
      if (unrelC) { toast("Not released yet" + (m.d ? ": " + fmtDate(m.d) : "")); return; }
      openStreams(m.mt, m.id, m.t, 1, 1, { p: m.p, y: m.y, b: m.b });
    };
    p.appendChild(plBadge);
    b.appendChild(p);
    b.appendChild(h("div", "ct", m.t));
    b.appendChild(h("div", "cy", opts.soon ? (m.d ? fmtDate(m.d) : "Coming soon") : (m.y || "")));
    b.onclick = function () { openTitle(m.mt, m.id); };
    return b;
  }
  function skeletonStrip(n) {
    var s = h("div", "strip");
    for (var i = 0; i < n; i++) {
      var c = h("div", "card skc");
      var p = h("div", "poster sk");
      c.appendChild(p);
      c.appendChild(h("div", "ct", "\u00a0"));
      s.appendChild(c);
    }
    return s;
  }

  // ---------- hero ----------
  function stopHero() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }
  function showSlide(i) {
    var slides = $("hero").querySelectorAll(".slide");
    var dots = $("hero").querySelectorAll(".dot");
    heroIdx = i;
    for (var k = 0; k < slides.length; k++) {
      slides[k].className = "slide" + (k === i ? " on" : "");
      if (dots[k]) dots[k].className = "dot" + (k === i ? " on" : "");
    }
  }
  function startHero() {
    stopHero();
    if (heroItems.length < 2) return;
    heroTimer = setInterval(function () {
      if (document.hidden || tab !== "home" || $("detail").className === "open") return;
      showSlide((heroIdx + 1) % heroItems.length);
    }, 6500);
  }
  function failHero() {
    stopHero();
    $("hero").style.display = "none";
    $("seg").style.display = "none";
    mountSegFallback();
  }
  function mountSegFallback() {
    if ($("segfb")) return;
    var w = h("div", "pills");
    w.id = "segfb";
    w.style.paddingTop = "calc(var(--sat) + 14px)";
    w.style.paddingLeft = "140px";
    var a = h("button", "pill" + (media === "movie" ? " sel" : ""), "Movies");
    var b = h("button", "pill" + (media === "tv" ? " sel" : ""), "Series");
    a.onclick = function () { setMedia("movie"); };
    b.onclick = function () { setMedia("tv"); };
    w.appendChild(a); w.appendChild(b);
    $("v-home").insertBefore(w, $("hero"));
  }
  function setHero(list) {
    var items = list.filter(function (m) { return m.p || m.b; }).slice(0, 6);
    if (!items.length) { failHero(); return; }
    heroItems = items;
    var hero = $("hero");
    hero.textContent = "";
    hero.appendChild(segEl);
    hero.className = "ready";
    items.forEach(function (m) {
      var slide = h("div", "slide");
      var img = h("img", "bg");
      img.alt = "";
      img.src = imgUrl(m.p || m.b, "w780");
      slide.appendChild(img);
      var info = h("div", "hinfo");
      var title = h("h1", "htitle", m.t);
      info.appendChild(title);
      var meta = [m.mt === "tv" ? "Series" : "Movie", m.g, m.y].filter(Boolean).join("  \u2022  ");
      info.appendChild(h("div", "hmeta", meta));
      var btn = h("button", "pillbtn", "View Details");
      btn.onclick = function () { openTitle(m.mt, m.id); };
      info.appendChild(btn);
      slide.appendChild(info);
      hero.appendChild(slide);
      api("/api/logo?type=" + m.mt + "&id=" + m.id, 0).then(function (r) {
        if (!r || !r.l) return;
        var lg = h("img", "hlogo");
        lg.alt = m.t;
        lg.onload = function () { if (title.parentNode) info.replaceChild(lg, title); };
        lg.src = IMG + "w500" + r.l;
      }).catch(function () {});
    });
    var dots = h("div", "dots");
    items.forEach(function (m, i) {
      var d = h("button", "dot");
      d.setAttribute("aria-label", "Slide " + (i + 1));
      d.onclick = function () { showSlide(i); startHero(); };
      dots.appendChild(d);
    });
    hero.appendChild(dots);
    showSlide(0);
    startHero();
  }
  (function () {
    var sx = null;
    var hero = $("hero");
    hero.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener("touchend", function (e) {
      if (sx === null || heroItems.length < 2) { sx = null; return; }
      var dx = e.changedTouches[0].clientX - sx;
      sx = null;
      if (Math.abs(dx) > 50) {
        showSlide((heroIdx + (dx < 0 ? 1 : heroItems.length - 1)) % heroItems.length);
        startHero();
      }
    }, { passive: true });
  })();

  // ---------- movies / series ----------
  function paintSeg() {
    $("segm").className = media === "movie" ? "on" : "";
    $("segt").className = media === "tv" ? "on" : "";
    var fb = $("segfb");
    if (fb) { fb.children[0].className = "pill" + (media === "movie" ? " sel" : ""); fb.children[1].className = "pill" + (media === "tv" ? " sel" : ""); }
  }
  function setMedia(mk) {
    if (mk === media) return;
    media = mk;
    try { localStorage.setItem("boa_media", mk); } catch (e) {}
    paintSeg();
    loadHome();
  }
  $("segm").onclick = function () { setMedia("movie"); };
  $("segt").onclick = function () { setMedia("tv"); };

  // ---------- home rows ----------
  function rowTitle(r, mk) {
    mk = mk || media;
    if (r.key === "trending") return "Trending " + (mk === "tv" ? "Series" : "Movies");
    return clean(r.title);
  }
  function loadRow(section, key, seq) {
    api("/api/row?type=" + media + "&name=" + encodeURIComponent(key)).then(function (list) {
      if (seq !== homeSeq) return;
      var strip = section.querySelector(".strip");
      strip.textContent = "";
      if (!list.length) {
        section.remove();
        var chip = document.querySelector('#catlist [data-key="' + key + '"]');
        if (chip) chip.remove();
        if (key === "trending") failHero();
        return;
      }
      list.forEach(function (m) {
        strip.appendChild(makeCard(m, { nf: key.indexOf("netflix") === 0, soon: key.indexOf("upcoming") === 0 && key !== "upcoming_boa" || (key === "upcoming_boa" && !!m.d) }));
      });
      if (key === "trending") setHero(list);
    }).catch(function () {
      if (seq !== homeSeq) return;
      var strip = section.querySelector(".strip");
      strip.textContent = "";
      var box = h("div", "note", "Couldn't load this row.");
      var rb = h("button", "retry", "Retry");
      rb.onclick = function () { strip.textContent = ""; strip.appendChild(skeletonStrip(4)); loadRow(section, key, seq); };
      box.appendChild(rb);
      strip.appendChild(box);
      if (key === "trending") failHero();
    });
  }
  function buildRows(rows, seq) {
    var holder = $("rows");
    var io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            io.unobserve(en.target);
            loadRow(en.target, en.target.getAttribute("data-key"), seq);
          }
        });
      }, { rootMargin: "700px 0px" });
    }
    rows.forEach(function (r) {
      var sec = h("section", "row");
      sec.setAttribute("data-key", r.key);
      sec.appendChild(h("h2", null, rowTitle(r)));
      sec.appendChild(skeletonStrip(4));
      holder.appendChild(sec);
      if (io) io.observe(sec); else loadRow(sec, r.key, seq);
    });
  }
  function closeCats() {
    $("catmenu").classList.remove("open");
    document.body.classList.remove("catopen");
  }
  function openCats() {
    $("catmenu").classList.add("open");
    document.body.classList.add("catopen");
    $("catlist").scrollTop = 0;
  }
  $("catclose").onclick = closeCats;
  $("catmenu").onclick = function (e) { if (e.target === this || e.target === $("catlist")) closeCats(); };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCats(); });
  function fillChips(rows) {
    var bar = $("chips");
    var list = $("catlist");
    bar.textContent = "";
    list.textContent = "";
    closeCats();
    rows.forEach(function (r) {
      if (r.key === "trending") return;
      var b = h("button", "catitem" + (list.children.length ? "" : " first"), clean(r.title));
      b.setAttribute("data-key", r.key);
      b.onclick = function () {
        closeCats();
        setTimeout(function () { jumpTo(r.key); }, 80);
      };
      list.appendChild(b);
    });
    if (!list.children.length) return;
    var btn = h("button", "catbtn");
    btn.innerHTML = '<span>Categories</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>';
    btn.onclick = openCats;
    bar.appendChild(btn);
  }
  function jumpTo(key) {
    var sec = document.querySelector('#rows [data-key="' + key + '"]');
    if (sec) window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - 16, behavior: "smooth" });
  }
  function loadHome() {
    var seq = ++homeSeq;
    stopHero();
    heroItems = [];
    var hero = $("hero");
    hero.textContent = "";
    hero.appendChild(segEl);
    hero.className = "sk";
    hero.style.display = "";
    $("seg").style.display = "";
    var fb = $("segfb");
    if (fb) fb.remove();
    $("chips").style.paddingTop = "";
    $("chips").textContent = "";
    $("rows").textContent = "";
    window.scrollTo(0, 0);
    api("/api/rows?type=" + media).then(function (rows) {
      if (seq !== homeSeq) return;
      buildRows(rows, seq);
      fillChips(rows);
      applyDeepLink();
    }).catch(function () {
      if (seq !== homeSeq) return;
      failHero();
      var box = h("div", "note", "Couldn't load titles. Check your connection and try again.");
      var rb = h("button", "retry", "Retry");
      rb.onclick = function () { loadHome(); };
      box.appendChild(rb);
      $("rows").appendChild(box);
    });
  }

  // ---------- search ----------
  function runSearch(v) {
    var seq = ++searchSeq;
    var box = $("results");
    $("disc").style.display = "none";
    box.style.display = "block";
    box.textContent = "";
    box.appendChild(h("div", "note center", "Searching\u2026"));
    api("/api/search?q=" + encodeURIComponent(v)).then(function (list) {
      if (seq !== searchSeq) return;
      box.textContent = "";
      if (!list.length) { box.appendChild(h("div", "note center", "No results for \u201c" + v + "\u201d. Try another title.")); return; }
      var g = h("div", "grid");
      list.forEach(function (m) { g.appendChild(makeCard(m, { badge: true, nolib: true })); });
      box.appendChild(g);
    }).catch(function () {
      if (seq !== searchSeq) return;
      box.textContent = "";
      var n = h("div", "note center", "Search failed. ");
      var rb = h("button", "retry", "Try again");
      rb.onclick = function () { runSearch(v); };
      n.appendChild(rb);
      box.appendChild(n);
    });
  }
  $("q").addEventListener("input", function () {
    clearTimeout(timer);
    var v = this.value.trim();
    if (v.length < 2) {
      searchSeq++;
      $("results").textContent = "";
      $("results").style.display = "none";
      $("disc").style.display = "";
      return;
    }
    timer = setTimeout(function () { runSearch(v); }, 350);
  });
  $("q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { clearTimeout(timer); var v = this.value.trim(); if (v.length > 1) runSearch(v); this.blur(); }
  });

  // ---------- discover (Search tab) ----------
  var discReady = false, dMedia = "movie", dKey = "trending", dGenre = "", dRows = {}, dSeq = 0;
  var GENRE_KEYS = ["action", "comedy", "thriller", "horror", "romance", "scifi", "crime", "mystery", "animation", "documentary", "family", "drama"];
  function opt(v, t) { var o = h("option", null, t); o.value = v; return o; }
  function discInit() {
    discReady = true;
    dMedia = media;
    $("dtype").value = dMedia;
    discRows();
  }
  function discRows() {
    var mk = dMedia;
    var go = function (rows) {
      dRows[mk] = rows;
      if (mk !== dMedia) return;
      var cat = $("dcat"), gen = $("dgenre");
      cat.textContent = ""; gen.textContent = "";
      gen.appendChild(opt("", "All Genres"));
      rows.forEach(function (r) {
        if (r.key === "faith" || r.key === "toprated" || GENRE_KEYS.indexOf(r.key) < 0) cat.appendChild(opt(r.key, rowTitle(r, mk)));
        if (GENRE_KEYS.indexOf(r.key) > -1) gen.appendChild(opt(r.key, clean(r.title)));
      });
      if (!Array.prototype.some.call(cat.options, function (o) { return o.value === dKey; })) dKey = "trending";
      cat.value = dKey;
      gen.value = dGenre;
      loadDisc();
    };
    if (dRows[mk]) go(dRows[mk]);
    else api("/api/rows?type=" + mk).then(go).catch(function () {
      $("dgrid").textContent = "";
      $("dgrid").appendChild(h("div", "note", "Couldn't load. Check your connection."));
    });
  }
  function loadDisc() {
    var seq = ++dSeq;
    var key = dGenre || dKey;
    var grid = $("dgrid");
    $("dsub").textContent = "Boa Cinema \u2022 " + (dMedia === "tv" ? "Series" : "Movies");
    grid.textContent = "";
    var sk = h("div", "grid");
    for (var i = 0; i < 6; i++) { var c = h("div", "card skc"); c.appendChild(h("div", "poster sk")); sk.appendChild(c); }
    grid.appendChild(sk);
    api("/api/row?type=" + dMedia + "&name=" + encodeURIComponent(key)).then(function (list) {
      if (seq !== dSeq) return;
      grid.textContent = "";
      if (!list.length) { grid.appendChild(h("div", "note", "Nothing here yet.")); return; }
      var g = h("div", "grid");
      var soon = key.indexOf("upcoming") === 0;
      list.forEach(function (m) { g.appendChild(makeCard(m, { soon: soon && (key !== "upcoming_boa" || !!m.d) })); });
      grid.appendChild(g);
    }).catch(function () {
      if (seq !== dSeq) return;
      grid.textContent = "";
      var n = h("div", "note", "Couldn't load this list. ");
      var rb = h("button", "retry", "Retry");
      rb.onclick = loadDisc;
      n.appendChild(rb);
      grid.appendChild(n);
    });
  }
  $("dtype").onchange = function () { dMedia = this.value; dKey = "trending"; dGenre = ""; discRows(); };
  $("dcat").onchange = function () { dKey = this.value; dGenre = ""; $("dgenre").value = ""; loadDisc(); };
  $("dgenre").onchange = function () { dGenre = this.value; loadDisc(); };

  // ---------- library and profile ----------
  function libSection(title) {
    var s = h("div", "sec");
    s.appendChild(h("h3", null, title));
    return s;
  }
  function watchCard(o) {
    var tv = o.m === "tv";
    var b = h("div", "wcard");
    b.setAttribute("role", "button");
    var img = o.b || o.p;
    if (img) { var im = h("img"); im.loading = "lazy"; im.alt = ""; im.src = imgUrl(img, o.b ? "w500" : "w342"); if (!o.b) im.style.objectPosition = "center 20%"; b.appendChild(im); }
    b.appendChild(h("div", "wshade"));
    var badge = tv ? ((o.nx ? "Next: " : "") + "S" + (o.s || 1) + " E" + (o.e || 1)) : (o.dur > 0 ? Math.max(1, Math.round((o.dur - o.pos) / 60)) + "m left" : "Resume");
    b.appendChild(h("span", "wbadge", badge));
    b.appendChild(h("div", "wtitle", o.t));
    var pl = h("button", "wplay");
    pl.innerHTML = ICON.play;
    pl.setAttribute("aria-label", "Resume");
    pl.onclick = function (ev) {
      ev.stopPropagation();
      openStreams(o.m, o.i, o.t + (tv ? " (S" + (o.s || 1) + "E" + (o.e || 1) + ")" : ""), o.s || 1, o.e || 1, { p: o.p, y: o.y, b: o.b }, o.nx ? 0 : (o.pos || 0), !o.nx && o.pos > 0);
    };
    b.appendChild(pl);
    if (o.dur > 0 && o.pos > 0 && !o.nx) {
      var pr = h("div", "wprog");
      var bar = h("i");
      bar.style.width = Math.min(100, Math.max(3, Math.round(o.pos / o.dur * 100))) + "%";
      pr.appendChild(bar);
      b.appendChild(pr);
    }
    b.onclick = function () { openTitle(o.m, o.i); };
    if (LIBEDIT) {
      var x = h("button", "xbtn", "\u00D7");
      x.setAttribute("aria-label", "Remove");
      x.onclick = function (ev) { ev.stopPropagation(); watchDrop(o.m, o.i); renderLib(); };
      b.appendChild(x);
    }
    return b;
  }
  function renderLib() {
    var box = $("libgrid");
    box.textContent = "";
    var p = curProfile();
    var who = h("button", "whoami");
    var av = avatarEl(p, "pav sm");
    who.appendChild(av);
    who.appendChild(h("span", null, "Watching as " + p.n));
    who.onclick = function () { openProfiles(true); };
    box.appendChild(who);

    var cont = WATCH.filter(function (w) { return !w.nx; }).sort(function (a, b) { return (b.a || 0) - (a.a || 0); });
    var next = WATCH.filter(function (w) { return w.nx; }).sort(function (a, b) { return (b.a || 0) - (a.a || 0); });
    if (cont.length) {
      var s1 = libSection("Continue Watching");
      var st1 = h("div", "strip");
      cont.forEach(function (o) { st1.appendChild(watchCard(o)); });
      s1.appendChild(st1);
      box.appendChild(s1);
    }
    if (next.length) {
      var s2 = libSection("Watch Next");
      var st2 = h("div", "strip");
      next.forEach(function (o) { st2.appendChild(watchCard(o)); });
      s2.appendChild(st2);
      box.appendChild(s2);
    }
    var s3 = libSection("My List (" + LIB.length + ")");
    var bar = h("div", "libbar");
    [["all", "All"], ["movie", "Movies"], ["tv", "Series"]].forEach(function (f) {
      var pb = h("button", "pill" + (LIBF === f[0] ? " sel" : ""), f[1]);
      pb.onclick = function () { LIBF = f[0]; renderLib(); };
      bar.appendChild(pb);
    });
    var sb = h("button", "pill", LIBSORT === "recent" ? "Recent" : "A–Z");
    sb.onclick = function () { LIBSORT = LIBSORT === "recent" ? "az" : "recent"; renderLib(); };
    bar.appendChild(sb);
    var eb = h("button", "pill" + (LIBEDIT ? " sel" : ""), LIBEDIT ? "Done" : "Edit");
    eb.onclick = function () { LIBEDIT = !LIBEDIT; renderLib(); };
    bar.appendChild(eb);
    s3.appendChild(bar);
    var items = LIB.filter(function (o) { return LIBF === "all" || o.m === LIBF; });
    items.sort(LIBSORT === "az" ? function (a, b) { return String(a.t).localeCompare(String(b.t)); } : function (a, b) { return (b.a || 0) - (a.a || 0); });
    if (!items.length) {
      s3.appendChild(h("div", "note center", LIB.length ? "Nothing here with this filter." : "Your list is empty. Open any title and tap + to save it here."));
    } else {
      var g = h("div", "grid");
      items.forEach(function (o) {
        var c = makeCard({ id: o.i, mt: o.m, t: o.t, p: o.p, y: o.y }, { badge: true, nolib: true });
        if (LIBEDIT) {
          var x = h("button", "xbtn", "×");
          x.setAttribute("aria-label", "Remove");
          x.onclick = function (ev) { ev.stopPropagation(); libRemove(o.m, o.i); renderLib(); };
          c.firstChild.appendChild(x);
        }
        g.appendChild(c);
      });
      s3.appendChild(g);
    }
    box.appendChild(s3);
  }
  function renderMe() {
    var box = $("v-me");
    box.textContent = "";
    var u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    var name = u ? ((u.first_name || "") + (u.last_name ? " " + u.last_name : "")).trim() : "";
    var wrap = h("div", "me");
    var big = h("div", "big");
    if (u && u.photo_url) {
      var im = h("img"); im.alt = ""; im.src = u.photo_url; big.appendChild(im);
    } else {
      big.textContent = (name || "B").charAt(0).toUpperCase();
    }
    wrap.appendChild(big);
    wrap.appendChild(h("h2", null, name || "Boa Cinema"));
    wrap.appendChild(h("p", null, u && u.username ? "@" + u.username : "Guest"));
    box.appendChild(wrap);
    var icd = installCard();
    if (icd) box.appendChild(icd);
    box.appendChild(themeCard());
    var list = h("div", "list");
    function item(label, val, fn, cls) {
      var b = h("button", "li" + (cls ? " " + cls : ""), label);
      if (val) b.appendChild(h("span", null, val));
      b.onclick = fn;
      list.appendChild(b);
    }
    item("Who's watching", curProfile().n, function () { openProfiles(true); });
    item("Library", LIB.length + (LIB.length === 1 ? " title" : " titles"), function () { showTab("lib"); });
    if (WATCH.length) item("Clear watch history", WATCH.length + "", function () { watchClear(); renderMe(); toast("History cleared"); }, "danger");
    if (myCC) item("Your region", flag(myCC) + " " + cname(myCC), function () {});
    item("Open the bot", "@Boa_entertainment_bot", function () {
      var url = "https://t.me/Boa_entertainment_bot";
      if (tg && tg.openTelegramLink) { try { tg.openTelegramLink(url); return; } catch (e) {} }
      openLink(url);
    });
    if (IS_OWNER) item("Owner panel", "Only you", openAdmin);
    item("Get the add-on", "Stremio style", function () { openLink(location.origin + "/addon"); });
    if (LIB.length) item("Clear library", "", function () {
      function wipe() {
        if (cloud) { LIB.forEach(function (o) { try { cloud.removeItem(libKey(o.m, o.i)); } catch (e) {} }); }
        watchClear();
        LIB = [];
        libSaveLocal();
        renderMe();
        toast("Library cleared");
      }
      if (tg && tg.showConfirm) { try { tg.showConfirm("Remove every saved title?", function (ok) { if (ok) wipe(); }); return; } catch (e) {} }
      if (window.confirm("Remove every saved title?")) wipe();
    }, "danger");
    box.appendChild(list);
    var f = h("footer");
    f.appendChild(h("p", null, "Movie data and images by TMDB. Streaming availability by JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB. Boa Entertainment is a discovery platform and does not host or stream any media. Netflix is a trademark of Netflix, Inc. Boa Entertainment is not affiliated with Netflix."));
    box.appendChild(f);
  }
  function paintNavAvatar() {
    var u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    var a = $("navav");
    var p = curProfile();
    if (p && PROFILES.length > 1) {
      a.textContent = String(p.n || "B").charAt(0).toUpperCase();
      a.style.background = AVC[(p.c || 0) % AVC.length];
      return;
    }
    a.style.background = "";
    if (!u) return;
    if (u.photo_url) {
      a.textContent = "";
      var im = h("img"); im.alt = ""; im.src = u.photo_url; a.appendChild(im);
    } else {
      a.textContent = (u.first_name || "B").charAt(0).toUpperCase();
    }
  }

  // ---------- details page ----------
  function lockPage(on) {
    document.body.style.overflow = on ? "hidden" : "";
    document.body.className = on ? "lock" : "";
  }
  function openTitle(mt, id) {
    stack.push({ mt: mt, id: String(id) });
    try { history.pushState({ d: stack.length }, ""); histOK = true; } catch (e) { histOK = false; }
    showDetail();
    syncHash();
  }
  function showDetail() {
    var top = stack[stack.length - 1];
    if (!top) { closeDetailUI(); return; }
    var seq = ++detailSeq;
    var det = $("detail");
    det.className = "open";
    det.scrollTop = 0;
    $("dbar").className = "show";
    $("dbt").textContent = "";
    $("dlib").style.visibility = "hidden";
    lockPage(true);
    if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (e) {} }
    var body = $("dbody");
    body.textContent = "";
    var key = top.mt + ":" + top.id;
    if (titleCache[key]) { renderDetail(titleCache[key]); return; }
    body.appendChild(h("div", "load", "Loading\u2026"));
    api("/api/title?type=" + top.mt + "&id=" + encodeURIComponent(top.id)).then(function (d) {
      if (seq !== detailSeq) return;
      titleCache[key] = d;
      renderDetail(d);
    }).catch(function () {
      if (seq !== detailSeq) return;
      body.textContent = "";
      var n = h("div", "note center", "Couldn't load this title. ");
      var rb = h("button", "retry", "Try again");
      rb.onclick = function () { showDetail(); };
      n.appendChild(rb);
      body.appendChild(n);
    });
  }
  function closeDetailUI() {
    detailSeq++;
    $("detail").className = "";
    $("dbar").className = "";
    $("dbody").textContent = "";
    lockPage(false);
    if (tg && tg.BackButton) { try { tg.BackButton.hide(); } catch (e) {} }
  }
  function goBack() {
    if (!stack.length) return;
    if (histOK) { try { history.back(); return; } catch (e) {} }
    stack.pop();
    showDetail();
    syncHash();
  }
  window.addEventListener("popstate", function () {
    if (stack.length) stack.pop();
    if (stack.length) showDetail(); else closeDetailUI();
  });
  $("dback").onclick = goBack;
  if (tg && tg.BackButton) { try { tg.BackButton.onClick(goBack); } catch (e) {} }
  $("detail").addEventListener("scroll", function () {
    $("dbar").className = "show" + (this.scrollTop > 260 ? " solid" : "");
  }, { passive: true });

  function section(title) {
    var s = h("div", "sec");
    s.appendChild(h("h3", null, title));
    return s;
  }
$("smclose").onclick = function () {
    STRM_TOK++; clearTimeout(STRM_T);
    $("streammodal").classList.remove("open");
    $("smplayer").style.display = "none";
    $("smplayer").textContent = "";
  };
  function openStreams(mt, id, title, s, e, meta, resumeAt, auto) {
    paintPriv();
    loadSubs(mt, id, s, e);
    CUR = { mt: mt, id: id, title: title, base: String(title || "").replace(/ \(S\d+E\d+\)$/, ""), s: s || 1, e: e || 1, meta: meta || {}, resumeAt: resumeAt || 0, auto: !!auto };
    var slowT = setTimeout(function () {
      var f = $("smlist").firstChild;
      if (f && f.className === "note center") f.textContent = "Still searching providers… the first search for a title can take up to a minute.";
    }, 8000);
    var modal = $("streammodal");
    var list = $("smlist");
    var player = $("smplayer");
    $("smtitle").textContent = title || "Streams";
    player.style.display = "none";
    player.textContent = "";
    list.textContent = "";
    list.appendChild(h("div", "note center", "Please Wait\u2026"));
    modal.classList.add("open");

    var tok = ++STRM_TOK; clearTimeout(STRM_T);
    // Progressive fetch: the server answers with whatever has arrived so far (long-poll). The first playable stream builds the
    // Server Room at once (and auto-starts it); later answers are merged in without touching a stream that is already playing.
    var acc = [], seenAcc = {}, started = false, more = null;
    function pause(ms) { return new Promise(function (res) { STRM_T = setTimeout(res, ms); }); }
    function onBatch(batch) {
      if (!batch.length || tok !== STRM_TOK) return;
      if (!started) { started = true; begin(acc); }
      else { addStreamSubs(batch); if (more) more(); }
    }
    function run(attempt) {
      var t0 = Date.now(), errs = 0;
      function step(seen) {
        if (tok !== STRM_TOK) return Promise.resolve("x");
        return api("/api/streams?p=1&type=" + mt + "&id=" + encodeURIComponent(id) + "&s=" + (s || 1) + "&e=" + (e || 1) + "&n=" + seen + "&r=" + (attempt ? 1 : 0), 0, 15000)
          .catch(function () { return null; })
          .then(function (r) {
            if (tok !== STRM_TOK) return "x";
            if (Array.isArray(r)) r = { streams: r, n: r.length, done: true };      // plain-array answer (older server)
            if (!r || !Array.isArray(r.streams)) { if (++errs > 2) return "err"; return pause(1500).then(function () { return step(seen); }); }
            var batch = [];
            r.streams.forEach(function (x) { if (x && x.url && !seenAcc[x.url]) { seenAcc[x.url] = 1; acc.push(x); batch.push(x); } });
            onBatch(batch);
            if (r.done || Date.now() - t0 > 50000) return "done";
            return step(r.n || seen);
          });
      }
      return step(0).then(function (st) {
        if (tok !== STRM_TOK || st === "x" || started) return;
        if (attempt >= 2) {
          clearTimeout(slowT);
          if (st === "err") throw new Error("timeout");
          list.textContent = "";
          list.appendChild(h("div", "note center", "No stream returned."));
          return;
        }
        var f = $("smlist").firstChild;
        if (f && f.className === "note center") f.textContent = "Still checking sources… (try " + (attempt + 2) + " of 3)";
        return pause(attempt ? 5000 : 3000).then(function () { return tok === STRM_TOK ? run(attempt + 1) : null; });
      });
    }
    function begin(streams) {
        if (tok !== STRM_TOK) return;
        clearTimeout(slowT);
        list.textContent = "";
        addStreamSubs(streams);
        // ---- size / resolution picker above the servers: filters what is shown, never what is fetched ----
        var host = h("div", "srvhost"), bar = h("div", "tierbar");
        function chipRow(label, opts, get, set) {
          var row = h("div", "tierrow");
          row.appendChild(h("span", "tierlb", label));
          opts.forEach(function (o) {
            var c = h("button", "tierchip" + (get() === o[0] ? " on" : ""), o[1]);
            c.onclick = function () {
              set(o[0]);
              Array.prototype.forEach.call(row.querySelectorAll(".tierchip"), function (x, i) { x.className = "tierchip" + (opts[i][0] === get() ? " on" : ""); });
              renderServers();
            };
            row.appendChild(c);
          });
          return row;
        }
        bar.appendChild(chipRow("Quality", [["any", "Any"], ["380", "380p"], ["480", "480p"], ["720", "720p"], ["1080", "1080p"], ["2160", "4K"], ["4320", "8K"]], function () { return TIER; }, function (v) { TIER = v; lsSet("boa_tier", v); }));
        bar.appendChild(chipRow("Max size", [["auto", "Auto"], ["1", "1 GB"], ["2", "2 GB"], ["5", "5 GB"], ["10", "10 GB"], ["inf", "10 GB+"]], function () { return MAXG; }, function (v) { MAXG = v; lsSet("boa_maxgb", v); }));
        list.appendChild(bar); list.appendChild(host);
        var PREV = [];
        function playerOpen() { var pl = $("player"); return !!pl && /(^|\s)open(\s|$)/.test(pl.className); }
        function ukey(u) {
          if (/^magnet:/i.test(u)) return String(u).slice(0, 60);
          var p = String(u).replace(/#.*$/, ""), q = p.indexOf("?");
          return q > -1 && /\.[a-z0-9]{2,5}$/i.test(p.slice(0, q)) ? p.slice(0, q) : p;
        }
        // append = true while a stream is playing: existing servers keep their slot and state, only empty slots get filled
        function renderServers(append) {
        var APP = !!append && PREV.length > 0 && playerOpen();
        if (append && !APP && PREV.length === 0 && !playerOpen()) append = false;
        if (!APP) host.textContent = "";
        // ---- Provider-to-Server pipeline: score every stream, drop duplicates, show SERVER 1-4 with signal lights ----
        function fmtOf(x) {
          var u = String(x.url || ""), t = String(x.title || "") + " " + String(x.name || "");
          if (!u || /^magnet:/i.test(u)) return "torrent";
          if (/\/embed\/|\.html?($|\?)/i.test(u)) return "embed";
          if (/\.m3u8(\?|$)/i.test(u)) return "hls";
          if (/\.mp4(\?|$)/i.test(u)) return "mp4";
          if (/\.mkv(\?|$)/i.test(u)) return "mkv";
          if (/\.avi(\?|$)/i.test(u)) return "avi";
          if (/\.mpd(\?|$)/i.test(u)) return "dash";
          if (/\bmkv\b/i.test(t)) return "mkv";
          return "file";
        }
        function sizeGB(x) {
          var m = /(\d+(?:\.\d+)?)\s?(GB|GiB|MB|MiB)/i.exec(String(x.title || "") + " " + String(x.name || "") + " " + (typeof x.size === "string" ? x.size : ""));
          if (m) return /G/i.test(m[2]) ? +m[1] : +m[1] / 1024;
          var b = +x.size;                                   // plain number = bytes (Stremio videoSize)
          return b > 1048576 ? b / 1073741824 : 0;
        }
        function scoreOf(x) {
          var f = fmtOf(x), t = String(x.title || "") + " " + String(x.name || ""), gb = sizeGB(x);
          var heavy = f === "mkv" || f === "avi" || /hevc|x265|h\.?265|remux|dts|ac3|e-?ac-?3|dd\+?5|truehd|atmos|2160p|\b4k\b/i.test(t) || gb > 3;
          var qm = /(\d{3,4})p/i.exec(String(x.quality || "") + " " + t), q = qm ? +qm[1] : (/8k|4320/i.test(String(x.quality || "") + t) ? 4320 : (/4k|uhd/i.test(String(x.quality || "") + t) ? 2160 : 0));
          if (q >= 2160) heavy = true;
          if (f === "torrent") return { f: "torrent", heavy: true, tor: true, q: q, sc: 1 + Math.min(+x.seeders || 0, 1000) / 100, gb: gb, over: false, seed: +x.seeders || 0 };
          // format: HLS 100 > MP4 80 > MKV 10
          var sc = f === "hls" ? 100 : f === "mp4" ? 80 : f === "dash" ? 60 : f === "file" ? 50 : f === "embed" ? 20 : f === "mkv" ? 10 : f === "avi" ? 5 : 20;
          // resolution: 1080p 30 > 720p 20 > 4K 10 (4K is heavy on mobile bandwidth and codecs)
          sc += q === 1080 ? 30 : q === 720 ? 20 : q >= 2160 ? 10 : q >= 1000 ? 28 : q >= 480 ? 8 : q >= 360 ? 4 : 0;
          if (/cam|hdcam|telesync|\bts\b/i.test(t)) sc -= 40;
          // file size: over 3 GB loses points, over 5 GB is rejected unless nothing smaller exists
          if (gb > 3) sc -= 20 + Math.round((gb - 3) * 10);
          return { f: f, heavy: heavy, q: q, sc: sc, gb: gb, over: gb > 5 };
        }
        function tierOf(q) { return !q ? 0 : q <= 400 ? 380 : q <= 576 ? 480 : q <= 900 ? 720 : q <= 1300 ? 1080 : q <= 2500 ? 2160 : 4320; }
        // hard filter: a stream outside the chosen tier or above the chosen size ceiling is never shown, routed or auto-played
        function pickOk(sd) {
          if (TIER !== "any" && tierOf(sd.q) !== +TIER) return false;
          if (MAXG !== "auto" && MAXG !== "inf" && sd.gb > +MAXG) return false;
          return true;
        }
        var pool = [], seenU = {}, total = 0;
        streams.forEach(function (x) {
          if (!x || !x.url) return;
          var sd = scoreOf(x);
          total++;
          if (!pickOk(sd)) return;
          var key = ukey(x.url);
          if (seenU[key]) return;
          seenU[key] = 1;
          pool.push({ st: x, sd: sd });
        });
        // the stream that was playing before a refresh / filter change / update stays in the list (unless the user's own filter excludes it)
        var LP = CUR ? lpGet(CUR) : null, lpK = LP ? ukey(LP.url) : "";
        if (LP && !seenU[lpK]) {
          var lsd = scoreOf(LP);
          if (!lsd.tor && pickOk(lsd)) { seenU[lpK] = 1; pool.push({ st: LP, sd: lsd }); }
        }
        if (MAXG === "auto" && pool.some(function (e) { return !e.sd.over || (LP && ukey(e.st.url) === lpK); })) pool = pool.filter(function (e) { return !e.sd.over || (LP && ukey(e.st.url) === lpK); });
        pool.sort(function (a, b) { return b.sd.sc - a.sd.sc; });
        var light = pool.filter(function (e) { return !e.sd.heavy; });
        var heavyL = pool.filter(function (e) { return e.sd.heavy && !e.sd.tor; });
        var torL = pool.filter(function (e) { return e.sd.tor; });
        var servers = [], PROV = {};
        function pv(e) { return String(e.st.provider || "Plugin").toLowerCase().trim(); }   // "4KHDHub" and "4khdhub" are one provider
        function kindOf0(sd) { return sd.tor ? 2 : sd.heavy ? 1 : 0; }
        function addSrv(e) { e._used = true; PROV[pv(e)] = 1; servers.push({ main: e, alts: [], tier: e.sd.heavy ? "r" : "y" }); }
        function nextFrom(arr, distinct) {
          for (var k = 0; k < arr.length; k++) { var e = arr[k]; if (!e._used && (!distinct || !PROV[pv(e)])) return e; }
          return null;
        }
        // up to 7 servers: every distinct provider gets a slot first (playable, then heavy, each strongest first);
        // a provider repeats only when slots are still empty. Direct HTTP / HLS / file streams always come before No-Debrid torrents:
        // torrents only take slots that no direct stream wants, and are never moved ahead of one.
        while (servers.length < 7) {
          var e0 = nextFrom(light, true) || nextFrom(heavyL, true) || nextFrom(light, false) || nextFrom(heavyL, false);
          if (!e0) break;
          addSrv(e0);
        }
        while (servers.length < 7) {
          var e1 = nextFrom(torL, true) || nextFrom(torL, false);
          if (!e1) break;
          addSrv(e1);
        }
        // last used stream: if it is not a server's main link yet, it takes over the main link of a server of its own provider
        // (the previous main moves to that server's alternates), so provider order and Server 1 are unchanged
        if (LP && !APP) {
          var own = null, lpe = null;
          pool.forEach(function (e) { if (ukey(e.st.url) === lpK) lpe = e; });
          if (lpe && !lpe._used) {
            var lpv = pv(lpe);
            servers.forEach(function (x) { if (!own && !x.main.sd.tor && kindOf0(x.main.sd) === kindOf0(lpe.sd) && pv(x.main) === lpv) own = x; });
            if (own) { var om = own.main; om._used = false; own.main = lpe; lpe._used = true; own.tier = lpe.sd.heavy ? "r" : own.tier === "r" ? "y" : own.tier; }
          }
        }
        // heavy / VLC servers always sit last (stable), the top web-ready one is the green server
        servers = servers.filter(function (x) { return x.tier !== "r"; }).concat(servers.filter(function (x) { return x.tier === "r"; }));
        // Server 1 is always the strongest instantly playable direct HTTP/HLS stream when one exists
        (function () {
          var bi = -1, bs = -1;
          servers.forEach(function (x, i) { var f0 = x.main.sd.f; if (x.tier === "y" && (f0 === "hls" || f0 === "mp4") && x.main.sd.sc > bs) { bs = x.main.sd.sc; bi = i; } });
          if (bi > 0) servers.unshift(servers.splice(bi, 1)[0]);
        })();
        if (servers.length && servers[0].tier === "y" && servers[0].main.sd.sc >= 100) servers[0].tier = "g";
        if (APP) {
          var have = {}, provHave = {};
          PREV.forEach(function (sv) { have[ukey(sv.main.st.url)] = 1; provHave[pv(sv.main)] = 1; sv.alts.forEach(function (a2) { have[ukey(a2.st.url)] = 1; }); });
          var fresh = servers.filter(function (sv) { return !have[ukey(sv.main.st.url)]; });
          fresh = fresh.filter(function (sv) { return !provHave[pv(sv.main)]; }).concat(fresh.filter(function (sv) { return provHave[pv(sv.main)]; }));
          fresh = fresh.slice(0, Math.max(0, 7 - PREV.length));
          if (!fresh.length) return;
          fresh.forEach(function (sv) { if (sv.tier === "g") sv.tier = "y"; });
          servers = PREV.concat(fresh);
        }
        // leftovers become hidden "more links" under a server of the same provider, else the same kind
        function kindOf(sd) { return sd.tor ? 2 : sd.heavy ? 1 : 0; }
        pool.forEach(function (e) {
          if (e._used) return;
          var targ = null, q;
          for (q = 0; q < servers.length; q++) { if (pv(servers[q].main) === pv(e) && kindOf(servers[q].main.sd) === kindOf(e.sd)) { targ = servers[q]; break; } }
          if (!targ) for (q = 0; q < servers.length; q++) { if (kindOf(servers[q].main.sd) === kindOf(e.sd)) { targ = servers[q]; break; } }
          if (!targ) targ = servers[servers.length - 1];
          if (targ && targ.alts.length < 12) targ.alts.push(e);
        });
        if (!servers.length) {
          var nm = h("div", "note center", total && (TIER !== "any" || MAXG !== "auto") ? "No streams match this quality / size selection." : "No playable stream found yet. Try again in a moment, or install a plugin in Add-ons.");
          if (total && (TIER !== "any" || MAXG !== "auto")) {
            var rs = h("button", "retry", "Show all streams");
            rs.onclick = function () { TIER = "any"; MAXG = "auto"; lsSet("boa_tier", "any"); lsSet("boa_maxgb", "auto"); Array.prototype.forEach.call(bar.querySelectorAll(".tierrow"), function (r) { Array.prototype.forEach.call(r.querySelectorAll(".tierchip"), function (x, i) { x.className = "tierchip" + (i === 0 ? " on" : ""); }); }); renderServers(); };
            nm.appendChild(h("br")); nm.appendChild(rs);
          }
          host.appendChild(nm);
          return;
        }
        if (!APP && (TIER !== "any" || MAXG !== "auto")) host.appendChild(h("div", "note", "Showing " + pool.length + " of " + total + " streams for this selection."));
        var LAB = { g: "Strong / Web Ready", y: ["Backup", "Alt Backup"], r: "Heavy / VLC" };
        var COL = { g: "#22c55e", y: "#facc15", r: "#ef4444" };
        function fmtName(sd) { return sd.tor ? "TORRENT" : sd.f === "hls" ? "HLS" : sd.f === "mp4" ? "MP4" : sd.f === "dash" ? "DASH" : sd.f === "embed" ? "Embed" : sd.f.toUpperCase(); }
        servers.forEach(function (sv, i) {
          sv.n = i + 1;
          sv.label = sv.tier === "y" ? (i === 0 ? "Best available" : (i === 1 ? LAB.y[0] : LAB.y[1])) : LAB[sv.tier];
          if (sv.main.sd.tor) sv.label = "Torrent (no Debrid)";
          sv.main.st.label = "SERVER " + sv.n + " · " + sv.label;
        });
        servers.forEach(function (sv) {
          sv.last = !!(LP && (ukey(sv.main.st.url) === lpK || sv.alts.some(function (a) { return ukey(a.st.url) === lpK; })));
        });
        var csAll = servers.filter(function (sv) { return !sv.main.sd.tor; }).map(function (sv) { return sv.main.st; });
        var cvAll = servers.map(function (sv) { return { n: sv.n, tier: sv.tier, label: sv.label, st: sv.main.st, q: sv.main.sd.q, f: sv.main.sd.f, tor: !!sv.main.sd.tor, last: !!sv.last, urls: [sv.main.st.url].concat(sv.alts.map(function (a) { return a.st.url; })), alts: sv.alts.map(function (a) { return { st: a.st, heavy: a.sd.heavy, tor: !!a.sd.tor, f: a.sd.f, q: a.sd.q, sc: a.sd.sc }; }) }; });
        if (APP) { for (var ci = PREV.length; ci < cvAll.length; ci++) CUR.servers.push(cvAll[ci]); for (var cj = 0; cj < csAll.length; cj++) if (CUR.streams.indexOf(csAll[cj]) < 0) CUR.streams.push(csAll[cj]); }
        else {
          var snapK = CUR.keep ? CUR.keep() : null;
          CUR.streams = csAll; CUR.servers = cvAll;
          if (snapK && CUR.rebind) CUR.rebind(snapK);          // the video keeps playing; only the list is rebuilt
        }
        function openMagnet(st0) { openTorrent(st0); }
        function copyMagnet(st0) {
          var u = st0.url || "";
          try { navigator.clipboard.writeText(u).then(function () { toast("Magnet link copied"); }, function () { toast("Couldn't copy the link"); }); } catch (e) { toast("Couldn't copy the link"); }
        }
        function openVlc(st0) {
          var u = st0.url || "";
          if (RELAY_ON() && u && !/^magnet:/i.test(u)) { relaySign(u, st0).then(function (ru) { if (ru) goVlc(ru, st0); }); return; }
          goVlc(u, st0);
        }
        function goVlc(u, st0) {
          if (!u || /^magnet:/i.test(u)) return;
          var ua = navigator.userAgent;
          if (/Android/i.test(ua)) {
            var sch = /^https:/i.test(u) ? "https" : "http";
            location.href = "intent://" + u.replace(/^https?:\/\//i, "") + "#Intent;scheme=" + sch + ";package=org.videolan.vlc;type=video/*;end";
          } else if (/iPhone|iPad|iPod/i.test(ua)) {
            location.href = "vlc://" + u;
          } else {
            var txt = "#EXTM3U\n#EXTINF:-1," + String(st0.title || "Stream").replace(/[\r\n]+/g, " ") + "\n" + u + "\n";
            var a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([txt], { type: "audio/x-mpegurl" }));
            a.download = "stream.m3u";
            a.click();
          }
        }
        function playStream(st0, noteEl) {
          // size is checked on the click, not while the list is drawn
          sizeGate(st0, sizeGB(st0), noteEl, function () { playStream2(st0, noteEl); });
        }
        function playStream2(st0, noteEl) {
          player.style.display = "block";
          player.textContent = "";
          noteEl.textContent = "";
          if (!/\/embed\/|\.html?($|\?)/i.test(st0.url)) {
            player.style.display = "none";
            openPlayer(st0.url, st0);
          } else {
            var ifr = document.createElement("iframe");
            ifr.src = st0.url;
            ifr.allow = "autoplay; fullscreen; encrypted-media";
            ifr.setAttribute("allowfullscreen", "");
            player.appendChild(ifr);
          }
          modal.scrollTo({ top: 0, behavior: "smooth" });
          var w0 = CUR && watchGet(CUR.mt, CUR.id);
          if (CUR && (!w0 || w0.nx || w0.e !== CUR.e || w0.s !== CUR.s)) recordWatch(CUR, 1, 0, true);
        }
        var firstPlay = null, firstPlay0 = null;
        var fromSi = APP ? PREV.length : 0;
        if (APP) { var dsc0 = host.querySelector(".srvdisc"); if (dsc0 && dsc0.parentNode) dsc0.parentNode.removeChild(dsc0); }
        servers.forEach(function (sv, si) {
          if (si < fromSi) return;
          var card = h("div", "srv");
          var top = h("div", "srvtop");
          var dot = h("i", "srvdot"); dot.style.background = COL[sv.tier]; dot.style.boxShadow = "0 0 10px " + COL[sv.tier];
          CUR.servers[si].dot = dot;                     // the player recolours it red while this server is failing
          var tx = h("div", "srvtx");
          tx.appendChild(h("b", null, "SERVER " + sv.n + " · " + sv.label + (sv.last ? " · Last used" : "")));
          var st = sv.main.st, sd = sv.main.sd;
          tx.appendChild(h("span", null, (sd.q ? sd.q + "p • " : "") + fmtName(sd) + (sd.tor && sd.seed ? " • " + sd.seed + " seeders" : "") + " • " + (st.provider || "Plugin") + (sd.f === "embed" ? " • opens inline" : "")));
          var note = h("div", "note", "");
          tx.appendChild(note);
          top.appendChild(dot); top.appendChild(tx);
          var acts = h("div", "srvact");
          var pb = h("button", "splaybtn", sd.tor ? "Play" : sv.tier === "r" ? "Try" : "Play");
          pb.onclick = function () { if (sd.tor) openMagnet(st); else playStream(st, note); };
          var vb = h("button", sv.tier === "r" ? "splaybtn vlcon" : "splaybtn vlc", sd.tor ? "Copy" : "VLC");
          vb.onclick = function () { if (sd.tor) copyMagnet(st); else openVlc(st); };
          acts.appendChild(pb); acts.appendChild(vb);
          top.appendChild(acts);
          card.appendChild(top);
          if (sd.tor) card.appendChild(h("div", "srvhint", "Torrent stream, no Debrid needed. Plays through your torrent bridge when one is set, otherwise tries browser peers. If neither works you can open it in Odyssey or copy the magnet link."));
          else if (sv.tier === "r") card.appendChild(h("div", "srvhint", "Large or non-web format (MKV, HEVC, AC3/DTS). Best in VLC or a capable device."));
          if (sv.alts.length) {
            var more = h("button", "srvmore", "More links (" + sv.alts.length + ")");
            var box = h("div", "srvalts"); box.style.display = "none";
            more.onclick = function () {
              var open = box.style.display === "none";
              box.style.display = open ? "block" : "none";
              if (open && !box.firstChild) {
                sv.alts.forEach(function (al) {
                  var r = h("div", "srvalt");
                  var tt = h("span", null, (al.st.provider || "Plugin") + " • " + (al.sd.q ? al.sd.q + "p " : "") + fmtName(al.sd) + (al.st.title ? " • " + String(al.st.title).slice(0, 48) : "") + (LP && ukey(al.st.url) === lpK ? " • Last used" : ""));
                  var nn = h("div", "note", "");
                  var b1 = h("button", "splaybtn", al.sd.tor ? "Play" : "Play"); b1.onclick = function () { if (al.sd.tor) openMagnet(al.st); else playStream(al.st, nn); };
                  var b2 = h("button", "splaybtn vlc", al.sd.tor ? "Copy" : "VLC"); b2.onclick = function () { if (al.sd.tor) copyMagnet(al.st); else openVlc(al.st); };
                  r.appendChild(tt); r.appendChild(b1); r.appendChild(b2); r.appendChild(nn);
                  box.appendChild(r);
                });
              }
              more.textContent = (open ? "Hide links (" : "More links (") + sv.alts.length + ")";
            };
            card.appendChild(more); card.appendChild(box);
          }
          host.appendChild(card);
          if (!firstPlay && sv.tier !== "r") firstPlay = pb;
          if (!firstPlay0 && !sd.tor) firstPlay0 = pb;
        });
        if (!firstPlay) firstPlay = firstPlay0;
        host.appendChild(h("div", "srvdisc", "Boa Cinema does not host any media files. Streams and metadata come from online sources, TMDB and your installed plugins."));
        PREV = servers;
        if (CUR && CUR.auto && firstPlay && !playerOpen()) {
          CUR.auto = false;
          firstPlay.click();
        }
        }
        more = function () { renderServers(true); };
        renderServers();
    }
    run(0)
      .catch(function (e) {
  if (tok !== STRM_TOK) return;
  clearTimeout(slowT);
  console.error("Plugin query error:", e);
  list.textContent = "";
  list.appendChild(h("div", "note center", "Search timed out. Tap Play again; the second try is usually instant because results get cached."));
      });
  }
  function renderDetail(d) {
    var body = $("dbody");
    body.textContent = "";
    $("dbt").textContent = d.t;
    $("dlib").style.visibility = "visible";
    paintLibBtn(d);
    $("dlib").onclick = function () { libToggle(d); paintLibBtn(d); };

    // poster / trailer area
    var mediaBox = h("div", "dmedia");
    var src = d.p || d.b;
    if (src) { var im = h("img"); im.alt = ""; im.src = imgUrl(src, "w780"); mediaBox.appendChild(im); }
    body.appendChild(mediaBox);
    function play() {
      if (!d.trailer) return;
      mediaBox.className = "dmedia playing";
      mediaBox.textContent = "";
      var f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + d.trailer + "?autoplay=1&playsinline=1&rel=0&modestbranding=1";
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.setAttribute("allowfullscreen", "");
      f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      mediaBox.appendChild(f);
      $("detail").scrollTo({ top: 0, behavior: "smooth" });
    }

    var info = h("div", "dinfo");
    var titleEl = h("h1", "dtitle", d.t);
    info.appendChild(titleEl);
    if (d.lg) {
      var lg = h("img", "dlogo");
      lg.alt = d.t;
      lg.onload = function () { if (titleEl.parentNode) info.replaceChild(lg, titleEl); };
      lg.src = IMG + "w500" + d.lg;
    }

    var meta = h("div", "dmeta");
    if (d.cert) meta.appendChild(h("span", "cert", d.cert));
    var length = d.mt === "tv"
      ? (d.seasons && d.seasons.length ? d.seasons.length + (d.seasons.length > 1 ? " seasons" : " season") : "")
      : dur(d.rt);
    var bits = [d.mt === "tv" ? "Series" : "Movie", d.y, d.r ? "\u2605 " + d.r : "", length].filter(Boolean);
    bits.forEach(function (b, i) {
      if (i > 0) meta.appendChild(h("span", null, "\u2022"));
      meta.appendChild(h("span", null, b));
    });
    info.appendChild(meta);
    if (d.d && d.d > new Date().toISOString().slice(0, 10)) info.appendChild(h("div", "soon", "Coming " + fmtDate(d.d)));

    if (d.g && d.g.length) {
      var gc = h("div", "chips");
      d.g.forEach(function (g) { gc.appendChild(h("span", "chip", g)); });
      info.appendChild(gc);
    }
    var acts = h("div", "acts");
    var unrel = isUnreleased(d);
    var wEnt = watchGet(d.mt, d.id);
    var streamBtn = h("button", "btn primary" + (unrel ? " disabled" : ""));
    streamBtn.innerHTML = ICON.play;
    var lbl = "Play";
    if (unrel) lbl = d.d ? "Releases " + fmtDate(d.d) : "Not released yet";
    else if (d.mt === "tv") lbl = wEnt ? ((wEnt.nx ? "Next: S" : "Resume S") + (wEnt.s || 1) + " E" + (wEnt.e || 1)) : "Play S1 E1";
    else if (wEnt && !wEnt.nx) lbl = "Resume" + (wEnt.dur > 0 && wEnt.pos > 0 ? " \u2022 " + Math.max(1, Math.round((wEnt.dur - wEnt.pos) / 60)) + "m left" : "");
    streamBtn.appendChild(document.createTextNode(lbl));
    streamBtn.onclick = function () {
      if (unrel) { toast("Not released yet"); return; }
      var s1 = 1, e1 = 1, at = 0;
      if (wEnt && d.mt === "tv") { s1 = wEnt.s || 1; e1 = wEnt.e || 1; at = wEnt.nx ? 0 : (wEnt.pos || 0); }
      else if (wEnt) at = wEnt.pos || 0;
      openStreams(d.mt, d.id, d.t + (d.mt === "tv" ? " (S" + s1 + "E" + e1 + ")" : ""), s1, e1, { p: d.p, y: d.y, b: d.b }, at, at > 0);
    };
    DETAILREF = { btn: streamBtn, d: d };
    acts.appendChild(streamBtn);
    if (d.trailer) {
      var pb = h("button", "btn ghost");
      pb.innerHTML = ICON.play;
      pb.appendChild(document.createTextNode("Trailer"));
      pb.onclick = play;
      acts.appendChild(pb);
      var yt = h("button", "btn ghost", "YouTube");
      yt.onclick = function () { openLink("https://www.youtube.com/watch?v=" + d.trailer); };
      acts.appendChild(yt);
    } else {
      var sy = h("button", "btn ghost", "Find trailer");
      sy.onclick = function () { openLink("https://www.youtube.com/results?search_query=" + encodeURIComponent(d.t + " " + d.y + " trailer")); };
      acts.appendChild(sy);
    }
    info.appendChild(acts);

    if (d.tag) info.appendChild(h("div", "tag", d.tag));
    var ov = h("p", "ov", d.o || "No synopsis available.");
    info.appendChild(ov);
    if ((d.o || "").length > 260) {
      ov.className = "ov clamp";
      var mb = h("button", "more", "More");
      mb.onclick = function () {
        var open = ov.className === "ov";
        ov.className = open ? "ov clamp" : "ov";
        mb.textContent = open ? "More" : "Less";
      };
      info.appendChild(mb);
    }
    if (d.by && d.by.length) {
      var by = h("div", "by");
      by.appendChild(h("b", null, d.byLabel + ": "));
      by.appendChild(document.createTextNode(d.by.join(", ")));
      info.appendChild(by);
    }
    body.appendChild(info);

    // cast
    if (d.cast && d.cast.length) {
      var cs = section("Top cast");
      var cstrip = h("div", "strip");
      d.cast.forEach(function (c) {
        var el = h("div", "cast");
        var cp = h("div", "cp");
        if (c.p) { var ci = h("img"); ci.loading = "lazy"; ci.alt = ""; ci.src = IMG + "w185" + c.p; cp.appendChild(ci); }
        else cp.textContent = (c.n || "?").charAt(0);
        el.appendChild(cp);
        el.appendChild(h("div", "cn", c.n));
        if (c.c) el.appendChild(h("div", "cc", c.c));
        cstrip.appendChild(el);
      });
      cs.appendChild(cstrip);
      body.appendChild(cs);
    }

    // episodes
    if (d.mt === "tv" && d.seasons && d.seasons.length) body.appendChild(episodesSection(d));

    // where to watch
    body.appendChild(watchSection(d));

    // show details table
    var det = section(d.mt === "tv" ? "Show Details" : "Movie Details");
    var tbl = h("div", "tbl");
    function tr(k, v) {
      if (!v) return;
      var r = h("div", "tr");
      r.appendChild(h("span", "k", k));
      r.appendChild(h("span", "v", v));
      tbl.appendChild(r);
    }
    tr("Status", d.status);
    tr("Release Info", d.mt === "tv" ? d.ri : fmtDate(d.ri));
    tr("Certification", d.cert);
    if (d.net && d.net.length) tr("Network", d.net.join(", "));
    tr("Origin Country", d.oc ? cname(d.oc) : "");
    tr("Original Language", d.ol);
    det.appendChild(tbl);
    body.appendChild(det);

    // more like this
    if (d.rec && d.rec.length) {
      var rs = section("More Like This");
      var rstrip = h("div", "strip");
      d.rec.forEach(function (m) { rstrip.appendChild(makeCard(m, {})); });
      rs.appendChild(rstrip);
      body.appendChild(rs);
    }
    body.appendChild(h("div", "credit", "Powered by TMDB"));
    body.appendChild(h("div", "dbottom"));
    // warm the stream lookup while the details page is open, so Play resolves from the cache (the server answers at once)
    if (!isUnreleased(d) && /^\d+$/.test(String(d.id)) && (d.mt === "movie" || d.mt === "tv")) {
      var wp = d.mt === "tv" ? (watchGet("tv", d.id) || {}) : {};
      api("/api/streams?warm=1&type=" + d.mt + "&id=" + d.id + "&s=" + (wp.s || 1) + "&e=" + (wp.e || 1), 0, 8000).catch(function () {});
    }
    if (!d.lg && d.mt && /^\d+$/.test(String(d.id))) {
      api("/api/logo?type=" + d.mt + "&id=" + d.id, 0).then(function (r) {
        if (!r || !r.l) return;
        d.lg = r.l;
        var l2 = h("img", "dlogo");
        l2.alt = d.t;
        l2.onload = function () { if (titleEl.parentNode) info.replaceChild(l2, titleEl); };
        l2.src = IMG + "w500" + r.l;
      }).catch(function () {});
    }
  }

  function episodesSection(d) {
    var sec = section("Episodes");
    var seasons = d.seasons;
    var chips = h("div", "pills");
    chips.style.marginBottom = "12px";
    var strip = h("div", "strip");
    sec.appendChild(chips);
    sec.appendChild(strip);
    var seq = 0;
    function load(n) {
      var my = ++seq;
      var key = d.id + ":" + n;
      strip.textContent = "";
      strip.scrollLeft = 0;
      if (seasonCache[key]) { paint(seasonCache[key], n); return; }
      var sk = h("div", "ep sk");
      strip.appendChild(sk);
      api("/api/season?id=" + d.id + "&n=" + n).then(function (eps) {
        seasonCache[key] = eps;
        if (my === seq) paint(eps, n);
      }).catch(function () {
        if (my !== seq) return;
        strip.textContent = "";
        var box = h("div", "note", "Couldn't load episodes.");
        var rb = h("button", "retry", "Retry");
        rb.onclick = function () { load(n); };
        box.appendChild(rb);
        strip.appendChild(box);
      });
    }
    function paint(eps, n) {
      strip.textContent = "";
      if (!eps.length) { strip.appendChild(h("div", "note", "No episode details yet for this season.")); return; }
      eps.forEach(function (e) {
        var c = h("div", "ep");
        if (e.s) { var im = h("img"); im.loading = "lazy"; im.alt = ""; im.src = IMG + "w500" + e.s; c.appendChild(im); }
        var inf = h("div", "ei");
        inf.appendChild(h("span", "eb", "S" + n + " E" + e.n));
        inf.appendChild(h("div", "et", e.t));
        if (e.o) inf.appendChild(h("div", "eo", e.o));
        var ft = h("div", "ef");
        if (e.rt) ft.appendChild(h("span", null, e.rt + "m"));
        if (e.r && e.r !== "0.0") { var r = h("span", "r", "\u2605 " + e.r); ft.appendChild(r); }
        if (e.d) ft.appendChild(h("span", "d", fmtDate(e.d)));
        inf.appendChild(ft);
        c.appendChild(inf);
        c.style.cursor = "pointer";
        var epWatch = watchGet("tv", d.id);
        if (e.d && e.d.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
          c.className = "ep off";
          c.onclick = function () { toast("Airs " + fmtDate(e.d)); };
        } else {
          c.onclick = function () { openStreams("tv", d.id, d.t + " (S" + n + "E" + e.n + ")", n, e.n, { p: d.p, y: d.y, b: d.b }, (epWatch && !epWatch.nx && epWatch.s === n && epWatch.e === e.n) ? epWatch.pos : 0, !!(epWatch && !epWatch.nx && epWatch.s === n && epWatch.e === e.n && epWatch.pos > 0)); };
        }
        strip.appendChild(c);
      });
    }
    seasons.forEach(function (s, i) {
      var b = h("button", "pill" + (i === 0 ? " sel" : ""), "Season " + s.n);
      b.onclick = function () {
        Array.prototype.forEach.call(chips.children, function (x) { x.className = "pill"; });
        b.className = "pill sel";
        load(s.n);
      };
      chips.appendChild(b);
    });
    load(seasons[0].n);
    return sec;
  }

  function watchSection(d) {
    var sec = section("Where to watch");
    var provs = d.wp || [];
    var cc = myCC;
    var watchUrl = d.wl ? d.wl + (cc ? "?locale=" + cc : "") : "";
    if (!provs.length) {
      var today = new Date().toISOString().slice(0, 10);
      var future = d.d && d.d > today;
      var days = d.d ? Math.floor((Date.parse(today) - Date.parse(d.d)) / 86400000) : 9999;
      var title, text;
      if (future) { title = "Not streaming yet"; text = "This title is scheduled for " + fmtDate(d.d) + ". Streaming services are usually announced closer to the date."; }
      else if (d.mt === "movie" && days < 120) { title = "Not on streaming yet"; text = "It may still be in theaters, or its streaming deal hasn't been announced. Watch the trailer and check back soon."; }
      else { title = "No streaming listings yet"; text = "No service has listed this title in any country right now."; }
      var ns = h("div", "nostream");
      ns.appendChild(h("b", null, title));
      ns.appendChild(h("span", null, text));
      sec.appendChild(ns);
      if (watchUrl) {
        var wc0 = h("div", "wcta");
        wc0.style.marginTop = "14px";
        var wb0 = h("button", "btn ghost block", "Check watch options");
        wb0.onclick = function () { openLink(watchUrl); };
        wc0.appendChild(wb0);
        sec.appendChild(wc0);
      }
      return sec;
    }
    sec.appendChild(h("p", "wnote", "Showing every country. Tap a service to see where it's available."));
    var kinds = [["stream", "Stream"], ["free", "Free with ads"], ["rent", "Rent"], ["buy", "Buy"]];
    kinds.forEach(function (k) {
      var list = provs.filter(function (p) { return p.k === k[0]; });
      if (!list.length) return;
      list.sort(function (a, b) {
        return ((b.c.indexOf(cc) > -1) - (a.c.indexOf(cc) > -1)) || (b.c.length - a.c.length);
      });
      var g = h("div", "wgroup");
      g.appendChild(h("div", "wlabel", k[1]));
      var row = h("div", "prow");
      var det = h("div", "pdet");
      det.style.display = "none";
      var openId = null;
      list.slice(0, 20).forEach(function (p) {
        var mine = cc && p.c.indexOf(cc) > -1;
        var b = h("button", "prov" + (mine ? " mine" : ""));
        var pl = h("div", "pl");
        if (p.l) { var im = h("img"); im.alt = ""; im.loading = "lazy"; im.src = IMG + "w92" + p.l; pl.appendChild(im); }
        else pl.textContent = p.n.charAt(0);
        b.appendChild(pl);
        var tx = h("div");
        tx.appendChild(h("div", "pn", p.n));
        tx.appendChild(h("div", "pc", mine ? "Available in your country" : p.c.length + (p.c.length === 1 ? " country" : " countries")));
        b.appendChild(tx);
        b.onclick = function () {
          if (openId === p.id) { det.style.display = "none"; openId = null; b.className = "prov" + (mine ? " mine" : ""); return; }
          Array.prototype.forEach.call(row.children, function (x) { x.className = x.className.replace(" sel", ""); });
          b.className += " sel";
          openId = p.id;
          det.textContent = "";
          det.appendChild(h("div", "pt", p.n + " is available in " + p.c.length + (p.c.length === 1 ? " country" : " countries")));
          var cl = h("div", "cl");
          p.c.slice().sort(function (a, b2) {
            if (a === cc) return -1;
            if (b2 === cc) return 1;
            return cname(a).localeCompare(cname(b2));
          }).forEach(function (code) {
            cl.appendChild(h("span", "cc2" + (code === cc ? " me" : ""), flag(code) + " " + cname(code)));
          });
          det.appendChild(cl);
          det.style.display = "block";
        };
        row.appendChild(b);
      });
      g.appendChild(row);
      g.appendChild(det);
      sec.appendChild(g);
    });
    if (watchUrl) {
      var wc = h("div", "wcta");
      wc.style.marginTop = "18px";
      var wb = h("button", "btn primary block", "Watch");
      wb.onclick = function () { openLink(watchUrl); };
      wc.appendChild(wb);
      sec.appendChild(wc);
    }
    return sec;
  }

  // ---------- links from the bot: ?type=tv  ?cat=nollywood  ?q=war room ----------
  var qp = new URLSearchParams(window.location.search);
  if (qp.get("type") === "tv") media = "tv";
  else if (qp.get("type") === "movie") media = "movie";
  var pendingCat = (qp.get("cat") || "").replace(/[^a-z]/g, "");
  var pendingQ = (qp.get("q") || "").trim().slice(0, 100);
  function applyDeepLink() {
    if (pendingQ) {
      var v = pendingQ;
      pendingQ = "";
      showTab("search");
      $("q").value = v;
      runSearch(v);
      return;
    }
    if (pendingCat) {
      var c = pendingCat;
      pendingCat = "";
      setTimeout(function () { jumpTo(c); }, 300);
    }
  }

  // ---------- site notice (set by the owner) ----------
  function loadNotice() {
    var el = $("notice");
    api("/api/notice", 0).then(function (r) {
      var t = r && r.n ? String(r.n) : "";
      var seen = "";
      try { seen = localStorage.getItem("boa_notice_x") || ""; } catch (e) {}
      el.textContent = "";
      var pri = !!(r && r.p);
      if (!t || (t === seen && !pri)) { el.className = "notice"; return; }
      linkify(el, t);
      if (pri) { el.className = "notice on pri"; return; }
      var x = h("button", null, "×");
      x.setAttribute("aria-label", "Dismiss");
      x.onclick = function () {
        try { localStorage.setItem("boa_notice_x", t); } catch (e) {}
        el.className = "notice";
      };
      el.appendChild(x);
      el.className = "notice on";
    }).catch(function () {});
  }

  // ---------- priority notice slider (mandatory slide-through; ack remembered by content hash) ----------
  var NS_STARTED = false;
  var NS_LAB = ["Low", "Normal", "Critical / High"];
  function nsGet() { var v = ""; try { v = localStorage.getItem("boa_nack") || ""; } catch (e) {} if (!v) { try { v = sessionStorage.getItem("boa_nack") || ""; } catch (e) {} } return v; }
  function nsSet(v) { var ok = false; try { localStorage.setItem("boa_nack", v); ok = true; } catch (e) {} try { sessionStorage.setItem("boa_nack", v); } catch (e) {} return ok; }
  function startNotices() {
    if (NS_STARTED) return;
    NS_STARTED = true;
    api("/api/notices", 0).then(function (r) {
      var list = r && r.n ? r.n : [];
      if (!list.length || !r.v || nsGet() === r.v) return;
      showNotices(list, r.v);
    }).catch(function () {});
  }
  function showNotices(list, ver) {
    var box = $("nslide"), idx = 0, max = 0, N = list.length, busy = false;
    box.textContent = "";
    var card = h("div", "nbox");
    var head = h("div", "nhead"), badge = h("span", "nbadge", ""), step = h("span", "nstep", "");
    head.appendChild(badge); head.appendChild(step);
    var view = h("div", "nview"), track = h("div", "ntrack");
    list.forEach(function (n) {
      var sl = h("div", "nsl");
      if (n.t) sl.appendChild(linkify(h("h2"), n.t));
      if (n.b) sl.appendChild(linkify(h("p"), n.b));
      track.appendChild(sl);
    });
    view.appendChild(track);
    var dots = h("div", "ndots");
    for (var i = 0; i < N; i++) dots.appendChild(h("i", ""));
    var hint = h("div", "nhint", "");
    var foot = h("div", "nfoot"), prev = h("button", "nprev", "Back"), next = h("button", "nnext", "");
    prev.type = "button"; next.type = "button";
    foot.appendChild(prev); foot.appendChild(next);
    card.appendChild(head); card.appendChild(view); card.appendChild(dots); card.appendChild(hint); card.appendChild(foot);
    box.appendChild(card);
    function paint() {
      track.style.transform = "translateX(" + (-idx * 100) + "%)";
      var lst = list[idx] || {};
      badge.className = "nbadge p" + (lst.p || 0);
      badge.textContent = NS_LAB[lst.p] || "Normal";
      step.textContent = (idx + 1) + " of " + N;
      for (var k = 0; k < dots.children.length; k++) dots.children[k].className = k === idx ? "on" : k <= max ? "seen" : "";
      prev.disabled = idx === 0;
      var last = idx === N - 1;
      next.textContent = last ? "Acknowledge & Continue" : "Next";
      hint.textContent = last ? "" : "Read each notice to continue";
      var sl = track.children[idx]; if (sl) sl.scrollTop = 0;
    }
    function go(d) {
      var t = idx + d;
      if (t < 0 || t > N - 1 || t > max + 1) return;
      idx = t; if (idx > max) max = idx;
      paint();
    }
    function done() {
      nsSet(ver);
      box.className = "";
      box.textContent = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", keys, true);
    }
    function keys(e) {
      if (!box.classList.contains("on")) return;
      var k = e.key;
      if (k === "ArrowRight") { go(1); e.preventDefault(); }
      else if (k === "ArrowLeft") { go(-1); e.preventDefault(); }
      else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); }
    }
    prev.onclick = function () { go(-1); };
    next.onclick = function () { if (idx === N - 1) done(); else go(1); };
    var x0 = 0, y0 = 0, on = false;
    view.addEventListener("touchstart", function (e) { var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; on = true; }, { passive: true });
    view.addEventListener("touchend", function (e) {
      if (!on) return; on = false;
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    // the backdrop does nothing: the panel only closes through Acknowledge on the last slide
    box.onclick = function (e) { if (e.target === box) { e.preventDefault(); } };
    document.addEventListener("keydown", keys, true);
    document.body.style.overflow = "hidden";
    paint();
    box.className = "on";
    try { next.focus({ preventScroll: true }); } catch (e) {}
  }


  // ---------- section-aware refresh: the current view lives in the URL hash (#/lib, #/search/q/..., #/home/title/tv/123/streams/1/2) ----------
  var NAVTABS = { home: 1, search: 1, lib: 1, me: 1 };
  var HRESTORE = false, hqT = null;
  function smOpen() { var m = $("streammodal"); return !!m && m.classList.contains("open"); }
  function hashNow() {
    var p = [tab], top = stack[stack.length - 1];
    if (smOpen() && CUR && CUR.id) {
      if (top && top.mt === CUR.mt && String(top.id) === String(CUR.id)) p.push("title", top.mt, top.id, "streams", CUR.s || 1, CUR.e || 1);
      else p.push("watch", CUR.mt, CUR.id, CUR.s || 1, CUR.e || 1);
    } else if (top) p.push("title", top.mt, top.id);
    else if (tab === "search") { var q = ($("q").value || "").trim().slice(0, 100); if (q.length > 1) p.push("q", encodeURIComponent(q)); }
    return p.length === 1 && p[0] === "home" ? "" : "#/" + p.join("/");
  }
  function syncHash() {
    if (HRESTORE) return;
    var hs = hashNow();
    if (hs === (window.location.hash || "")) return;
    try { history.replaceState(history.state, "", window.location.pathname + window.location.search + hs); } catch (e) {}
  }
  function reopenStreams(mt, id, s, e) {
    api("/api/title?type=" + mt + "&id=" + encodeURIComponent(id)).then(function (d) {
      if (!d || !d.t) return;
      openStreams(mt, id, d.t + (mt === "tv" ? " (S" + s + "E" + e + ")" : ""), s, e, { p: d.p, y: d.y, b: d.b }, 0, false);
      syncHash();
    }).catch(function () {});
  }
  function restoreFromHash() {
    var m = String(window.location.hash || "").replace(/^#\/?/, "").split("/");
    if (!m[0] || !NAVTABS[m[0]]) return;
    HRESTORE = true;
    try {
      var t = m[0];
      try { history.replaceState(null, "", window.location.pathname + window.location.search + (t === "home" ? "" : "#/" + t)); } catch (e) {}
      if (t !== "home") showTab(t);
      var okId = function (a, b) { return /^(movie|tv)$/.test(a) && /^\d{1,9}$/.test(b); };
      var num = function (v) { var n = parseInt(v, 10); return n > 0 && n < 1000 ? n : 1; };
      if (m[1] === "q" && t === "search") {
        var q = ""; try { q = decodeURIComponent(m.slice(2).join("/")).slice(0, 100); } catch (e) {}
        if (q.trim().length > 1) { $("q").value = q; runSearch(q.trim()); }
      } else if (m[1] === "title" && okId(m[2], m[3])) {
        openTitle(m[2], m[3]);
        if (m[4] === "streams") reopenStreams(m[2], m[3], num(m[5]), num(m[6]));
      } else if (m[1] === "watch" && okId(m[2], m[3])) {
        reopenStreams(m[2], m[3], num(m[4]), num(m[5]));
      }
    } catch (e) {}
    HRESTORE = false;
    syncHash();
  }
  try {
    var hmo = new MutationObserver(function () { syncHash(); });
    hmo.observe($("detail"), { attributes: true, attributeFilter: ["class"] });
    hmo.observe($("streammodal"), { attributes: true, attributeFilter: ["class"] });
  } catch (e) {}
  $("q").addEventListener("input", function () { clearTimeout(hqT); hqT = setTimeout(syncHash, 600); });
  window.addEventListener("popstate", function () { setTimeout(syncHash, 0); });
  window.addEventListener("hashchange", function () { if (!HRESTORE && window.location.hash !== hashNow()) restoreFromHash(); });

  // ---------- notification dropdown (read-only list of the notices; the acknowledge slider is unchanged) ----------
  var BELL = { v: "", list: [], at: 0 };
  function nvGet() { var v = ""; try { v = localStorage.getItem("boa_nview") || ""; } catch (e) {} return v; }
  function nvSet(v) { try { localStorage.setItem("boa_nview", v); } catch (e) {} }
  function paintBell() {
    var b = $("bell");
    if (!b) return;
    var fresh = BELL.list.length && BELL.v && nvGet() !== BELL.v && nsGet() !== BELL.v;
    b.className = fresh ? "new" : "";
    b.setAttribute("aria-label", fresh ? "Notices, new" : "Notices");
  }
  function loadBell(cb) {
    api("/api/notices", 0).then(function (r) {
      BELL.list = r && r.n ? r.n : []; BELL.v = r && r.v ? r.v : ""; BELL.at = Date.now();
      paintBell();
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
  }
  function drawPop() {
    var pop = $("npop"), L = BELL.list;
    pop.textContent = "";
    var hd = h("div", "nph", "Notices");
    hd.appendChild(h("span", null, L.length ? L.length + (L.length === 1 ? " notice" : " notices") : ""));
    pop.appendChild(hd);
    var lst = h("div", "npl");
    if (!L.length) lst.appendChild(h("div", "npe", "No notices right now."));
    L.forEach(function (n) {
      var it = h("div", "npi"); it.setAttribute("role", "button"); it.tabIndex = 0;
      var tt = h("div", "npt");
      tt.appendChild(h("i", "p" + (n.p || 0)));
      tt.appendChild(h("span", null, n.t || NS_LAB[n.p] || "Notice"));
      it.appendChild(tt);
      if (n.b) it.appendChild(linkify(h("div", "npb"), n.b));
      it.setAttribute("aria-expanded", "false");
      it.onclick = function () { var o = it.className.indexOf("open") > -1; it.className = "npi" + (o ? "" : " open"); it.setAttribute("aria-expanded", o ? "false" : "true"); };
      it.onkeydown = function (ev) { if (ev.target === it && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); it.onclick(); } };
      lst.appendChild(it);
    });
    pop.appendChild(lst);
    if (L.length && BELL.v && nsGet() !== BELL.v) {
      var ft = h("div", "npf"), rb = h("button", null, "Review & acknowledge"); rb.type = "button";
      rb.onclick = function () { closePop(); showNotices(L, BELL.v); };
      ft.appendChild(rb); pop.appendChild(ft);
    }
  }
  function placePop() {
    var b = $("bell"), pop = $("npop"), r = b.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + "px";
    pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
  }
  function popOpen() { return $("npop").classList.contains("on"); }
  function closePop() {
    $("npop").classList.remove("on");
    $("bell").setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", popOut, true);
    document.removeEventListener("keydown", popKey, true);
  }
  function popOut(e) { var t = e.target; if (t && (t.closest ? (t.closest("#npop") || t.closest("#bell")) : false)) return; closePop(); }
  function popKey(e) { if (e.key === "Escape") { closePop(); try { $("bell").focus(); } catch (x) {} } }
  function openPop() {
    drawPop(); placePop();
    $("npop").classList.add("on");
    $("bell").setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", popOut, true);
    document.addEventListener("keydown", popKey, true);
    if (BELL.v) { nvSet(BELL.v); paintBell(); }
    if (Date.now() - BELL.at > 20000) loadBell(function () { if (popOpen()) { drawPop(); if (BELL.v) { nvSet(BELL.v); paintBell(); } } });
  }
  $("bell").onclick = function () { if (popOpen()) closePop(); else openPop(); };
  window.addEventListener("resize", function () { if (popOpen()) placePop(); });
  loadBell();
  setInterval(function () { if (!document.hidden) loadBell(); }, 300000);

  // ---------- owner panel (shown only to the owner; Telegram signs who you are) ----------
  var IS_OWNER = false;
  var ADM = { picks: [], custom: false, notice: "", active: null, kv: true, addons: [] };
  function adm(path, body) {
    var headers = { "x-tg-init": (tg && tg.initData) || "" };
    var opt = { headers: headers };
    if (body) { opt.method = "POST"; headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) {
          var msg = j && j.error;
          if (!msg) msg = r.status === 429 ? "Too many requests right now or the storage limit was reached. Wait a minute and try again." : r.status >= 500 ? "The server had a problem. Nothing was changed. Try again shortly." : "Request failed (" + r.status + ")";
          var er = new Error(msg); er.status = r.status; er.kv = !!(j && j.kv) || r.status === 429; throw er;
        }
        if (j === null) throw new Error("The server sent an unreadable reply. Try again.");
        return j;
      });
    }, function () { var er = new Error("Can't reach the server. Check your connection and try again."); er.status = 0; throw er; });
  }
  function checkOwner() {
    
    adm("/api/admin/me").then(function (r) {
      if (r && r.owner) {
        IS_OWNER = true;
        if (tab === "me") renderMe();
        if (qp.get("go") === "admin") openAdmin();
      }
    }).catch(function () {});
  }
  function openAdmin() {
    ADM_TAB = "ov";
    $("admin").classList.add("open");
    document.body.style.overflow = "hidden";
    renderAdmin(true);
  }
  function closeAdmin() {
    $("admin").classList.remove("open");
    document.body.style.overflow = "";
  }
  function savePicks(list, msg) {
    adm("/api/admin/picks", { picks: list }).then(function (r) {
      ADM.picks = r.picks;
      ADM.custom = true;
      renderAdmin(false);
      toast(msg);
    }).catch(function (e) { toast("Couldn't save: " + e.message); });
  }
  var ADM_TAB = "ov";
  function renderAdmin(reload) {
    var box = $("admin");
    box.textContent = "";
    if (reload) {
      box.appendChild(h("div", "note center", "Loading…"));
      adm("/api/admin/state").then(function (st) {
        ADM = st;
        renderAdmin(false);
      }).catch(function (e) {
        box.textContent = "";
        box.appendChild(h("div", "note center", "Couldn't open the owner panel: " + e.message));
        var x = h("button", "abtn", "Close");
        x.onclick = closeAdmin;
        box.appendChild(x);
      });
      return;
    }
    var head = h("div", "ahead");
    var back = h("button", "ib");
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
    back.setAttribute("aria-label", "Close");
    back.onclick = closeAdmin;
    head.appendChild(back);
    head.appendChild(h("h1", null, "Owner panel"));
    box.appendChild(head);
    var tabBar = h("div", "atabs");
    [["ov", "Overview"], ["ad", "Add-ons"], ["pl", "Plugins"], ["ads", "Ads"], ["nt", "Notices"], ["int", "Integrations"]].forEach(function (t) {
      var b = h("button", "atab" + (ADM_TAB === t[0] ? " on" : ""), t[1]);
      b.onclick = function () { ADM_TAB = t[0]; showAdmTab(); };
      b.setAttribute("data-tb", t[0]);
      b.setAttribute("aria-label", "Open " + t[1]);
      if (ADM_TAB === t[0]) b.setAttribute("aria-current", "page");
      tabBar.appendChild(b);
    });
    box.appendChild(tabBar);
    function put(t, el) { el.setAttribute("data-t", t); box.appendChild(el); }
    // A dedicated view per section: its own Back control, status/error banner and body. Redrawing one never touches another.
    var SECS = {};
    function mkSection(tab, title) {
      var wrap = h("div", "asec"), head = h("div", "asechead");
      var bk = h("button", "abtn alt asback", "← Overview");
      bk.setAttribute("aria-label", "Back to Overview");
      bk.onclick = function () { ADM_TAB = "ov"; showAdmTab(); };
      var ttl = h("h2", null, title); ttl.setAttribute("tabindex", "-1");
      head.appendChild(bk); head.appendChild(ttl);
      var ban = h("div", "sbanner"); ban.setAttribute("role", "status"); ban.setAttribute("aria-live", "polite"); ban.style.display = "none";
      var body = h("div");
      wrap.appendChild(head); wrap.appendChild(ban); wrap.appendChild(body);
      put(tab, wrap);
      var o = {
        body: body, title: ttl,
        say: function (m) {
          var err = /^(couldn|error|test failed|problem|failed|can.t)/i.test(String(m));
          var quota = /rate-limited|limit|too many|quota/i.test(String(m)) && err;
          ban.textContent = m; ban.className = "sbanner" + (quota ? " warn" : err ? " err" : "");
          ban.setAttribute("role", err ? "alert" : "status"); ban.style.display = "";
          try { ban.scrollIntoView({ block: "nearest" }); } catch (e) {}
        },
        clear: function () { ban.textContent = ""; ban.style.display = "none"; }
      };
      SECS[tab] = o;
      return o;
    }
    function showAdmTab() {
      Array.prototype.forEach.call(box.querySelectorAll("[data-t]"), function (el) { el.style.display = el.getAttribute("data-t") === ADM_TAB ? "" : "none"; });
      Array.prototype.forEach.call(tabBar.children, function (b) {
        var on = b.getAttribute("data-tb") === ADM_TAB;
        b.className = "atab" + (on ? " on" : "");
        if (on) { b.setAttribute("aria-current", "page"); try { b.scrollIntoView({ inline: "center", block: "nearest" }); } catch (e) {} }
        else b.removeAttribute("aria-current");
      });
      var sc = $("admin"); if (sc) sc.scrollTop = 0;
      if (ADM_TAB === "ov") paintNav();
      else if (SECS[ADM_TAB]) { try { SECS[ADM_TAB].title.focus({ preventScroll: true }); } catch (e) {} }
    }

    function fmtN(n) { return n >= 1000 ? (Math.round(n / 100) / 10) + "k" : String(n); }
    function ago(ts) {
      if (!ts) return "No visits yet";
      var m = Math.max(0, Math.round((Date.now() - ts) / 60000));
      if (m < 1) return "Just now";
      if (m < 60) return m + " min ago";
      if (m < 1440) return Math.round(m / 60) + " h ago";
      return Math.round(m / 1440) + " d ago";
    }
    var stt = ADM.stats || {};
    var live = h("div", "livecard");
    var dot = h("i", "livedot");
    var liveNum = h("b", null, stt.active == null ? "–" : String(stt.now || 0));
    var liveTxt = h("div", "livetxt");
    liveTxt.appendChild(h("span", null, "Active Now"));
    var liveSub = h("em", null, "");
    liveTxt.appendChild(liveSub);
    live.appendChild(dot); live.appendChild(liveNum); live.appendChild(liveTxt);
    function paintLive(x) {
      liveNum.textContent = x.active == null ? "–" : String(x.now || 0);
      var sr = x.src || {};
      liveSub.textContent = (x.streaming || 0) + " streaming • Bot " + (sr.b || 0) + " • App " + (sr.p || 0) + " • Web " + (sr.w || 0);
    }
    paintLive(stt);
    put("ov", live);
    var c1 = h("div", "stats");
    var statVals = {};
    [
      ["M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "active", "Active Users (30 days)", "sum of daily users"],
      ["M3 12h4l3-9 4 18 3-9h4", "today", "Active Today", "24 hours"],
      ["M3 4h18v16H3zM3 10h18M8 2v4M16 2v4", "week", "This Week (7 days)", "sum of daily users"],
      ["M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "lastVisit", "Last Visit", "most recent"]
    ].forEach(function (c) {
      var card = h("div", "stat");
      card.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#e50914" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + c[0] + '"/></svg>';
      var val = h("b", null, "");
      card.appendChild(val);
      card.appendChild(h("span", null, c[2]));
      card.appendChild(h("i", null, c[3]));
      statVals[c[1]] = val;
      c1.appendChild(card);
    });
    function paintStats(x) {
      statVals.active.textContent = x.active == null ? "–" : fmtN(x.active);
      statVals.today.textContent = x.active == null ? "–" : fmtN(x.today || 0);
      statVals.week.textContent = x.active == null ? "–" : fmtN(x.week || 0);
      statVals.lastVisit.textContent = ago(x.lastVisit);
    }
    paintStats(stt);
    put("ov", c1);
    // compact charts (plain SVG, no library)
    function areaSvg(vals, label) {
      var W = 320, H = 90, mx = Math.max.apply(null, vals.concat([1]));
      var step = W / Math.max(1, vals.length - 1);
      var pts = vals.map(function (v, i) { return (i * step).toFixed(1) + "," + (H - 8 - (v / mx) * (H - 20)).toFixed(1); });
      return '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" style="width:100%;height:90px;display:block"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e50914" stop-opacity=".45"/><stop offset="1" stop-color="#e50914" stop-opacity="0"/></linearGradient></defs><polygon points="0,' + H + " " + pts.join(" ") + " " + W + "," + H + '" fill="url(#ag)"/><polyline points="' + pts.join(" ") + '" fill="none" stroke="#e50914" stroke-width="2" stroke-linejoin="round"/></svg>';
    }
    function barsSvg(vals) {
      var W = 320, H = 90, mx = Math.max.apply(null, vals.concat([1])), bw = W / vals.length;
      var out = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" style="width:100%;height:90px;display:block">';
      vals.forEach(function (v, i) {
        var bh = Math.max(2, (v / mx) * (H - 22));
        out += '<rect x="' + (i * bw + 6).toFixed(1) + '" y="' + (H - 6 - bh).toFixed(1) + '" width="' + (bw - 12).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="5" fill="#e50914" fill-opacity="' + (i === vals.length - 1 ? "1" : ".55") + '"/>';
      });
      return out + "</svg>";
    }
    var chartCard = h("div", "acard");
    chartCard.appendChild(h("h3", null, "Activity"));
    var ch1 = h("div", "chart"), ch2 = h("div", "chart");
    var cap1 = h("p", null, ""), cap2 = h("p", null, "");
    chartCard.appendChild(h("p", null, "Last 24 hours (people online, 10-minute peaks)"));
    chartCard.appendChild(ch1); chartCard.appendChild(cap1);
    chartCard.appendChild(h("p", null, "Last 7 days (unique visitors per day)"));
    chartCard.appendChild(ch2); chartCard.appendChild(cap2);
    var WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    function paintCharts(x) {
      var hv = x.hours && x.hours.length ? x.hours : [0, 0], dv = x.days && x.days.length ? x.days : [0, 0, 0, 0, 0, 0, 0];
      ch1.innerHTML = areaSvg(hv); ch2.innerHTML = barsSvg(dv);
      var f = x.first || 0, bi = 0, lab = '<div style="display:flex;margin-top:4px">';
      dv.forEach(function (n, i) {
        if (n > dv[bi]) bi = i;
        lab += '<span style="flex:1;text-align:center;font-size:11px;color:#a1a1aa">' + WD[new Date((f + i) * 86400000).getUTCDay()].slice(0, 3) + "</span>";
      });
      ch2.innerHTML += lab + "</div>";
      cap1.textContent = "Peak " + Math.max.apply(null, hv) + " online";
      cap2.textContent = dv[bi] > 0 ? "Best day: " + WD[new Date((f + bi) * 86400000).getUTCDay()] + " (" + dv[bi] + " visitors)" : "No visitors yet this week";
    }
    paintCharts(stt);
    put("ov", chartCard);
    if (ADM.kvDown) { var kvn = h("div", "sbanner warn", "Cloudflare KV is rate-limited right now. Saved settings you see may be a few minutes old, and saving is paused until it recovers."); kvn.setAttribute("role", "status"); put("ov", kvn); }
    // shortcut cards: concise status, same targets as the top pills. Texts are refreshed only when Overview is shown again.
    var navWrap = h("div", "ncards"), NAV = {};
    function navCard(tab, title, subtxt) {
      var b = h("button", "ncard", ""), sm = h("span", null, ""), sb = h("em", null, subtxt);
      b.appendChild(h("b", null, title)); b.appendChild(sm); b.appendChild(sb); b.appendChild(h("i", null, "›"));
      b.onclick = function () { ADM_TAB = tab; showAdmTab(); };
      navWrap.appendChild(b);
      NAV[tab] = { b: b, sm: sm, sb: sb, title: title };
    }
    navCard("ad", "Add-ons", "Catalog and subtitle sources");
    navCard("pl", "Plugins", "Stream provider repositories");
    navCard("ads", "Ads", "");
    navCard("nt", "Notices", "Priority notices and disclaimers");
    function paintNav() {
      var ad = ADM.addons || [], pl = ADM.plugins || [], A2 = ADM.ads || {}, ia = ADM.integ && ADM.integ.ads && ADM.integ.ads.on;
      var on1 = ad.filter(function (x) { return x.enabled !== false; }).length, on2 = pl.filter(function (x) { return x.enabled !== false; }).length;
      NAV.ad.sm.textContent = ad.length ? ad.length + " installed • " + on1 + " on" : "None installed";
      NAV.pl.sm.textContent = pl.length ? pl.length + " repositor" + (pl.length === 1 ? "y" : "ies") + " • " + on2 + " on" : "No repositories";
      NAV.ads.sm.textContent = (A2.on || ia) ? "ON" + (A2.pre !== false ? " • Pre-roll" : "") + (A2.mid !== false ? " • Mid-roll" : "") : "OFF";
      var nl = ADM.notices || [], non = nl.filter(function (x) { return x.on !== false; }).length;
      NAV.nt.sm.textContent = nl.length ? nl.length + " notice" + (nl.length === 1 ? "" : "s") + " • " + non + " on" : "No notices";
      NAV.ads.sb.textContent = A2.tag ? "VAST tag set" : (ia ? "Using Integrations zone" : "No ad tag yet");
      for (var k in NAV) NAV[k].b.setAttribute("aria-label", "Open " + NAV[k].title + ": " + NAV[k].sm.textContent);
    }
    paintNav();
    put("ov", navWrap);
    // live refresh every 30s while the Overview is open
    if (window.__admPoll) clearInterval(window.__admPoll);
    window.__admPoll = setInterval(function () {
      if (!document.body.contains(live) || document.hidden || ADM_TAB !== "ov") return;
      adm("/api/admin/metrics").then(function (x) { paintLive(x); paintStats(x); paintCharts(x); }).catch(function () {});
    }, 30000);
    if (!ADM.kv) put("ov", h("div", "acard", "Storage isn't connected, so picks, notices and member stats can't be saved yet."));

    var c2 = h("div", "acard");
    c2.appendChild(h("h3", null, "Site notice"));
    c2.appendChild(h("p", null, "A short message shown at the top of the home page for everyone. People can dismiss it."));
    var ni = h("input", "ainp");
    ni.type = "text";
    ni.maxLength = 200;
    ni.placeholder = "e.g. Jagun Jagun 2 trailer is out!";
    ni.value = ADM.notice || "";
    c2.appendChild(ni);
    var priB = h("button", "abtn alt", "");
    var priOn = !!ADM.noticePri;
    function paintPri() { priB.textContent = "Priority: " + (priOn ? "ON (cannot be dismissed)" : "OFF"); priB.style.background = priOn ? "#e50914" : ""; priB.style.color = priOn ? "#fff" : ""; }
    paintPri();
    priB.onclick = function () { priOn = !priOn; paintPri(); };
    c2.appendChild(priB);
    var ns = h("button", "abtn", "Save notice");
    ns.onclick = function () {
      adm("/api/admin/notice", { text: ni.value, priority: priOn }).then(function (r) {
        ADM.notice = r.notice; ADM.noticePri = r.priority;
        toast(r.notice ? "Notice saved" : "Notice cleared");
        try { localStorage.removeItem("boa_notice_x"); } catch (e) {}
      }).catch(function (e) { toast("Couldn't save: " + e.message); });
    };
    var nc = h("button", "abtn alt", "Clear");
    nc.onclick = function () { ni.value = ""; ns.onclick(); };
    c2.appendChild(ns);
    c2.appendChild(nc);
    put("ov", c2);

    var c3 = h("div", "acard");
    c3.appendChild(h("h3", null, "Boa Picks"));
    c3.appendChild(h("p", null, "Titles you feature first. If TMDB has the title, its poster and details are used; otherwise your own details below are shown. Changes appear within about a minute."));
    if (!ADM.picks.length) c3.appendChild(h("p", null, "No picks yet."));
    ADM.picks.forEach(function (pk, i) {
      var row = h("div", "arow" + (i === 0 ? " first" : ""));
      var info = h("div");
      info.appendChild(h("b", null, pk.title));
      info.appendChild(h("span", null, (pk.media === "tv" ? "Series" : "Movie") + (pk.date ? " · " + pk.date : " · date not set") + (pk.trailer ? " · trailer" : "")));
      row.appendChild(info);
      var rm = h("button", "abtn red", "Remove");
      rm.onclick = function () {
        function go() { var l = ADM.picks.slice(); l.splice(i, 1); savePicks(l, "Removed"); }
        if (tg && tg.showConfirm) { try { tg.showConfirm("Remove " + pk.title + "?", function (ok) { if (ok) go(); }); return; } catch (e) {} }
        if (window.confirm("Remove " + pk.title + "?")) go();
      };
      row.appendChild(rm);
      c3.appendChild(row);
    });
    c3.appendChild(h("h3", null, "Add a pick"));
    var f = {};
    function field(key, tagName, ph, type) {
      var el = h(tagName, "ainp");
      if (type) el.type = type;
      if (ph) el.placeholder = ph;
      f[key] = el;
      c3.appendChild(el);
      return el;
    }
    field("title", "input", "Exact title, e.g. Jagun Jagun 2", "text");
    var sel = h("select", "ainp");
    sel.appendChild(h("option", null, "Movie"));
    sel.appendChild(h("option", null, "Series"));
    f.media = sel;
    c3.appendChild(sel);
    field("date", "input", "Release date", "date");
    field("poster", "input", "Poster image link (https, optional)", "url");
    field("trailer", "input", "YouTube trailer link (optional)", "url");
    field("note", "textarea", "A line or two for the details page");
    var add = h("button", "abtn", "Add pick");
    add.onclick = function () {
      var t = f.title.value.trim();
      if (!t) { toast("Type the title first"); return; }
      var l = ADM.picks.slice();
      l.push({ title: t, media: f.media.value === "Series" ? "tv" : "movie", date: f.date.value || "", poster: f.poster.value.trim(), trailer: f.trailer.value.trim(), note: f.note.value.trim() });
      savePicks(l, "Pick added");
    };
    c3.appendChild(add);
    if (ADM.custom) {
      var rs = h("button", "abtn alt", "Reset to defaults");
      rs.onclick = function () {
        adm("/api/admin/picks", { reset: true }).then(function (r) { ADM.picks = r.picks; ADM.custom = false; renderAdmin(false); toast("Reset"); }).catch(function (e) { toast("Couldn't reset: " + e.message); });
      };
      c3.appendChild(rs);
    }
    put("ov", c3);
    var secAds = mkSection("ads", "Ads");
    function drawAds() {
      var put = function (t, el) { secAds.body.appendChild(el); }, toast = function (m) { secAds.say(m); };
      secAds.body.textContent = ""; secAds.clear();
    // ===== ADS TAB (VAST pre-roll and mid-roll) =====
    var A = ADM.ads || { on: false, tag: "", midTag: "", pre: true, mid: true, lock: 15, skip: 15, movie: [35, 40], tv: [20, 25] };
    var cAd = h("div", "acard");
    cAd.appendChild(h("h3", null, "Video ads (HilltopAds VAST)"));
    cAd.appendChild(h("p", null, "Show a short ad before a stream starts and one in the middle of long videos. Paste your HilltopAds VAST tag URL (no API key needed). The pre-roll is locked for 15 seconds before the video starts, and a mid-roll gets a 15-second skip countdown. If an ad is empty, blocked or fails, the video simply starts."));
    var adOn = !!A.on;
    var adTog = h("button", "abtn", "");
    function paintAdTog() { adTog.textContent = "Ads: " + (adOn ? "ON" : "OFF"); adTog.style.background = adOn ? "#16a34a" : ""; adTog.style.color = adOn ? "#fff" : ""; }
    paintAdTog();
    adTog.onclick = function () { adOn = !adOn; paintAdTog(); };
    cAd.appendChild(adTog);
    function labeled(txt, el) { var w = h("label", "adlab"); w.appendChild(h("span", null, txt)); w.appendChild(el); cAd.appendChild(w); return el; }
    var tagIn = h("input", "ainp"); tagIn.type = "url"; tagIn.placeholder = "https://... HilltopAds VAST tag URL"; tagIn.value = A.tag || "";
    labeled("Pre-roll HilltopAds VAST tag", tagIn);
    var midIn = h("input", "ainp"); midIn.type = "url"; midIn.placeholder = "Optional: separate mid-roll tag (blank = same tag)"; midIn.value = A.midTag || "";
    labeled("Mid-roll HilltopAds VAST tag (optional)", midIn);
    function chk(txt, on) {
      var l = h("label", "achk"), cb = h("input"); cb.type = "checkbox"; cb.checked = on;
      l.appendChild(cb); l.appendChild(document.createTextNode(txt)); cAd.appendChild(l); return cb;
    }
    var preCb = chk("Pre-roll ad before the stream starts", A.pre !== false);
    var midCb = chk("Mid-roll ad during long videos", A.mid !== false);
    function num(v) { var n = h("input", "ainp"); n.type = "number"; n.min = "0"; n.value = String(v); n.style.width = "90px"; return n; }
    var lockIn = num(A.lock == null ? 15 : A.lock);
    labeled("Pre-roll lock: no skip for this many seconds (0 = cannot skip)", lockIn);
    var skipIn = num(A.skip == null ? 15 : A.skip);
    labeled("Mid-roll skip button appears after (seconds, 0 = no skip)", skipIn);
    var viewIn = num(A.view == null ? 5 : A.view);
    labeled("A view counts after (seconds watched). Skip stays locked until then", viewIn);
    var mvA = num(A.movie[0]), mvB = num(A.movie[1]), tvA = num(A.tv[0]), tvB = num(A.tv[1]);
    var rowM = h("div", "arow2"); rowM.appendChild(mvA); rowM.appendChild(h("span", null, "to")); rowM.appendChild(mvB); rowM.appendChild(h("span", null, "min"));
    var wM = h("label", "adlab"); wM.appendChild(h("span", null, "Movies (2 hours or longer): mid-roll between")); wM.appendChild(rowM); cAd.appendChild(wM);
    var rowT = h("div", "arow2"); rowT.appendChild(tvA); rowT.appendChild(h("span", null, "to")); rowT.appendChild(tvB); rowT.appendChild(h("span", null, "min"));
    var wT = h("label", "adlab"); wT.appendChild(h("span", null, "Series and other videos 25 min to 2 h: mid-roll between")); wT.appendChild(rowT); cAd.appendChild(wT);
    cAd.appendChild(h("p", null, "Videos under 25 minutes never get a mid-roll."));
    var adOut = h("div", "tout");
    var adSave = h("button", "abtn", "Save ad settings");
    adSave.onclick = function () {
      adm("/api/admin/ads", { on: adOn, tag: tagIn.value, midTag: midIn.value, pre: preCb.checked, mid: midCb.checked, lock: +lockIn.value, skip: +skipIn.value, view: +viewIn.value, movie: [+mvA.value, +mvB.value], tv: [+tvA.value, +tvB.value] }).then(function (r) {
        ADM.ads = r.ads; drawAds(); toast("Ad settings saved. Live now");
      }).catch(function (e) { toast("Couldn't save: " + e.message); });
    };
    var adTest = h("button", "abtn", "Test ad tag");
    adTest.onclick = function () {
      adOut.textContent = "Testing…";
      adm("/api/admin/ads-test", { tag: tagIn.value }).then(function (r) {
        adOut.textContent = r.ok ? ("Working: " + r.seconds + "s " + r.type + ", " + r.impressions + " impression pixel(s), " + (r.clickable ? "clickable" : "not clickable") + ". Tracking: " + (r.events.join(", ") || "none")) : ("Problem: " + r.error);
      }).catch(function (e) { adOut.textContent = "Test failed: " + e.message; });
    };
    var adRow = h("div", "arow2"); adRow.appendChild(adSave); adRow.appendChild(adTest);
    cAd.appendChild(adRow);
    cAd.appendChild(adOut);
    put("ads", cAd);
    }
    drawAds();


    // ===== INTEGRATIONS TAB (personal API keys + options; saved to KV only when Save is pressed) =====
    var cInt = h("div", "");
    var INT_DEF = [
      ["tmdb", "TMDb Enrichment", "Posters, details and trailers. Blank key uses the built-in key.", "en-US"],
      ["mdblist", "MDBList Ratings", "IMDb, Rotten Tomatoes and more ratings on title pages.", "en"],
      ["subdl", "SubDL Subtitles", "Extra subtitle source for movies and shows.", "en"],
      ["ads", "Video Ads (HilltopAds VAST)", "Optional zone ID and tag template for HilltopAds. Used when the Ads tab has no tag. No API key is used.", ""],
      ["bridge", "Torrent Bridge", "Optional. Turns torrents into direct HTTP/HLS streams so any browser can play them. Your own server, never Render.", ""]
    ];
    var INT_OPTS = {
      tmdb: [["trailers", "Trailers"], ["cast", "Cast and crew"]],
      mdblist: [["imdb", "IMDb rating"], ["rt", "Rotten Tomatoes"], ["metacritic", "Metacritic"], ["letterboxd", "Letterboxd"]],
      subdl: [["auto", "Auto-pick English subtitles"], ["hi", "Include hearing-impaired"]],
      ads: [["viewgate", "Hold Skip until a view counts"]]
    };
    function intData() { return ADM.integ || { tmdb: {}, mdblist: {}, subdl: {}, bridge: {}, custom: [] }; }
    function drawInt(sel) {
      cInt.innerHTML = "";
      var I = intData();
      if (!sel) {
        cInt.appendChild(h("p", "", "Add your own API keys. Leave a key blank to use the app default. Keys are stored privately and never shown in full."));
        var grid = h("div", "igrid");
        function card(kind, title, sub, x, idx) {
          var b = h("div", "icard", "");
          b.setAttribute("role", "button");
          b.appendChild(h("b", null, title));
          b.appendChild(h("span", null, sub));
          var row = h("div", "swrow");
          row.style.padding = "8px 0 0";
          row.appendChild(h("span", null, (x && x.keySet ? "Key saved" : "Default key")));
          if (x) {
            var q = h("button", "sw" + (x.on ? " on" : ""), "");
            q.setAttribute("role", "switch");
            q.onclick = function (ev) {
              ev.stopPropagation();
              var nb = { kind: kind, on: !x.on };
              if (kind === "custom") nb.id = x.id;
              adm("/api/admin/integrations", nb).then(function (r) { ADM.integ = r.integ; drawInt(null); toast(nb.on ? "Turned on" : "Turned off"); }).catch(function (e) { toast("Couldn't save: " + e.message); });
            };
            row.appendChild(q);
          }
          b.appendChild(row);
          b.onclick = function () { drawInt({ kind: kind, idx: idx }); };
          grid.appendChild(b);
        }
        INT_DEF.forEach(function (d) { card(d[0], d[1], d[2], I[d[0]], -1); });
        (I.custom || []).forEach(function (x, i) { card("custom", x.name || "Custom key", x.url || "Custom API key", x, i); });
        if ((I.custom || []).length < 8) card("custom", "+ Custom API key", "Any other service you use", null, -1);
        cInt.appendChild(grid);
        return;
      }
      var kind = sel.kind, isC = kind === "custom", x = isC ? (I.custom || [])[sel.idx] : I[kind];
      x = x || { on: true, opts: {}, lang: "" };
      var def = INT_DEF.filter(function (d) { return d[0] === kind; })[0];
      var c = h("div", "acard");
      var back = h("button", "abtn alt", "\u2190 Integrations");
      back.onclick = function () { drawInt(null); };
      c.appendChild(back);
      c.appendChild(h("h3", null, isC ? (x.name ? x.name : "New custom key") : def[1]));
      if (!isC) c.appendChild(h("p", null, def[2]));
      var on = x.on !== false && (isC || !!x.on);
      var sw = h("button", "sw" + (on ? " on" : ""), "");
      sw.setAttribute("role", "switch");
      sw.onclick = function () { on = !on; sw.className = "sw" + (on ? " on" : ""); };
      var r0 = h("div", "swrow"); r0.appendChild(h("span", null, "Enable")); r0.appendChild(sw); c.appendChild(r0);
      var nameIn = null, urlIn = null, langIn = null, opts = {};
      if (isC) {
        nameIn = h("input", "ainp"); nameIn.type = "text"; nameIn.maxLength = 40; nameIn.placeholder = "Name, e.g. OpenSubtitles"; nameIn.value = x.name || "";
        c.appendChild(nameIn);
        urlIn = h("input", "ainp"); urlIn.type = "url"; urlIn.placeholder = "Optional base URL (https://...)"; urlIn.value = x.url || "";
        c.appendChild(urlIn);
      }
      if (kind !== "ads") c.appendChild(h("p", null, "Personal API key" + (x.keySet ? " (saved: " + x.mask + ")" : " (blank = default)")));
      var kr = h("div", "keyrow");
      var keyIn = h("input", "ainp"); keyIn.type = "password"; keyIn.autocomplete = "off"; keyIn.spellcheck = false;
      keyIn.placeholder = x.keySet ? x.mask + "  (type to replace)" : "Paste your key";
      var eye = h("button", "eye", "\uD83D\uDC41");
      eye.setAttribute("aria-label", "Show or hide key");
      eye.onclick = function () { keyIn.type = keyIn.type === "password" ? "text" : "password"; eye.style.opacity = keyIn.type === "text" ? "1" : ".6"; };
      eye.style.opacity = ".6";
      kr.appendChild(keyIn); kr.appendChild(eye); if (kind !== "ads") c.appendChild(kr);
      var clr = false;
      if (x.keySet && kind !== "ads") {
        var cl = h("button", "abtn alt", "Remove saved key (use default)");
        cl.onclick = function () { clr = true; keyIn.value = ""; keyIn.placeholder = "Key will be removed on Save"; cl.style.display = "none"; };
        c.appendChild(cl);
      }
      var zoneIn = null, midZ = null, tplIn = null;
      if (kind === "ads") {
        c.appendChild(h("p", null, "Zone ID (pre-roll)"));
        zoneIn = h("input", "ainp"); zoneIn.type = "text"; zoneIn.maxLength = 40; zoneIn.placeholder = "e.g. 5123456"; zoneIn.value = x.zone || ""; c.appendChild(zoneIn);
        c.appendChild(h("p", null, "Zone ID (mid-roll, optional)"));
        midZ = h("input", "ainp"); midZ.type = "text"; midZ.maxLength = 40; midZ.placeholder = "blank = same zone"; midZ.value = x.midZone || ""; c.appendChild(midZ);
        c.appendChild(h("p", null, "HilltopAds VAST template (optional). Use {ZONE} for the zone ID. Blank = no ad"));
        tplIn = h("input", "ainp"); tplIn.type = "url"; tplIn.placeholder = "https://.../your-hilltopads-vast-url?zone={ZONE}"; tplIn.value = x.url || ""; c.appendChild(tplIn);
      }
      var brIn = null;
      if (kind === "bridge") {
        c.appendChild(h("p", null, "Bridge address. Use {magnet} or {hash} for an instant link (e.g. https://your-server/stream?link={magnet}&index=1&play), or give a resolver address that answers {\"url\": ...}. The key below is optional."));
        brIn = h("input", "ainp"); brIn.type = "url"; brIn.placeholder = "https://your-bridge.example/stream?link={magnet}&index=1&play"; brIn.value = x.url || ""; c.appendChild(brIn);
      }
      if (!isC) {
        if (kind !== "ads" && kind !== "bridge") {
          langIn = h("input", "ainp"); langIn.type = "text"; langIn.maxLength = 8; langIn.placeholder = "Language, e.g. " + def[3]; langIn.value = x.lang || def[3];
          c.appendChild(h("p", null, "Language"));
          c.appendChild(langIn);
        }
        (INT_OPTS[kind] || []).forEach(function (o) {
          var v = x.opts && x.opts[o[0]] !== undefined ? !!x.opts[o[0]] : false;
          opts[o[0]] = v;
          var b = h("button", "sw" + (v ? " on" : ""), "");
          b.setAttribute("role", "switch");
          b.onclick = function () { opts[o[0]] = !opts[o[0]]; b.className = "sw" + (opts[o[0]] ? " on" : ""); };
          var rr = h("div", "swrow"); rr.appendChild(h("span", null, o[1])); rr.appendChild(b); c.appendChild(rr);
        });
      }
      var save = h("button", "abtn", "Save");
      save.onclick = function () {
        var body = { kind: kind, on: on };
        if (isC) { body.id = x.id; body.name = nameIn.value; body.url = urlIn.value; }
        else { if (langIn) body.lang = langIn.value; body.opts = opts; if (kind === "ads") { body.zone = zoneIn.value; body.midZone = midZ.value; body.url = tplIn.value; } if (kind === "bridge") body.url = brIn.value; }
        if (clr) body.key = ""; else if (keyIn.value.trim()) body.key = keyIn.value.trim();
        adm("/api/admin/integrations", body).then(function (r) {
          ADM.integ = r.integ; toast("Saved"); drawInt(null);
        }).catch(function (e) { toast("Couldn't save: " + e.message); });
      };
      c.appendChild(save);
      if (isC && x.id) {
        var rm = h("button", "abtn red", "Delete");
        rm.onclick = function () {
          if (!confirm("Delete this key?")) return;
          adm("/api/admin/integrations", { kind: "custom", id: x.id, remove: true }).then(function (r) { ADM.integ = r.integ; toast("Deleted"); drawInt(null); }).catch(function (e) { toast("Couldn't delete: " + e.message); });
        };
        c.appendChild(rm);
      }
      cInt.appendChild(c);
    }
    drawInt(null);
    put("int", cInt);

    // ===== ADD-ONS TAB (install, inspect, refresh, settings, delete) =====
    function confirmThen(msg, go) {
      if (tg && tg.showConfirm) { try { tg.showConfirm(msg, function (ok) { if (ok) go(); }); return; } catch (e) {} }
      if (window.confirm(msg)) go();
    }
    function previewInto(target, base, cat) {
      target.textContent = "";
      target.appendChild(h("p", null, "Loading…"));
      adm("/api/admin/addon-preview", { base: base, type: cat.type, id: cat.id }).then(function (r) {
        target.textContent = "";
        target.appendChild(h("p", null, r.total + " titles in this catalog. First " + r.items.length + ":"));
        var wrap = h("div", "apv");
        r.items.forEach(function (it) {
          var c = h("div", "apvi");
          if (it.poster) { var im = h("img"); im.loading = "lazy"; im.alt = ""; im.src = it.poster; c.appendChild(im); }
          c.appendChild(h("span", null, it.name + (it.year ? " (" + it.year + ")" : "")));
          wrap.appendChild(c);
        });
        target.appendChild(wrap);
      }).catch(function (e) { target.textContent = ""; target.appendChild(h("p", null, "Couldn't preview: " + e.message)); });
    }
    function catPicker(parent, base, cats, selected) {
      var boxes = [];
      var tools = h("div", "arow2");
      var all = h("button", "abtn mini", "Select all");
      var none = h("button", "abtn mini", "None");
      tools.appendChild(all); tools.appendChild(none);
      parent.appendChild(tools);
      cats.forEach(function (c) {
        var lab = h("div", "achk2");
        var l = h("label", "achk");
        var cb = h("input"); cb.type = "checkbox"; cb.checked = selected(c);
        l.appendChild(cb);
        l.appendChild(document.createTextNode(c.name + " (" + (c.type === "series" ? "Series" : "Movies") + ")"));
        lab.appendChild(l);
        var pv = h("button", "abtn mini", "Preview");
        var pvBox = h("div");
        pv.onclick = function () { if (pvBox.firstChild) { pvBox.textContent = ""; return; } previewInto(pvBox, base, c); };
        lab.appendChild(pv);
        parent.appendChild(lab);
        parent.appendChild(pvBox);
        boxes.push({ cb: cb, c: c });
      });
      all.onclick = function () { boxes.forEach(function (x) { x.cb.checked = true; }); };
      none.onclick = function () { boxes.forEach(function (x) { x.cb.checked = false; }); };
      return function () { return boxes.filter(function (x) { return x.cb.checked; }).map(function (x) { return { type: x.c.type, id: x.c.id }; }); };
    }
    var secAd = mkSection("ad", "Add-ons");
    function drawAd() {
      var put = function (t, el) { secAd.body.appendChild(el); }, toast = function (m) { secAd.say(m); };
      secAd.body.textContent = ""; secAd.clear();
    var cHM = h("div", "acard");
    cHM.appendChild(h("h3", null, "Home page rows"));
    cHM.appendChild(h("p", null, "Choose what the home page shows below the top banner. Switch back any time; nothing is deleted."));
    var hmRow = h("div", "arow2");
    [["addons", "Add-ons only"], ["builtin", "Original rows"]].forEach(function (o) {
      var b = h("button", "abtn mini", o[1]);
      b.style.opacity = (ADM.homeMode || "builtin") === o[0] ? "1" : ".5";
      if ((ADM.homeMode || "builtin") === o[0]) b.textContent = "\u2713 " + o[1];
      b.onclick = function () {
        adm("/api/admin/homemode", { mode: o[0] }).then(function (r) { ADM.homeMode = r.homeMode; drawAd(); toast(o[0] === "addons" ? "Home now shows only your add-on rows" : "Original rows restored"); }).catch(function (e) { toast("Couldn't change: " + e.message); });
      };
      hmRow.appendChild(b);
    });
    cHM.appendChild(hmRow);
    put("ad", cHM);
    var cAI = h("div", "acard");
    cAI.appendChild(h("h3", null, "Install an add-on"));
    cAI.appendChild(h("p", null, "Paste a Stremio-style add-on link (ending in manifest.json). Check it first, look inside each catalog with Preview, then install only what you want. No limit on add-ons or catalogs."));
    var au = h("input", "ainp");
    au.type = "url";
    au.placeholder = "https://.../manifest.json";
    au.setAttribute("autocapitalize", "off");
    au.setAttribute("autocomplete", "off");
    cAI.appendChild(au);
    var ares = h("div");
    var ab = h("button", "abtn", "Check add-on");
    ab.onclick = function () {
      var u = au.value.trim();
      if (!u) { toast("Paste the add-on link first"); return; }
      ares.textContent = "";
      ares.appendChild(h("p", null, "Checking…"));
      adm("/api/admin/addon-inspect", { url: u }).then(function (r) {
        ares.textContent = "";
        ares.appendChild(h("h3", null, r.name + (r.version ? " v" + r.version : "")));
        if (r.description) ares.appendChild(h("p", null, r.description));
        if (r.hasStreams) ares.appendChild(h("p", null, "This add-on also offers streams. Boa Cinema ignores them and only uses its catalogs."));
        if (r.skipped) ares.appendChild(h("p", null, r.skipped + " catalog(s) skipped (they need a search or filter, or aren't movies/series)."));
        if (!r.cats.length && r.hasSubs) {
          ares.appendChild(h("p", null, "This is a subtitles add-on. It adds a Subtitles menu to the stream player."));
          var si = h("button", "abtn", "Install subtitles add-on");
          si.onclick = function () {
            adm("/api/admin/addons", { action: "add", base: r.base, subs: true, cats: [] }).then(function (res) { ADM.addons = res.addons; drawAd(); toast("Subtitles add-on installed"); }).catch(function (e) { toast("Couldn't install: " + e.message); });
          };
          ares.appendChild(si);
          return;
        }
        if (!r.cats.length) {
          var rs = r.resources || [];
          var why = "No usable catalogs found.";
          if (rs.indexOf("subtitles") >= 0) why = "This is a subtitles add-on. There is nothing to show from it.";
          else if (rs.indexOf("stream") >= 0) why = "This add-on only offers streams. Use the Plugins tab for scrapers instead.";
          ares.appendChild(h("p", null, why));
          return;
        }
        ares.appendChild(h("p", null, r.cats.length + " catalogs found. Tick the ones to install:"));
        var getPicked = catPicker(ares, r.base, r.cats, function () { return true; });
        var repLab = h("label", "achk");
        var repCb = h("input"); repCb.type = "checkbox";
        repLab.appendChild(repCb);
        repLab.appendChild(document.createTextNode("Replace everything: show only this add-on on the home page (switch back anytime)"));
        if ((ADM.addons || []).length) ares.appendChild(repLab);
        var inst = h("button", "abtn", "Install selected");
        inst.onclick = function () {
          var picked = getPicked();
          if (!picked.length) { toast("Tick at least one catalog"); return; }
          inst.disabled = true;
          var chain = Promise.resolve();
          if (repCb.checked) {
            (ADM.addons || []).forEach(function (o) {
              if (o.base === r.base) return;
              chain = chain.then(function () { return adm("/api/admin/addons", { action: "remove", id: o.id, base: o.base }); });
            });
          }
          if (repCb.checked) chain = chain.then(function () { return adm("/api/admin/homemode", { mode: "addons" }).then(function (m) { ADM.homeMode = m.homeMode; }); });
          chain.then(function () { return adm("/api/admin/addons", { action: "add", base: r.base, cats: picked }); }).then(function (res) {
            ADM.addons = res.addons;
            drawAd();
            toast("Installed. Pull the home page to see new rows");
          }).catch(function (e) { inst.disabled = false; toast("Couldn't install: " + e.message); });
        };
        ares.appendChild(inst);
      }).catch(function (e) {
        ares.textContent = "";
        ares.appendChild(h("p", null, "Couldn't use that link: " + e.message));
      });
    };
    var ib = h("button", "abtn", "Install add-on");
    ib.onclick = function () {
      var u = au.value.trim();
      if (!u) { toast("Paste the add-on link first"); return; }
      ib.disabled = true; ib.textContent = "Installing\u2026";
      adm("/api/admin/addon-inspect", { url: u }).then(function (r) {
        if (!r.cats.length && !r.hasSubs) throw new Error("no usable catalogs (use Plugins for stream add-ons)");
        if (!r.cats.length) return adm("/api/admin/addons", { action: "add", base: r.base, subs: true, cats: [] });
        return adm("/api/admin/addons", { action: "add", base: r.base, cats: r.cats.map(function (c) { return { type: c.type, id: c.id }; }) });
      }).then(function (res) {
        ADM.addons = res.addons; drawAd();
        toast("Installed and active now");
      }).catch(function (e) { ib.disabled = false; ib.textContent = "Install add-on"; toast("Couldn't install: " + e.message); });
    };
    var btnRow = h("div", "arow2");
    btnRow.appendChild(ab); btnRow.appendChild(ib);
    cAI.appendChild(btnRow);
    cAI.appendChild(ares);
    put("ad", cAI);

    var cAL = h("div", "acard");
    var addons = ADM.addons || [];
    cAL.appendChild(h("h3", null, "Installed add-ons (" + addons.length + ")"));
    if (!addons.length) cAL.appendChild(h("p", null, "Nothing installed yet."));
    addons.forEach(function (a) {
      var card = h("div", "adon");
      var top = h("div", "adtop");
      var inf = h("div");
      inf.appendChild(h("b", null, a.name || "Add-on"));
      var host = "";
      try { host = new URL(a.base || "").host; } catch (e) {}
      inf.appendChild(h("span", null, (a.subs ? "Subtitles add-on" : (a.cats || []).length + " catalogs") + (host ? " • " + host : "") + (a.enabled === false ? " • Disabled" : "")));
      top.appendChild(inf);
      card.appendChild(top);
      var btns = h("div", "adbtns");
      var det = h("div");
      var setB = h("button", "abtn mini", "Settings");
      if (a.subs) setB.style.display = "none";
      setB.onclick = function () {
        if (det.firstChild) { det.textContent = ""; return; }
        det.appendChild(h("p", null, "Loading…"));
        adm("/api/admin/addon-inspect", { url: (a.base || "") + "/manifest.json" }).then(function (r) {
          det.textContent = "";
          det.appendChild(h("p", null, a.base || ""));
          if (r.description) det.appendChild(h("p", null, r.description));
          var chosen = {};
          (a.cats || []).forEach(function (c) { chosen[c.type + "|" + c.id] = 1; });
          var getPicked = catPicker(det, r.base || a.base, r.cats, function (c) { return !!chosen[c.type + "|" + c.id]; });
          var sv = h("button", "abtn", "Save catalogs");
          sv.onclick = function () {
            var picked = getPicked();
            if (!picked.length) { toast("Keep at least one catalog, or use Delete"); return; }
            adm("/api/admin/addons", { action: "update", id: a.id, cats: picked }).then(function (res) { ADM.addons = res.addons; drawAd(); toast("Saved"); }).catch(function (e) { toast("Couldn't save: " + e.message); });
          };
          det.appendChild(sv);
        }).catch(function (e) { det.textContent = ""; det.appendChild(h("p", null, "Couldn't load this add-on: " + e.message + ". It may be offline; you can still Delete it.")); });
      };
      btns.appendChild(setB);
      var rf = h("button", "abtn mini", "Refresh");
      rf.onclick = function () {
        rf.textContent = "…";
        adm("/api/admin/addons", { action: "refresh", id: a.id }).then(function (res) { ADM.addons = res.addons; drawAd(); toast("Refreshed"); }).catch(function (e) { rf.textContent = "Refresh"; toast("Couldn't refresh: " + e.message); });
      };
      btns.appendChild(rf);
      var tg2 = h("button", "abtn mini", a.enabled === false ? "Enable" : "Disable");
      tg2.onclick = function () {
        adm("/api/admin/addons", { action: "toggle", id: a.id, enabled: a.enabled === false }).then(function (res) { ADM.addons = res.addons; drawAd(); }).catch(function (e) { toast("Couldn't change: " + e.message); });
      };
      btns.appendChild(tg2);
      var rm = h("button", "abtn mini red", "Delete");
      rm.onclick = function () {
        confirmThen("Delete " + (a.name || "this add-on") + "?", function () {
          adm("/api/admin/addons", { action: "remove", id: a.id, base: a.base }).then(function (res) { ADM.addons = res.addons; drawAd(); toast("Deleted"); }).catch(function (e) { toast("Couldn't delete: " + e.message); });
        });
      };
      btns.appendChild(rm);
      card.appendChild(btns);
      card.appendChild(det);
      cAL.appendChild(card);
    });
    put("ad", cAL);
    }
    drawAd();


    // === MEDIA SERVERS CARD (Nuvio style) ===
    var cMS = h("div", "acard");
    cMS.appendChild(h("h3", null, "Media servers"));
    cMS.appendChild(h("p", null, "Connect Jellyfin or Emby to browse and play your own library."));
    var msName = h("input", "ainp"); msName.placeholder = "Server Name (e.g. Home Jellyfin)"; msName.value = (ADM.mediaServer && ADM.mediaServer.name) || "";
    var msUrl = h("input", "ainp"); msUrl.type = "url"; msUrl.placeholder = "Server URL (https://...)"; msUrl.value = (ADM.mediaServer && ADM.mediaServer.url) || "";
    var msKey = h("input", "ainp"); msKey.type = "password"; msKey.placeholder = "API Key / Token"; msKey.value = (ADM.mediaServer && ADM.mediaServer.apiKey) || "";
    cMS.appendChild(msName); cMS.appendChild(msUrl); cMS.appendChild(msKey);
    var msBtn = h("button", "abtn", "Save Media Server");
    msBtn.onclick = function() {
      adm("/api/admin/media-server", { name: msName.value, url: msUrl.value, apiKey: msKey.value }).then(function(r) {
        ADM.mediaServer = r.mediaServer;
        toast("Media server updated");
      }).catch(function(e) { toast("Error: " + e.message); });
    };
    cMS.appendChild(msBtn);
    put("ov", cMS);

    var secNt = mkSection("nt", "Notices");
    function drawNt(edit) {
      var B = secNt.body, LB = ["Low", "Normal", "Critical / High"];
      B.textContent = "";
      var list = (ADM.notices || []).slice().sort(function (a, b) { return b.pri - a.pri || a.order - b.order || a.ts - b.ts; });
      var cF = h("div", "acard");
      cF.appendChild(h("h3", null, edit && edit.id ? "Edit notice" : "New notice"));
      cF.appendChild(h("p", null, "Active notices appear on the home page as a swipeable slider, highest priority first. Visitors must read to the last slide and tap Acknowledge. Adding or changing a notice shows it again."));
      var fT = h("input", "ainp"); fT.type = "text"; fT.maxLength = 80; fT.placeholder = "Title"; fT.setAttribute("aria-label", "Notice title");
      var fB = h("textarea", "ainp"); fB.maxLength = 1500; fB.placeholder = "Notice or disclaimer text"; fB.setAttribute("aria-label", "Notice text");
      var pri = 1, on = true;
      var fO = h("input", "ainp"); fO.type = "number"; fO.min = "0"; fO.max = "999"; fO.placeholder = "Display order (0 = first within its priority)"; fO.setAttribute("aria-label", "Display order");
      if (edit) { fT.value = edit.title || ""; fB.value = edit.body || ""; pri = edit.pri; on = edit.on !== false; fO.value = String(edit.order || 0); }
      var pr = h("div", "npri"), pb = [];
      [[2, "Critical / High"], [1, "Normal"], [0, "Low"]].forEach(function (o) {
        var b = h("button", "", o[1]); b.type = "button";
        b.onclick = function () { pri = o[0]; paintP(); };
        pb.push([o[0], b]); pr.appendChild(b);
      });
      function paintP() { pb.forEach(function (x) { x[1].className = x[0] === pri ? "on" : ""; x[1].setAttribute("aria-pressed", x[0] === pri ? "true" : "false"); }); }
      paintP();
      var tg2 = h("button", "abtn alt", ""); tg2.type = "button";
      function paintO() { tg2.textContent = "Show on home page: " + (on ? "ON" : "OFF"); tg2.style.background = on ? "#e50914" : ""; tg2.style.color = on ? "#fff" : ""; tg2.setAttribute("aria-pressed", on ? "true" : "false"); }
      paintO(); tg2.onclick = function () { on = !on; paintO(); };
      var sv = h("button", "abtn", edit && edit.id ? "Save changes" : "Add notice"); sv.type = "button";
      sv.onclick = function () {
        if (!fT.value.trim() && !fB.value.trim()) { secNt.say("Couldn't save: add a title or some text first"); return; }
        sv.disabled = true;
        adm("/api/admin/notices", { action: "save", notice: { id: edit && edit.id, title: fT.value, body: fB.value, pri: pri, order: fO.value, on: on } }).then(function (r) {
          ADM.notices = r.notices; drawNt(); secNt.say("Notice saved");
        }).catch(function (e) { sv.disabled = false; secNt.say("Couldn't save: " + e.message); });
      };
      cF.appendChild(fT); cF.appendChild(fB); cF.appendChild(pr); cF.appendChild(fO); cF.appendChild(tg2); cF.appendChild(sv);
      if (edit) { var cx = h("button", "abtn alt", "Cancel"); cx.type = "button"; cx.onclick = function () { drawNt(); secNt.clear(); }; cF.appendChild(cx); }
      B.appendChild(cF);
      var cL = h("div", "acard");
      cL.appendChild(h("h3", null, "Your notices (" + list.length + ")"));
      if (!list.length) cL.appendChild(h("p", null, "No notices yet."));
      list.forEach(function (n, i) {
        var row = h("div", "arow" + (i ? "" : " first"));
        row.style.cssText = "flex-direction:column;align-items:stretch;gap:6px";
        var top = h("div"); top.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
        top.appendChild(h("span", "nbadge p" + n.pri, LB[n.pri]));
        var ob = h("span", null, "Order " + n.order + (n.on === false ? " • OFF" : " • ON")); ob.style.cssText = "font-size:12px;color:#a1a1aa";
        top.appendChild(ob); row.appendChild(top);
        var tt = h("b", null, n.title || "(no title)"); row.appendChild(tt);
        if (n.body) { var bd = h("span", null, n.body.length > 140 ? n.body.slice(0, 140) + "…" : n.body); row.appendChild(bd); }
        var ac = h("div"); ac.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
        var be = h("button", "abtn alt", "Edit"); be.type = "button"; be.onclick = function () { drawNt(n); secNt.clear(); try { secNt.title.scrollIntoView({ block: "start" }); } catch (e) {} };
        var bt = h("button", "abtn alt", n.on === false ? "Enable" : "Disable"); bt.type = "button";
        bt.onclick = function () {
          bt.disabled = true;
          adm("/api/admin/notices", { action: "toggle", id: n.id }).then(function (r) { ADM.notices = r.notices; drawNt(); secNt.say(n.on === false ? "Notice enabled" : "Notice disabled"); }).catch(function (e) { bt.disabled = false; secNt.say("Couldn't update: " + e.message); });
        };
        var bd2 = h("button", "abtn red", "Delete"); bd2.type = "button";
        bd2.onclick = function () {
          confirmThen("Delete this notice?", function () {
            adm("/api/admin/notices", { action: "delete", id: n.id }).then(function (r) { ADM.notices = r.notices; drawNt(); secNt.say("Notice deleted"); }).catch(function (e) { secNt.say("Couldn't delete: " + e.message); });
          });
        };
        ac.appendChild(be); ac.appendChild(bt); ac.appendChild(bd2); row.appendChild(ac);
        cL.appendChild(row);
      });
      B.appendChild(cL);
    }
    drawNt();

    var secPl = mkSection("pl", "Plugins");
    function drawPl() {
      var put = function (t, el) { secPl.body.appendChild(el); }, toast = function (m) { secPl.say(m); };
      secPl.body.textContent = ""; secPl.clear();
    // === PLUGINS CARD (Nuvio style) ===
    var cPl = h("div", "acard");
    cPl.appendChild(h("h3", null, "Plugins"));
    cPl.appendChild(h("p", null, "Install JavaScript scraper repositories and test providers internally."));
    var nuvioListWrap = h("div", null);
    nuvioListWrap.appendChild(h("div", "note", "Loading repositories & providers..."));
    cPl.appendChild(nuvioListWrap);

    adm("/api/admin/providers").then(function(data) {
      nuvioListWrap.textContent = "";
      var repos = data.repos || [];
      var providers = data.providers || [];

      // 1. Render Repositories Cards
      repos.forEach(function(repo) {
        var card = h("div", "arow");
        card.style.cssText = "flex-direction:column;align-items:stretch;gap:6px;padding:14px;background:#18181b;border:1px solid #27272a;border-radius:12px;margin-bottom:10px;";

        var topRow = h("div", null);
        topRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
        var titleEl = h("b", null, repo.name || "Repository");
        titleEl.style.fontSize = "16px";
        topRow.appendChild(titleEl);

        var rmBtn = h("button", "abtn red", "Remove");
        rmBtn.onclick = function() {
          confirmThen("Remove " + (repo.name || "this repository") + "?", function () {
            adm("/api/admin/plugins", { action: "remove", id: repo.id }).then(function(res) {
              ADM.plugins = res.plugins;
              drawPl();
              toast("Repository removed");
            }).catch(function (e) { toast("Couldn't remove: " + e.message); });
          });
        };
        topRow.appendChild(rmBtn);
        card.appendChild(topRow);

        var verEl = h("div", null, "Version " + (repo.version || "1.0.0"));
        verEl.style.cssText = "font-size:12px;color:#a1a1aa;";
        card.appendChild(verEl);

        var urlEl = h("div", null, repo.url || "");
        urlEl.style.cssText = "font-size:11px;color:#71717a;word-break:break-all;";
        card.appendChild(urlEl);

        var countBadge = h("span", null, (repo.providerCount || 0) + " providers");
        countBadge.style.cssText = "align-self:flex-start;background:#27272a;color:#d4d4d8;font-size:11px;padding:4px 10px;border-radius:6px;margin-top:4px;";
        card.appendChild(countBadge);
        var kindRow = h("div");
        kindRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;";
        var kb = h("span", null, repo.kind === "stremio" ? "Stremio add-on" : "Nuvio repository");
        kb.style.cssText = "background:#1e293b;color:#93c5fd;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;";
        kindRow.appendChild(kb);
        if (repo.forced) {
          var fb = h("span", null, "Custom / Forced");
          fb.style.cssText = "background:#451a03;color:#fbbf24;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;";
          kindRow.appendChild(fb);
        }
        card.appendChild(kindRow);

        nuvioListWrap.appendChild(card);
      });

           // ===== Installed providers (development view) =====
      // Shows the providers found in the repositories you installed, Nuvio style.
      // This is NOT your licensed list. That stays in its own card.
      // Delete = removes it from this list (saved in this browser). Refresh = re-reads /api/providers.
      if (!Array.isArray(providers)) providers = [];

      var repoNames = {};
      repos.forEach(function (r) { repoNames[r.id] = r.name; });

      var ipHidden = {};
      var ipSave = function () {};
      var ipKey = function (p) {
        return String(p.repoId || (typeof p.repo === "string" ? p.repo : "") || "") + "::" + String(p.id || p.name || "");
      };

      providers.forEach(function (p) { if (p.enabled === false) ipHidden[ipKey(p)] = 1; });
      var ipChip = function (text) {
        var c = h("span", null, text);
        c.style.cssText = "display:inline-block;background:#27272a;color:#e4e4e7;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;";
        return c;
      };

      var ipDraw; // defined below

      var ipCard = function (p) {
        var types = p.supportedTypes || p.types || p.type || "";
        if (Array.isArray(types)) types = types.join(" | ");
        types = String(types || "");
        var ver = p.version ? "v" + String(p.version).replace(/^v/i, "") : "";
        var repoLabel = p.repoName || repoNames[p.repoId] || repoNames[p.repo] || "";
        if (!repoLabel && typeof p.repo === "string") repoLabel = p.repo;
        var pname = p.name || p.title || p.id || "Provider";

        var row = h("div", null);
        row.style.cssText = "display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:14px;background:#18181b;border:1px solid #27272a;border-radius:16px;margin-bottom:12px;";

        var top = h("div", null);
        top.style.cssText = "display:flex;align-items:center;gap:12px;";

        var ico = h("div", null, String(pname).charAt(0).toUpperCase());
        ico.style.cssText = "width:40px;height:40px;border-radius:12px;background:#1e3a5f;color:#60a5fa;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;flex:none;";
        top.appendChild(ico);

        var txt = h("div", null);
        var pub = h("div", null, repoLabel);
        pub.style.cssText = "font-size:12px;font-weight:700;color:#a1a1aa;";
        var nm = h("div", null, pname);
        nm.style.cssText = "font-size:18px;font-weight:800;line-height:1.2;";
        var ds = h("div", null, p.description || p.desc || "");
        ds.style.cssText = "font-size:13px;color:#d4d4d8;margin-top:2px;";
        txt.appendChild(pub);
        txt.appendChild(nm);
        txt.appendChild(ds);
        top.appendChild(txt);
        row.appendChild(top);

        var chips = h("div", null);
        chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
        if (types) chips.appendChild(ipChip(types));
        if (ver) chips.appendChild(ipChip(ver));
        row.appendChild(chips);

        var btns = h("div", null);
        btns.style.cssText = "display:flex;gap:8px;";

        var tb = h("button", "abtn", "Test Provider");
        tb.style.cssText = "flex:1;margin:0;padding:12px 16px;border-radius:14px;";
        var tpanel = null;
        tb.onclick = function () {
          if (tpanel) { tpanel.remove(); tpanel = null; return; }
          tpanel = h("div", "tpanel");
          var isTv = /tv|series/i.test(types) && !/movie/i.test(types);
          var sel = h("select", "ainp");
          [["movie", "Movie (TMDB id)"], ["tv", "Series (TMDB id)"]].forEach(function (o) {
            var op = h("option", null, o[1]); op.value = o[0]; sel.appendChild(op);
          });
          sel.value = isTv ? "tv" : "movie";
          var tid = h("input", "ainp");
          tid.type = "text";
          tid.value = isTv ? "1399" : "550";
          tid.placeholder = "TMDB id, e.g. 550 (Fight Club) or 1399 (Game of Thrones)";
          sel.onchange = function () { tid.value = sel.value === "tv" ? "1399" : "550"; };
          var go = h("button", "abtn", "Run test");
          var out = h("div", "tout");
          go.onclick = function () {
            out.textContent = "Testing… can take up to 20 seconds";
            go.disabled = true;
            adm("/api/admin/test-provider", { url: p.url, type: sel.value, id: tid.value.trim(), s: 1, e: 1, kind: p.kind || "" }).then(function (r) {
              out.textContent = "";
              out.appendChild(h("b", null, r.ok ? "Working: " + r.count + " stream(s) in " + (r.ms / 1000).toFixed(1) + "s" : "No result" + (r.ms ? " after " + (r.ms / 1000).toFixed(1) + "s" : "")));
              if (r.error) out.appendChild(h("div", null, r.error));
              (r.sample || []).forEach(function (s) { out.appendChild(h("div", null, "• " + (s.title || "stream") + (s.quality ? " • " + s.quality : ""))); });
            }).catch(function (e) { out.textContent = "Test failed: " + e.message; }).then(function () { go.disabled = false; });
          };
          tpanel.appendChild(sel); tpanel.appendChild(tid); tpanel.appendChild(go); tpanel.appendChild(out);
          row.appendChild(tpanel);
        };
        btns.appendChild(tb);

        var del = h("button", "abtn red", "Delete");
        del.style.cssText = "margin:0;padding:12px 18px;border-radius:14px;";
        var armed = false;
        del.onclick = function () {
          if (!armed) {
            armed = true;
            del.textContent = "Tap again to delete";
            setTimeout(function () { armed = false; del.textContent = "Delete"; }, 3000);
            return;
          }
          adm("/api/admin/plugins", { action: "disable", id: p.repoId, provider: p.id }).then(function (res) {
            ADM.plugins = res.plugins;
            ipHidden[ipKey(p)] = 1;
            ipDraw();
            toast(pname + " deleted");
          }).catch(function (e) { toast("Couldn't delete: " + e.message); });
        };
        btns.appendChild(del);

        row.appendChild(btns);
        return row;
      };

      // Header row: title on the left, Refresh on the right
      var ipBar = h("div", null);
      ipBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:16px 2px 8px;";
      var ipHead = h("div", null, "PROVIDERS");
      ipHead.style.cssText = "font-size:12px;font-weight:800;letter-spacing:.6px;color:#a1a1aa;";
      var ipRefresh = h("button", "abtn", "Refresh");
      ipRefresh.style.cssText = "margin:0;padding:8px 16px;border-radius:999px;";
      ipBar.appendChild(ipHead);
      ipBar.appendChild(ipRefresh);
      nuvioListWrap.appendChild(ipBar);

      nuvioListWrap.appendChild(h("div", "note", "Found in the repositories you installed. For development only. Your licensed providers are listed separately below."));

      var ipSearch = h("input", "ainp");
      ipSearch.placeholder = "Search providers";
      nuvioListWrap.appendChild(ipSearch);

      var ipList = h("div", null);
      nuvioListWrap.appendChild(ipList);

      var ipMore = h("button", "abtn", "Show more");
      ipMore.style.cssText = "width:100%;margin:4px 0 12px;padding:12px 16px;border-radius:14px;";
      nuvioListWrap.appendChild(ipMore);

      var ipRestore = h("button", "abtn", "Restore deleted");
      ipRestore.style.cssText = "width:100%;margin:0 0 12px;padding:10px 16px;border-radius:14px;background:#27272a;color:#e4e4e7;";
      nuvioListWrap.appendChild(ipRestore);

      var ipLimit = 12;
      ipDraw = function () {
        var q = (ipSearch.value || "").toLowerCase();
        var vis = providers.filter(function (p) { return !ipHidden[ipKey(p)]; });
        var matches = vis.filter(function (p) {
          var hay = String(p.name || "") + " " + String(p.description || "") + " " + String(p.id || "");
          return !q || hay.toLowerCase().indexOf(q) !== -1;
        });
        ipHead.textContent = "PROVIDERS (" + vis.length + ")";
        ipList.textContent = "";
        matches.slice(0, ipLimit).forEach(function (p) { ipList.appendChild(ipCard(p)); });
        if (!matches.length) {
          ipList.appendChild(h("div", "note", vis.length ? "No providers match your search." : "No providers to show."));
        }
        if (matches.length > ipLimit) {
          ipMore.style.display = "";
          ipMore.textContent = "Show more (" + (matches.length - ipLimit) + " more)";
        } else {
          ipMore.style.display = "none";
        }
        var hiddenN = providers.length - vis.length;
        if (hiddenN > 0) {
          ipRestore.style.display = "";
          ipRestore.textContent = "Restore deleted (" + hiddenN + ")";
        } else {
          ipRestore.style.display = "none";
        }
      };

      ipSearch.oninput = function () { ipLimit = 12; ipDraw(); };
      ipMore.onclick = function () { ipLimit += 20; ipDraw(); };
      ipRestore.onclick = function () {
        adm("/api/admin/plugins", { action: "restore", id: "" }).then(function (res) {
          ADM.plugins = res.plugins;
          ipHidden = {};
          ipDraw();
          toast("Deleted providers restored");
        }).catch(function (e) { toast("Couldn't restore: " + e.message); });
      };
      ipRefresh.onclick = function () {
        ipRefresh.textContent = "Refreshing...";
        ipRefresh.disabled = true;
        adm("/api/admin/providers?fresh=1").then(function (d) {
          providers = Array.isArray(d.providers) ? d.providers : [];
          ipHidden = {};
          providers.forEach(function (p) { if (p.enabled === false) ipHidden[ipKey(p)] = 1; });
          (d.repos || []).forEach(function (r) { repoNames[r.id] = r.name; });
          ipDraw();
          toast("Refreshed: " + providers.length + " providers");
        }).catch(function (e) {
          toast("Couldn't refresh: " + e.message);
        }).then(function () {
          ipRefresh.disabled = false;
          ipRefresh.textContent = "Refresh";
        });
      };
      ipDraw();
      // ===== end installed providers =====
}).catch(function (e) { nuvioListWrap.textContent = "Couldn't load repositories: " + (e && e.message ? e.message : "try again"); });



      // 2. Render Expanded Providers Section
    var plName = h("input", "ainp"); plName.placeholder = "Plugin Name (optional)";
    var plUrl = h("input", "ainp"); plUrl.type = "url"; plUrl.placeholder = "Repository URL (https://...)";
    cPl.insertBefore(plName, nuvioListWrap); cPl.insertBefore(plUrl, nuvioListWrap);
    var plForceLab = h("label", "achk");
    var plForce = h("input"); plForce.type = "checkbox";
    plForceLab.appendChild(plForce);
    plForceLab.appendChild(document.createTextNode("Force Install (save it even if the format isn't recognised)"));
    cPl.insertBefore(plForceLab, nuvioListWrap);
    var plAdd = h("button", "abtn", "Install Plugin");
    plAdd.onclick = function() {
      plAdd.disabled = true;
      adm("/api/admin/plugins", { action: "add", name: plName.value, url: plUrl.value, force: plForce.checked }).then(function(r) {
        ADM.plugins = r.plugins;
        drawPl();
        toast("Plugin installed");
      }).catch(function(e) { plAdd.disabled = false; toast("Error: " + e.message); });
    };
    cPl.insertBefore(plAdd, nuvioListWrap);
    put("pl", cPl);
    // ===== Licensed providers (separate card) =====
    // Edit this list. Remove "sample: true" from an entry once it is a real, licensed provider.
    var LICENSED_PROVIDERS = [
      { id: "sample-1", publisher: "Your licensor", name: "Sample Provider One", desc: "Movies and series up to 1080p", types: "movie | tv", version: "v1.0.0", sample: true },
      { id: "sample-2", publisher: "Your licensor", name: "Sample Provider Two", desc: "Documentaries and faith-based films", types: "movie", version: "v1.2.0", sample: true },
      { id: "sample-3", publisher: "Your licensor", name: "Sample Provider Three", desc: "TV series catalogue", types: "tv", version: "v0.9.1", sample: true }
    ];

    var lpChip = function (text, bg, fg) {
      var c = h("span", null, text);
      c.style.cssText = "display:inline-block;background:" + bg + ";color:" + fg + ";font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;";
      return c;
    };

    var lpWrap = h("div", "acard");
    lpWrap.appendChild(h("h3", null, "Licensed providers"));
    lpWrap.appendChild(h("p", null, "Providers you hold a license for. Only entries in your own list show up here."));

    var lpLabel = h("div", null, "PROVIDERS");
    lpLabel.style.cssText = "font-size:12px;font-weight:800;letter-spacing:.6px;color:#a1a1aa;margin:6px 2px 10px;";
    lpWrap.appendChild(lpLabel);

    LICENSED_PROVIDERS.forEach(function (p) {
      var row = h("div", null);
      row.style.cssText = "display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:14px;background:#18181b;border:1px solid #27272a;border-radius:16px;margin-bottom:12px;";

      var top = h("div", null);
      top.style.cssText = "display:flex;align-items:center;gap:12px;";

      var ico = h("div", null, (p.name || "?").charAt(0).toUpperCase());
      ico.style.cssText = "width:40px;height:40px;border-radius:12px;background:#14532d;color:#4ade80;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;flex:none;";
      top.appendChild(ico);

      var txt = h("div", null);
      var pub = h("div", null, p.publisher || "");
      pub.style.cssText = "font-size:12px;font-weight:700;color:#a1a1aa;";
      var nm = h("div", null, p.name || "Provider");
      nm.style.cssText = "font-size:18px;font-weight:800;line-height:1.2;";
      var ds = h("div", null, p.desc || "");
      ds.style.cssText = "font-size:13px;color:#d4d4d8;margin-top:2px;";
      txt.appendChild(pub);
      txt.appendChild(nm);
      txt.appendChild(ds);
      top.appendChild(txt);
      row.appendChild(top);

      var chips = h("div", null);
      chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
      if (p.types) chips.appendChild(lpChip(p.types, "#27272a", "#e4e4e7"));
      if (p.version) chips.appendChild(lpChip(p.version, "#27272a", "#e4e4e7"));
      chips.appendChild(lpChip(p.sample ? "Sample" : "Licensed", p.sample ? "#3f3f46" : "#14532d", p.sample ? "#d4d4d8" : "#4ade80"));
      row.appendChild(chips);

      var tb = h("button", "abtn", "Test Provider");
      tb.style.cssText = "width:100%;margin:2px 0 0;padding:12px 16px;border-radius:14px;";
      tb.onclick = function () {
        // Later: call your own test endpoint here, for example adm("/api/admin/licensed/test", { id: p.id })
        toast("Test for " + (p.name || "provider") + " is not connected yet");
      };
      row.appendChild(tb);

      lpWrap.appendChild(row);
    });

    if (!LICENSED_PROVIDERS.length) {
      lpWrap.appendChild(h("div", "note", "No licensed providers added yet."));
    }
    put("pl", lpWrap);
    // ===== end licensed providers =====
    }
    drawPl();


    showAdmTab();
    box.appendChild(h("div", "note center", "Only your account can see this panel."));
  }

  var yr = $("yr");
  if (yr) yr.textContent = String(new Date().getFullYear());
  $("fhandle").addEventListener("click", function (e) {
    if (tg && tg.openTelegramLink) { e.preventDefault(); try { tg.openTelegramLink(this.href); } catch (x) { openLink(this.href); } }
  });

  applyTheme();
  // ----- app updates: detect a new release and offer a one-tap Refresh -----
  var APP_VERSION = "@@VER@@";
  var upDismissed = "";
  function showUpdateBar(latest) {
    try { if (sessionStorage.getItem("boa_rl") === (latest || "x")) return; } catch (e) {}   // already reloaded for this release: never loop
    if (upDismissed === (latest || "x")) return;
    if ($("bsplash") || GATE_ON) { setTimeout(function () { showUpdateBar(latest); }, 2500); return; }
    var bar = $("upbar");
    if (!bar) {
      bar = h("div"); bar.id = "upbar";
      bar.appendChild(h("span", null, "A new version of Boa Cinema is ready"));
      var go = h("button", "upgo", "Refresh");
      var x = h("button", "upx", "×"); x.setAttribute("aria-label", "Dismiss");
      bar.appendChild(go); bar.appendChild(x);
      document.body.appendChild(bar);
      go.onclick = function () { applyUpdate(bar._v); };
      x.onclick = function () { upDismissed = bar._v || "x"; bar.className = ""; };
    }
    bar._v = latest || "x";
    bar.className = "on";
  }
  function applyUpdate(v) {
    try { sessionStorage.setItem("boa_rl", v || "x"); } catch (e) {}
    var done = function () { window.location.reload(); };
    try {
      if (window.caches) caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).then(done, done);
      else done();
    } catch (e) { done(); }
  }
  function checkVersion() {
    fetch("/api/version?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.v && j.v !== APP_VERSION) showUpdateBar(j.v);
    }).catch(function () {});
  }
  if ("serviceWorker" in navigator) {
    try {
      var hadCtl = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", function () { if (hadCtl) checkVersion(); hadCtl = true; });
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(function (reg) {
        reg.update().catch(function () {});
        document.addEventListener("visibilitychange", function () { if (!document.hidden) { reg.update().catch(function () {}); checkVersion(); } });
      }).catch(function () {});
    } catch (e) {}
  }
  setTimeout(checkVersion, 4000);
  profilesLoad();
  dataLoad();
  loadNotice();
  setInterval(loadNotice, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) loadNotice(); });
  checkOwner();
  paintNavAvatar();
  paintSeg();
  loadHome();
  if (!pendingQ && !pendingCat) restoreFromHash();
  window.__boaOpenGate = function () { GATE_ON = true; window.__boaGateOpen = true; openProfiles(false); };
  if (window.__boaGate === false) startNotices();
  api("/api/me", 0).then(function (r) {
    if (r && r.country) { myCC = String(r.country).toUpperCase(); if (tab === "me") renderMe(); }
  }).catch(function () {});
})();
</script>
</body>
</html>
`.split("@@VER@@").join(APP_VERSION);

function trailerPage(key, title) {
  if (!/^[\w-]{6,20}$/.test(key)) return new Response("Bad trailer id", { status: 400 });
  const t = esc(clip(title || "Trailer", 100));
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Trailer</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  html, body { margin: 0; background: #0b0b0f; color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  body { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  .player { position: relative; width: 100%; aspect-ratio: 16/9; background: #000; }
  .player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  h1 { font-size: 18px; margin: 14px 16px 4px; line-height: 1.25; }
  p { color: #a1a1aa; font-size: 13px; margin: 0 16px 14px; }
  .btn { display: inline-block; margin: 0 16px 12px; padding: 10px 16px; border-radius: 8px; background: #26262f; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
<div class="player">
  <iframe src="https://www.youtube-nocookie.com/embed/${key}?autoplay=1&playsinline=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</div>
<h1>${t}</h1>
<p>Trailer</p>
<a class="btn" id="yt" href="https://www.youtube.com/watch?v=${key}">Won't play? Open on YouTube</a>
<script>
(function(){
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    try { tg.ready(); tg.expand(); tg.setHeaderColor('#0b0b0f'); tg.setBackgroundColor('#0b0b0f'); } catch(e) {}
  }
  document.getElementById('yt').addEventListener('click', function(e) {
    if (tg && tg.openLink) {
      e.preventDefault();
      try { tg.openLink(this.href); } catch(x) { window.open(this.href, '_blank'); }
    }
  });
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate", pragma: "no-cache", expires: "0" },
  });
}

const ICON_192_B64 = "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";
const ICON_512_B64 = "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";
const b64bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

function siteAsset(pathname) {
  if (pathname === "/manifest.webmanifest") {
    return new Response(
      JSON.stringify({
        name: "Boa Cinema",
        short_name: "Boa Cinema",
        description: "Movies, series, trailers and what is coming soon, by Boa Entertainment.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      }),
      { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=86400" } }
    );
  }
  if (pathname === "/icon-192.png" || pathname === "/icon-512.png") {
    return new Response(b64bytes(pathname === "/icon-192.png" ? ICON_192_B64 : ICON_512_B64), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" },
    });
  }
  if (pathname === "/robots.txt") {
    return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n", { headers: { "content-type": "text/plain" } });
  }
  return null;
}

const APP_BY_BASE = new Map();
function appPage(env, url) {
  // The page always points stream relay / subtitle links at the Cloudflare Worker. On Cloudflare that is simply this request's address;
  // if the same code runs elsewhere (e.g. Render), set WORKER_URL there to your Worker address.
  let base = "";
  if (env && env.WORKER_URL && /^https:\/\/[^\s"'<>]+$/i.test(String(env.WORKER_URL))) base = String(env.WORKER_URL).replace(/\/+$/, "");
  else if (url && url.protocol === "https:") base = url.origin;
  let html = APP_BY_BASE.get(base);
  if (html === undefined) {
    html = APP_HTML.split("@@WBASE@@").join(base);
    APP_BY_BASE.clear();
    APP_BY_BASE.set(base, html);
  }
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate", pragma: "no-cache", expires: "0" },
  });
}

// ============================================================================
// 14b. API SAFETY AND SPEED: Telegram check + edge cache
// ============================================================================

// Checks Telegram's signed "initData" so only real Telegram Mini App sessions can use /api/*
async function verifyInitData(initData, token, maxAgeSeconds = 86400) {
  try {
    if (!initData || !token) return false;
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;
    params.delete("hash");
    const data = [...params.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const enc = new TextEncoder();
    const hmac = async (key, msg) =>
      crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
        msg
      );
    const secret = await hmac(enc.encode("WebAppData"), enc.encode(token));
    const sig = new Uint8Array(await hmac(secret, enc.encode(data)));
    const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ hash.charCodeAt(i);
    if (diff !== 0) return false;
    const age = Date.now() / 1000 - Number(params.get("auth_date") || 0);
    return age >= -60 && age < maxAgeSeconds;
  } catch (e) {
    return false;
  }
}

// How long (seconds) each kind of answer may be reused from Cloudflare's cache
const API_TTL = {
  "/api/rows": 60,
  "/api/row": 900,
  "/api/title": 1800,
  "/api/movie": 1800,
  "/api/season": 3600,
  "/api/logo": 86400,
  "/api/search": 300,
};

async function cachedApi(request, url, env, ctx) {
  const json = (data, status = 200, extra = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
    });

  // The visitor's country (from Cloudflare), used to highlight "available in your country"
  if (url.pathname === "/api/me") {
    try {
      const init = request.headers.get("x-tg-init") || "";
      if (init && env.BOT_TOKEN && (await verifyInitData(init, env.BOT_TOKEN))) {
        const uo = JSON.parse(new URLSearchParams(init).get("user") || "{}");
        if (uo && uo.id) await trackUser(env, uo.id);
      }
    } catch (e) {}
    return json({ country: (request.cf && request.cf.country) || "" });
  }

  if (url.pathname === "/api/version" || url.pathname === "/version.json") return new Response(JSON.stringify({ v: APP_VERSION }), { headers: { "content-type": "application/json", "cache-control": "no-cache, no-store, must-revalidate", "access-control-allow-origin": "*" } });
  if (url.pathname === "/api/relay") return relayHandle(request, url, env);
  if (url.pathname === "/api/sub") return subHandle(url, env);
  if (url.pathname === "/api/ratings") return ratingsHandle(url, env);

  if (REQUIRE_TELEGRAM) {
    const ok = await verifyInitData(request.headers.get("x-tg-init") || "", env.BOT_TOKEN);
    if (!ok) return json({ error: "open this from Telegram" }, 401);
  }

  let ttl = API_TTL[url.pathname];
  // Boa Picks change when you edit them in the Owner panel, so keep those answers fresh
  if (
    (url.pathname === "/api/row" && url.searchParams.get("name") === "upcoming_boa") ||
    (url.pathname === "/api/title" && /^c\d/.test(url.searchParams.get("id") || ""))
  ) {
    ttl = 60;
  }
  if (!ttl) return handleApi(url, env, request, ctx);

  const cache = caches.default;
  const key = new Request(url.toString(), { method: "GET" });
  try {
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set("x-boa-cache", "HIT");
      return r;
    }
  } catch (e) {}

  const res = await handleApi(url, env, request, ctx);
  if (res.status !== 200) return res;
  const out = new Response(res.body, res);
  out.headers.set("cache-control", `public, max-age=${Math.min(ttl, 300)}, s-maxage=${ttl}`);
  out.headers.set("x-boa-cache", "MISS");
  try {
    ctx.waitUntil(cache.put(key, out.clone()));
  } catch (e) {}
  return out;
}

// ============================================================================
// 14c. STREMIO-STYLE ADD-ON (catalog and details only, no streams)
// ============================================================================
// Install link for Stremio-style apps:  https://YOUR-WORKER-ADDRESS/manifest.json
// This add-on lists titles, posters, details and trailers. It never provides video streams or downloads.
// Titles use "boa-" ids (not IMDb ids), so other add-ons cannot attach streams to them.

const ADDON_CATALOGS = {
  movie: ["trending", "netflix", "netflix_new", "netflix_ng", "upcoming_boa", "upcoming", "nollywood", "faith", "kdrama", "bollywood", "hollywood", "anime", "toprated"],
  series: ["trending", "netflix", "netflix_orig", "netflix_ng", "upcoming", "nollywood", "kdrama", "faith", "anime", "bollywood", "toprated"],
};
const stType = (t) => (t === "series" ? "tv" : "movie");
const addonImg = (path, size) => (!path ? undefined : /^https?:/.test(path) ? path : `https://image.tmdb.org/t/p/${size}${path}`);

function addonManifest(origin) {
  const catalogs = [];
  for (const type of ["movie", "series"]) {
    const media = stType(type);
    for (const key of ADDON_CATALOGS[type]) {
      const def = ROW_DEFS[media][key];
      if (!def) continue;
      catalogs.push({ type, id: `boa-${key}`, name: def.title.replace(/^[^A-Za-z0-9]+/, ""), extra: [] });
    }
    catalogs.push({ type, id: "boa-search", name: "Boa Search", extra: [{ name: "search", isRequired: true }] });
  }
  return {
    id: "com.boaentertainment.cinema",
    version: "1.0.0",
    name: "Boa Cinema",
    description:
      "Movies and series by Boa Entertainment: Nollywood, Netflix picks, K-Drama, Faith, Coming Soon and more. Catalog, details and trailers only. No streams or downloads.",
    logo: `${origin}/icon-512.png`,
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    idPrefixes: ["boa-"],
    catalogs,
    behaviorHints: { configurable: false },
  };
}

function addonMetaFromSlim(m) {
  const type = m.mt === "tv" ? "series" : "movie";
  return {
    id: `boa-${m.mt === "tv" ? "t" : "m"}-${m.id}`,
    type,
    name: m.t,
    poster: addonImg(m.p, "w500"),
    posterShape: "poster",
    background: addonImg(m.b, "w780"),
    description: m.o || undefined,
    releaseInfo: m.y || (m.d ? m.d.slice(0, 4) : undefined),
    imdbRating: m.r || undefined,
    genres: m.g ? [m.g] : undefined,
  };
}

async function addonMeta(env, type, rawId) {
  const media = stType(type);
  const mm = /^boa-([mt])-(c?\d{1,9})$/.exec(rawId);
  if (!mm) return null;
  const idPart = mm[2];
  let t;
  const cm = /^c(\d{1,2})$/.exec(idPart);
  if (cm) t = curatedTitle(await getPicks(env), +cm[1]);
  else t = await getTitleApi(env, media, idPart);
  if (!t) return null;
  const where = (t.wp || [])
    .filter((x) => x.k === "stream" && x.c.includes(DEFAULT_REGION))
    .map((x) => x.n)
    .slice(0, 6);
  const lines = [t.o || ""];
  if (t.d && t.d > new Date().toISOString().slice(0, 10)) lines.push(`Release date: ${t.d}`);
  if (where.length) lines.push(`Streaming on: ${where.join(", ")} (${DEFAULT_REGION})`);
  lines.push("Details and trailer only. Boa Cinema does not host or stream media.");
  return {
    id: rawId,
    type,
    name: t.t,
    poster: addonImg(t.p, "w500"),
    posterShape: "poster",
    background: addonImg(t.b, "w1280"),
    logo: addonImg(t.lg, "w500"),
    description: lines.filter(Boolean).join("\n\n"),
    releaseInfo: t.ri || t.y || undefined,
    runtime: t.rt ? `${t.rt} min` : undefined,
    imdbRating: t.r || undefined,
    genres: t.g && t.g.length ? t.g : undefined,
    cast: (t.cast || []).map((c) => c.n).slice(0, 8),
    director: type === "movie" && t.by && t.by.length ? t.by : undefined,
    trailers: t.trailer ? [{ source: t.trailer, type: "Trailer" }] : [],
    country: t.oc || undefined,
  };
}

async function addonCatalog(env, type, catId, extraStr) {
  const media = stType(type);
  const extra = {};
  for (const part of (extraStr || "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = i < 0 ? part : part.slice(0, i);
    let v = i < 0 ? "" : part.slice(i + 1);
    try {
      v = decodeURIComponent(v);
    } catch (e) {}
    extra[k] = v;
  }
  if (catId === "boa-search") {
    const q = (extra.search || "").trim().slice(0, 100);
    if (q.length < 2) return { metas: [] };
    const data = await tmdb(env, "/search/multi", `include_adult=false&query=${encodeURIComponent(q)}`);
    const found = (data.results || []).filter((r) => r.media_type === media);
    return { metas: slimList(found).map(addonMetaFromSlim) };
  }
  const key = catId.replace(/^boa-/, "");
  if (!ADDON_CATALOGS[type] || !ADDON_CATALOGS[type].includes(key)) return null;
  const rows = await getRow(env, media, key);
  if (!rows) return null;
  // Each row is one page (up to 20 titles); later pages are empty so Stremio stops asking
  if ((parseInt(extra.skip, 10) || 0) > 0) return { metas: [] };
  return { metas: rows.map(addonMetaFromSlim) };
}

function addonLanding(origin) {
  const host = origin.replace(/^https?:\/\//, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0a0a"><title>Boa Cinema add-on</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:28px 18px 60px;display:flex;justify-content:center}
main{width:100%;max-width:520px}img{width:84px;height:84px;border-radius:20px}h1{font-size:30px;margin:16px 0 8px;letter-spacing:-.5px}p{color:#b4b4ba;line-height:1.55;font-size:16px}
.btn{display:block;width:100%;text-align:center;border:0;border-radius:999px;padding:15px;font-size:17px;font-weight:700;margin:12px 0;text-decoration:none;cursor:pointer}
.main{background:#fff;color:#000}.alt{background:#1b1b1d;color:#fff}code{display:block;background:#161618;border-radius:12px;padding:12px 14px;word-break:break-all;color:#e4e4e7;font-size:14px;margin:12px 0}
ol{color:#b4b4ba;line-height:1.7;font-size:16px;padding-left:20px}small{display:block;color:#7b7b82;line-height:1.5;margin-top:26px}
</style></head><body><main>
<img src="/icon-512.png" alt="">
<h1>Boa Cinema add-on</h1>
<p>Browse Boa's catalog inside Stremio-style apps: Nollywood, Netflix picks, K-Drama, Faith, Coming Soon and more, with posters, details and trailers.</p>
<a class="btn main" href="stremio://${host}/manifest.json">Install in Stremio</a>
<button class="btn alt" id="cp">Copy add-on link</button>
<code id="u">${origin}/manifest.json</code>
<ol><li>Tap <b>Install in Stremio</b>, or copy the link.</li><li>In your app open <b>Add-ons</b>, paste the link and install.</li><li>Open Discover and pick a Boa catalog.</li></ol>
<small>Catalog, details and trailers only. Boa Entertainment does not host, stream or download any media. Movie data and images by TMDB. Streaming availability by JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB. Netflix is a trademark of Netflix, Inc. and Boa Entertainment is not affiliated with it. &copy; Boa Entertainment. All rights reserved.</small>
<script>
document.getElementById("cp").onclick=function(){var t=document.getElementById("u").textContent,b=this;
function ok(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy add-on link"},1800)}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,function(){})}else{var r=document.createRange();r.selectNode(document.getElementById("u"));getSelection().removeAllRanges();getSelection().addRange(r);try{document.execCommand("copy");ok()}catch(e){}}};
</script></main></body></html>`;
}

const ADDON_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

// Returns a Response for add-on URLs, or null when the URL is not an add-on URL
async function addonRoute(request, url, env, ctx) {
  const path = url.pathname;
  const json = (data, status = 200, maxAge = 0) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...ADDON_CORS,
        "content-type": "application/json; charset=utf-8",
        "cache-control": status === 200 && maxAge ? `public, max-age=300, s-maxage=${maxAge}` : "no-store",
      },
    });
  if (path === "/addon") {
    return new Response(addonLanding(url.origin), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }
  if (path === "/manifest.json") return json(addonManifest(url.origin), 200, 600);

  const m = /^\/(catalog|meta)\/(movie|series)\/([^/]+?)(?:\/(.*))?\.json$/.exec(path);
  if (!m) return null;
  const [, kind, type, id, extra] = m;
  let cache = null;
  let key = null;
  try {
    cache = caches.default;
    key = new Request(url.toString(), { method: "GET" });
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      Object.entries(ADDON_CORS).forEach(([k, v]) => r.headers.set(k, v));
      return r;
    }
  } catch (e) {}
  try {
    let body;
    let ttl = 900;
    if (kind === "catalog") {
      body = await addonCatalog(env, type, decodeURIComponent(id), extra);
      if (id === "boa-search") ttl = 120;
    } else {
      const meta = await addonMeta(env, type, decodeURIComponent(id));
      body = meta ? { meta } : null;
      ttl = 3600;
    }
    if (!body) return json({ metas: [], meta: null }, 404);
    const res = json(body, 200, ttl);
    try {
      if (cache) ctx.waitUntil(cache.put(key, res.clone()));
    } catch (e) {}
    return res;
  } catch (e) {
    return json({ metas: [], meta: null, error: "upstream" }, 502);
  }
}

// ============================================================================
// 14d. OWNER PANEL (only the account in OWNER_ID can open it; verified by Telegram's signed data)
// ============================================================================
const ownerIds = (env) => String(env.OWNER_ID || "").split(/[\s,]+/).filter(Boolean);

function tgUserId(initData) {
  try {
    const u = JSON.parse(new URLSearchParams(initData).get("user") || "{}");
    return u && u.id ? String(u.id) : "";
  } catch (e) {
    return "";
  }
}

async function ownerCheck(request, env) {
  const init = request.headers.get("x-tg-init") || "";
 if (init === "local-dev") {
  return env.ALLOW_LOCAL_DEV === "1" ? { ok: true, status: 200 } : { ok: false, status: 401 };
}
  if (!(await verifyInitData(init, env.BOT_TOKEN))) return { ok: false, status: 401 };
  const id = tgUserId(init);
  return { ok: !!id && ownerIds(env).includes(id), status: 403 };
}

// Boa Picks: your saved list (from the Owner panel) or the BOA_PICKS defaults at the top of this file
async function getPicks(env) {
  if (env.BOT_USERS) {
    try {
      const raw = await env.BOT_USERS.get("cfg:picks");
      if (raw) {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) return a;
      }
    } catch (e) {}
  }
  return BOA_PICKS;
}

const ytId = (v) => {
  const t = String(v || "").trim();
  const m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{6,20})/.exec(t);
  if (m) return m[1];
  return /^[\w-]{6,20}$/.test(t) ? t : "";
};

function cleanPick(p) {
  p = p || {};
  const title = String(p.title || "").trim().slice(0, 80);
  if (!title) return null;
  const poster = String(p.poster || "").trim();
  return {
    title,
    media: p.media === "tv" ? "tv" : "movie",
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || "")) ? p.date : "",
    poster: /^https:\/\/[^\s"'<>]{4,300}$/.test(poster) ? poster : "",
    note: String(p.note || "").trim().slice(0, 300),
    trailer: ytId(p.trailer),
  };
}

// ---------- Catalog add-ons (owner installs Stremio-style add-on links; only their catalogs are used) ----------
const fnv = (str) => {
  let hsh = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hsh ^= str.charCodeAt(i);
    hsh = Math.imul(hsh, 16777619);
  }
  return (hsh >>> 0).toString(36);
};

// ---- Priority notices (Notice Manager). KV is written ONLY by /api/admin/notices; reads go through the cached KV wrapper. ----
const NOTICE_MAX = 20;
function cleanNotice(n, keep) {
  n = n || {};
  const title = String(n.title || "").trim().slice(0, 80);
  const body = String(n.body || "").trim().slice(0, 1500);
  if (!title && !body) return null;
  const pri = Math.max(0, Math.min(2, parseInt(n.pri, 10) || 0));
  const order = Math.max(0, Math.min(999, parseInt(n.order, 10) || 0));
  const id = String(n.id || "").replace(/[^\w-]/g, "").slice(0, 24) || "n" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  return { id, title, body, pri, order, on: n.on !== false, ts: keep && keep.ts && keep.title === title && keep.body === body && keep.pri === pri ? keep.ts : Date.now() };
}
async function getNotices(env) {
  if (!env.BOT_USERS) return [];
  try {
    const a = JSON.parse((await env.BOT_USERS.get("cfg:notices")) || "[]");
    return (Array.isArray(a) ? a : []).map((x) => cleanNotice(x, x)).filter(Boolean).slice(0, NOTICE_MAX);
  } catch (e) {
    return [];
  }
}
function sortNotices(list) {
  return list.slice().sort((a, b) => b.pri - a.pri || a.order - b.order || a.ts - b.ts);
}
async function getAddons(env) {
  if (!env.BOT_USERS) return [];
  try {
    const raw = await env.BOT_USERS.get("cfg:addons");
    const a = raw ? JSON.parse(raw) : [];
    return (Array.isArray(a) ? a : []).map((x) => ({
      ...x,
      id: x.id || fnv(String(x.base || x.url || x.transportUrl || x.name || "")),
    }));
  } catch (e) {
    return [];
  }
}

// "stremio://host/..." or "https://host/.../manifest.json"  ->  "https://host/..." (no trailing slash)
function addonBase(input) {
  const u = String(input || "").trim().replace(/^stremio:\/\//i, "https://");
  if (!/^https:\/\/[^\s"'<>]{4,400}$/i.test(u)) return null;
  let host = "";
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
  if (!host.includes(".") || /^[\d.]+$/.test(host) || /\.(local|internal|localhost)$/.test(host)) return null;
  return u.replace(/\/manifest\.json.*$/i, "").replace(/\/+$/, "");
}

// Reads the add-on's manifest and returns ONLY what Boa Cinema uses: its movie/series catalogs.
async function inspectAddon(base) {
  const res = await fetch(`${base}/manifest.json`, {
    headers: { "User-Agent": "BoaCinema/1.0", accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Couldn't open that manifest (${res.status})`);
  const text = await res.text();
  if (text.length > 1500000) throw new Error("That manifest is too large");
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new Error("That link isn't an add-on manifest");
  }
  const needsExtra = (c) =>
    (Array.isArray(c.extra) && c.extra.some((x) => x && x.isRequired)) ||
    (Array.isArray(c.extraRequired) && c.extraRequired.length > 0);
  const seen = new Set();
  const cats = [];
  let skipped = 0;
  for (const c of Array.isArray(m.catalogs) ? m.catalogs : []) {
    if (!c || (c.type !== "movie" && c.type !== "series") || !c.id) continue;
    if (needsExtra(c)) {
      skipped++;
      continue;
    }
    const id = String(c.id).slice(0, 60);
    const key = `${c.type}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cats.push({ type: c.type, id, name: String(c.name || id).slice(0, 60) });
  }
  const resNames = (Array.isArray(m.resources) ? m.resources : []).map((r) => (typeof r === "string" ? r : r && r.name));
  return {
    name: String(m.name || "Add-on").slice(0, 60),
    description: String(m.description || "").slice(0, 300),
    version: String(m.version || "").slice(0, 20),
    base,
    cats,
    skipped,
    hasStreams: resNames.includes("stream"),
    hasSubs: resNames.includes("subtitles"),
    resources: resNames.filter((x) => typeof x === "string").slice(0, 10),
  };
}

const catName = (c) => String((c && (c.name || c.id)) || "Catalog").replace(/[._-]+/g, " ").trim();

const importedRowList = async (env, media) => {
  const out = [];
  for (const a of await getAddons(env)) {
    if (a.enabled === false || !a.base) continue;
    for (const c of a.cats || []) {
      if (stType(c.type) === media) out.push({ key: c.k, title: `${a.name}: ${catName(c)}`.slice(0, 60) });
    }
  }
  return out;
};

// One imported row: reads the add-on's catalog, then matches every title to TMDB for posters and details.
async function importedRow(env, media, key) {
  for (const a of await getAddons(env)) {
    if (a.enabled === false || !a.base) continue;
    for (const c of a.cats || []) {
      if (c.k !== key || stType(c.type) !== media) continue;
      const res = await fetch(`${a.base}/catalog/${c.type}/${encodeURIComponent(c.id)}.json`, {
        headers: { "User-Agent": "BoaCinema/1.0", accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error("catalog " + res.status);
      const j = await res.json();
      const metas = (Array.isArray(j.metas) ? j.metas : []).slice(0, 20);
      const items = await Promise.all(
        metas.map(async (m) => {
          const id = String((m && m.id) || "");
          try {
            if (/^tt\d{5,12}$/.test(id)) {
              const f = await tmdb(env, `/find/${id}`, "external_source=imdb_id");
              return ((media === "tv" ? f.tv_results : f.movie_results) || [])[0] || null;
            }
            const t = /^tmdb:(\d{1,9})$/.exec(id);
            if (t) return await tmdb(env, `/${MEDIA[media].path}/${t[1]}`, "");
            const nm = String((m && m.name) || "").trim();
            if (nm) {
              const yr = String((m && (m.year || m.releaseInfo)) || "").slice(0, 4);
              const q =
                `include_adult=false&query=${encodeURIComponent(nm)}` +
                (/^\d{4}$/.test(yr) ? (media === "tv" ? "&first_air_date_year=" : "&year=") + yr : "");
              const f = await tmdb(env, `/search/${MEDIA[media].path}`, q);
              return (f.results || [])[0] || null;
            }
          } catch (e) {}
          return null;
        })
      );
      const seen = new Set();
      const uniq = items.filter((x) => x && !seen.has(x.id) && seen.add(x.id));
      return slimList(uniq, media);
    }
  }
  return null;
}

async function adminRoute(request, url, env) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  const path = url.pathname;
  const who = await ownerCheck(request, env);
  if (path === "/api/admin/me") return json({ owner: !!who.ok });
  if (!who.ok) return json({ error: "owner only" }, who.status);
  const isPost = request.method === "POST";

  try {
    if ((path === "/api/admin/metrics" || path === "/api/admin/analytics") && !isPost) return json(await analyticsStats(env));
    if (path === "/api/admin/state" && !isPost) {
      let notice = "";
      let homeMode = "builtin";
      let noticePri = false;
      try { if (env.BOT_USERS) noticePri = (await env.BOT_USERS.get("cfg:notice_pri")) === "1"; } catch (e) {}
      const stats = await analyticsStats(env);
      const adsCfg = await getAds(env);
      try { if (env.BOT_USERS) homeMode = (await env.BOT_USERS.get("cfg:homemode")) || "builtin"; } catch (e) {}
      let custom = false;
      let mediaServer = null;
      if (env.BOT_USERS) {
        notice = (await env.BOT_USERS.get("cfg:notice")) || "";
        custom = (await env.BOT_USERS.get("cfg:picks")) !== null;
        const msRaw = await env.BOT_USERS.get("cfg:media_server");
        if (msRaw) try { mediaServer = JSON.parse(msRaw); } catch (e) {}
      }
      return json({
        picks: await getPicks(env),
        custom,
        notice,
        active: await activeUsers(env, true),
        kv: !!env.BOT_USERS,
        addons: await getAddons(env),
        notices: await getNotices(env),
        homeMode,
        noticePri,
        stats,
        ads: adsCfg,
        integ: integView(await getIntegrations(env)),
        kvDown: Date.now() < kvBad,
        mediaServer,
        plugins: await getPluginRepos(env),
      });
    }
    if (path === "/api/admin/providers" && !isPost) {
      return json(await providersPayload(env, url.searchParams.get("fresh") === "1"));
    }
    if (!isPost) return json({ error: "not found" }, 404);
    if (!env.BOT_USERS) return json({ error: "Storage isn't connected (BOT_USERS)" }, 503);
    let body = {};
    try {
      body = (await request.json()) || {};
    } catch (e) {}
    if (typeof body !== "object" || Array.isArray(body)) body = {};

    if (path === "/api/admin/media-server") {
      const serverUrl = String(body.url || "").trim();
      const apiKey = String(body.apiKey || "").trim();
      const name = String(body.name || "Media Server").trim();
      if (!serverUrl) {
        await env.BOT_USERS.delete("cfg:media_server");
        return json({ mediaServer: null });
      }
      const data = { name, url: serverUrl, apiKey };
      await env.BOT_USERS.put("cfg:media_server", JSON.stringify(data));
      return json({ mediaServer: data });
    }
    if (path === "/api/admin/test-provider") {
      const o = {
        url: String(body.url || "").trim(),
        type: body.type === "tv" ? "tv" : "movie",
        id: String(body.id || "").replace(/\D/g, "").slice(0, 9) || (body.type === "tv" ? "1399" : "550"),
        s: Number(body.s) || 1,
        e: Number(body.e) || 1,
        kind: body.kind === "stremio" ? "stremio" : "",
      };
      if (!/^https:\/\//i.test(o.url)) return json({ ok: false, error: "This provider has no script link to test." });
      if (env.STREAM_BACKEND) {
        try {
          const r = await fetch(
            env.STREAM_BACKEND.replace(/\/+$/, "") + "/api/plugin-test?u=" + encodeURIComponent(o.url) +
              "&type=" + o.type + "&id=" + o.id + "&s=" + o.s + "&e=" + o.e + (o.kind ? "&kind=" + o.kind : ""),
            { headers: { "x-stream-key": env.STREAM_KEY || "" }, signal: AbortSignal.timeout(Number(env.BACKEND_TIMEOUT_MS) || 45000) }
          );
          return json(await r.json());
        } catch (err) {
          return json({ ok: false, error: "Couldn't reach your stream server: " + ((err && err.message) || "no answer") });
        }
      }
      return json(await testScraper(env, o));
    }
    if (path === "/api/admin/plugins") {
      let plugins = await getPluginRepos(env);
      const act = body.action;
      if (act === "remove") {
        const id = String(body.id || "");
        plugins = plugins.filter((p) => p.id !== id);
      } else if (act === "add") {
        const pUrl = String(body.url || "").trim();
        const force = !!body.force;
        if (!/^https:\/\/[^\s"'<>]{4,400}$/i.test(pUrl)) return json({ error: "Paste the full https link of the manifest.json" }, 400);
        const given = String(body.name || "").trim().slice(0, 60);
        let m = null, why = "";
        try { m = await loadManifest(pUrl, 10000, true); } catch (e) { why = (e && e.message) || "no answer"; }
        let host = "";
        try { host = new URL(pUrl).hostname; } catch (e) {}
        let entry;
        if (m && hasScrapers(m, pUrl)) {
          entry = { id: "pl_" + fnv(pUrl), name: given || String(m.name || host || "Plugin").slice(0, 60), url: pUrl, kind: "nuvio", enabled: true, forced: force && undefined };
        } else if (m && looksStremio(m) && stremioHasStream(m)) {
          entry = { id: "pl_" + fnv(pUrl), name: given || String(m.name).slice(0, 60), url: pUrl, kind: "stremio", base: manifestBase(pUrl), version: String(m.version || "").slice(0, 20), enabled: true };
        } else if (force) {
          if (!m) {
            // not JSON: accept it if the base address answers at all
            let ok = false;
            try { const r0 = await fetch(manifestBase(pUrl) || pUrl, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "BoaCinema/1.0" } }); ok = r0.status < 500; } catch (e) {}
            if (!ok) return json({ error: "Force install needs a link that returns JSON or a reachable address (" + why + ")" }, 400);
          }
          entry = { id: "pl_" + fnv(pUrl), name: given || String((m && m.name) || host || "Custom plugin").slice(0, 60), url: pUrl, kind: "stremio", base: manifestBase(pUrl), version: String((m && m.version) || "").slice(0, 20), enabled: true, forced: true };
        } else if (!m) {
          return json({ error: "Couldn't open that link (" + why + "). Check it, or tick Force Install." }, 400);
        } else if (looksStremio(m)) {
          return json({ error: "This add-on has no streams (it offers " + ((m.resources || []).map((x) => (typeof x === "string" ? x : x && x.name)).join(", ") || "other things") + "). Install it from the Add-ons tab, or tick Force Install." }, 400);
        } else {
          return json({ error: "Unrecognised manifest format. Tick Force Install to save it anyway." }, 400);
        }
        if (entry.forced === undefined) delete entry.forced;
        plugins = plugins.filter((x) => x.url !== pUrl);
        plugins.push(entry);
      } else if (act === "disable") {
        const id = String(body.id || "");
        plugins = plugins.map((p) => {
          if (p.id !== id) return p;
          const set = new Set((p.disabled || []).map(String));
          set.add(String(body.provider || ""));
          return { ...p, disabled: [...set] };
        });
      } else if (act === "restore") {
        const id = String(body.id || "");
        plugins = plugins.map((p) => (!id || p.id === id ? { ...p, disabled: [] } : p));
      } else {
        return json({ error: "bad action" }, 400);
      }
      await env.BOT_USERS.put("cfg:plugins", JSON.stringify(plugins));
      MANIFEST_CACHE.clear();
      SCRIPT_CACHE.clear();
      STREAM_CACHE.clear();
      STREAM_EPOCH++;              // new lookups skip older cached lists; lookups already running are not touched
      return json({ plugins });
    }
    if (path === "/api/admin/picks") {
      if (body.reset) {
        await env.BOT_USERS.delete("cfg:picks");
        await bustPicks(url);
        return json({ picks: BOA_PICKS, custom: false });
      }
      if (!Array.isArray(body.picks) || body.picks.length > 30) return json({ error: "bad list" }, 400);
      const list = body.picks.map(cleanPick).filter(Boolean);
      await env.BOT_USERS.put("cfg:picks", JSON.stringify(list));
      await bustPicks(url);
      return json({ picks: list, custom: true });
    }
    if (path === "/api/admin/ads") {
      if (!env.BOT_USERS) return json({ error: "Storage isn't connected" }, 400);
      const c = cleanAds(body || {});
      if (!c) return json({ error: "Ad tag links must be full https:// URLs" }, 400);
      if (c.on && !c.tag) return json({ error: "Paste a VAST tag URL before turning ads on" }, 400);
      await env.BOT_USERS.put("cfg:ads", JSON.stringify(c));
      return json({ ads: c });
    }
    if (path === "/api/admin/integrations") {
      if (!env.BOT_USERS) return json({ error: "Storage isn't connected" }, 400);
      let next;
      try { next = integApply(await getIntegrations(env), body || {}); } catch (e) { return json({ error: String((e && e.message) || e) }, 400); }
      await env.BOT_USERS.put("cfg:integrations", JSON.stringify(next));
      integCache = next; integAt = Date.now();
      return json({ integ: integView(next) });
    }
    if (path === "/api/admin/ads-test") {
      const tag = String((body && body.tag) || "").trim();
      if (!/^https:\/\//i.test(tag)) return json({ ok: false, error: "Paste an https VAST tag URL first" });
      try {
        const ad = await fetchVast(tag, request, 0);
        return json({ ok: true, seconds: Math.round(ad.duration), type: ad.type, impressions: ad.imp.length, events: Object.keys(ad.trk), clickable: !!ad.click, media: ad.media.slice(0, 80) });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e).slice(0, 160) }); }
    }
    if (path === "/api/admin/homemode") {
      if (!env.BOT_USERS) return json({ error: "Storage isn't connected" }, 400);
      const m = body && body.mode === "addons" ? "addons" : "builtin";
      await env.BOT_USERS.put("cfg:homemode", m);
      try { bustRows(url); } catch (e) {}
      return json({ homeMode: m });
    }
    if (path === "/api/admin/addon-inspect") {
      const base = addonBase(body.url || body.base);
      if (!base) return json({ error: "Paste a full https add-on link" }, 400);
      try {
        return json(await inspectAddon(base));
      } catch (e) {
        return json({ error: e && e.message ? e.message : "Couldn't read that add-on" }, 400);
      }
    }
    if (path === "/api/admin/addon-preview") {
      const base = addonBase(body.base);
      if (!base || !/^[a-z]{2,20}$/i.test(String(body.type || ""))) return json({ error: "Bad request" }, 400);
      try {
        const res = await fetch(
          `${base}/catalog/${encodeURIComponent(body.type)}/${encodeURIComponent(String(body.id || ""))}.json`,
          { headers: { "User-Agent": "BoaCinema/1.0", accept: "application/json" }, signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) throw new Error("That catalog answered " + res.status);
        const j = await res.json();
        const metas = Array.isArray(j.metas) ? j.metas : [];
        return json({
          total: metas.length,
          items: metas.slice(0, 12).map((m) => ({
            name: String((m && (m.name || m.id)) || "").slice(0, 60),
            year: String((m && (m.year || m.releaseInfo)) || "").slice(0, 9),
            poster: /^https:\/\//.test((m && m.poster) || "") ? m.poster : "",
          })),
        });
      } catch (e) {
        return json({ error: e && e.message ? e.message : "Couldn't read that catalog" }, 400);
      }
    }
    if (path === "/api/admin/addons") {
      let list = await getAddons(env);
      const act = body.action;
      let extra = {};
      if (act === "remove") {
        const id = String(body.id || "");
        const base = body.base ? addonBase(body.base) : null;
        list = list.filter((a) => !((id && a.id === id) || (base && a.base === base)));
      } else if (act === "toggle") {
        list = list.map((a) => (a.id === String(body.id || "") ? { ...a, enabled: body.enabled !== false } : a));
      } else if (act === "add" || act === "update") {
        const found = list.find((a) => a.id === String(body.id || ""));
        const base = addonBase(body.base || (found && found.base));
        if (!base) return json({ error: "Bad add-on link" }, 400);
        let info;
        try {
          info = await inspectAddon(base);
        } catch (e) {
          return json({ error: e && e.message ? e.message : "Couldn't read that add-on" }, 400);
        }
        const wanted = new Set((Array.isArray(body.cats) ? body.cats : []).map((c) => `${c && c.type}|${c && c.id}`));
        const cats = info.cats
          .filter((c) => wanted.has(`${c.type}|${c.id}`))
          .map((c) => ({ type: c.type, id: c.id, name: c.name, k: "x" + fnv(`${base}|${c.type}|${c.id}`) }));
        const isSubs = !!body.subs && !!info.hasSubs;
        if (!cats.length && !isSubs) return json({ error: "Pick at least one catalog" }, 400);
        const i = list.findIndex((a) => a.base === base);
        const prev = i > -1 ? list[i] : null;
        const entry = {
          id: fnv(base),
          name: info.name,
          base,
          version: info.version,
          description: info.description,
          cats,
          subs: isSubs || undefined,
          enabled: prev ? prev.enabled !== false : true,
          addedAt: (prev && prev.addedAt) || Date.now(),
        };
        if (i > -1) list[i] = entry;
        else list.push(entry);
      } else if (act === "refresh") {
        const i = list.findIndex((a) => a.id === String(body.id || ""));
        const a = list[i];
        if (!a || !a.base) return json({ error: "This entry isn't a catalog add-on, so it can't be refreshed. Delete it." }, 400);
        let info;
        try {
          info = await inspectAddon(a.base);
        } catch (e) {
          return json({ error: e && e.message ? e.message : "Couldn't read that add-on" }, 400);
        }
        const have = new Map(info.cats.map((c) => [`${c.type}|${c.id}`, c]));
        const kept = (a.cats || [])
          .filter((c) => have.has(`${c.type}|${c.id}`))
          .map((c) => ({ ...c, name: have.get(`${c.type}|${c.id}`).name }));
        list[i] = { ...a, name: info.name, version: info.version, description: info.description, cats: kept };
        extra = { total: info.cats.length, kept: kept.length, dropped: (a.cats || []).length - kept.length };
      } else {
        return json({ error: "bad action" }, 400);
      }
      await env.BOT_USERS.put("cfg:addons", JSON.stringify(list));
      await bustRows(url);
      return json({ addons: list, ...extra });
    }
    if (path === "/api/admin/notices") {
      let list = await getNotices(env);
      const act = body.action;
      if (act === "save") {
        const inc = body.notice || {};
        const old = list.find((x) => x.id === inc.id);
        const c = cleanNotice(inc, old);
        if (!c) return json({ error: "Add a title or some text first" }, 400);
        if (old) list = list.map((x) => (x.id === c.id ? c : x));
        else if (list.length >= NOTICE_MAX) return json({ error: "Limit reached: at most " + NOTICE_MAX + " notices. Delete one first." }, 400);
        else list.push(c);
      } else if (act === "toggle") {
        const t = list.find((x) => x.id === String(body.id || ""));
        if (!t) return json({ error: "Notice not found" }, 404);
        t.on = !t.on;
        t.ts = Date.now();
      } else if (act === "delete") {
        list = list.filter((x) => x.id !== String(body.id || ""));
      } else {
        return json({ error: "bad action" }, 400);
      }
      if (list.length) await env.BOT_USERS.put("cfg:notices", JSON.stringify(list));
      else await env.BOT_USERS.delete("cfg:notices");
      return json({ notices: list });
    }
    if (path === "/api/admin/notice") {
      const text = String(body.text || "").trim().slice(0, 200);
      const pri = !!body.priority && !!text;
      if (text) await env.BOT_USERS.put("cfg:notice", text);
      else await env.BOT_USERS.delete("cfg:notice");
      if (pri) await env.BOT_USERS.put("cfg:notice_pri", "1");
      else await env.BOT_USERS.delete("cfg:notice_pri");
      return json({ notice: text, priority: pri });
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof KvLimit) return json({ error: e.message, kv: true }, 429);
    const m = String((e && e.message) || e);
    if (/429|too many|rate.?limit|quota|exceed|kv (get|put|delete|list)/i.test(m)) return json({ error: KV_MSG, kv: true }, 429);
    return json({ error: "Something went wrong on the server. Nothing was changed. Please try again in a moment." }, 500);
  }
}

// ============================================================================
// KV GUARD: streaming must never fail because Cloudflare KV is rate-limited or down.
//  - reads: short in-memory cache (30s); errors/429 -> cached value or null
//  - writes: swallowed on public routes, reported as a clear message on admin routes
//  - circuit breaker: after a 429/limit error KV is skipped for 60s instead of being hammered
// ============================================================================
class KvLimit extends Error {}
const KV_MSG = "Cloudflare KV is rate-limited or its daily write limit is reached (resets at 00:00 UTC). Your change was not saved. Wait a minute, or until the reset, and try again.";
let kvBad = 0;
const kvRead = new Map();            // key -> { at, t: text|null }   (max 120 small entries)
const kvGuards = new WeakMap();
function kvTrip(e) { if (/429|limit|too many|rate|exceed|quota/i.test(String((e && e.message) || e))) kvBad = Date.now() + 60000; }
function kvEnv(env, strict) {
  const raw = env && env.BOT_USERS;
  if (!raw) return env;
  let g = kvGuards.get(raw);
  if (!g) { g = {}; kvGuards.set(raw, g); }
  const k = strict ? "s" : "o";
  if (!g[k]) {
    g[k] = {
      async get(key, opts) {
        const tk = typeof opts === "string" ? opts : (opts && opts.type) || "text";
        if (tk !== "text" && tk !== "json") { try { return await raw.get(key, opts); } catch (e) { kvTrip(e); return null; } }
        const now = Date.now(), c = kvRead.get(key);
        let t;
        if (c && now - c.at < 300000) t = c.t;       // config reads: 5-minute memory cache (admin saves refresh it)
        else if (now < kvBad) t = c ? c.t : null;
        else {
          try {
            t = await raw.get(key);
            if (t == null || t.length < 150000) capSet(kvRead, key, { at: now, t }, 120);
          } catch (e) { kvTrip(e); t = c ? c.t : null; }
        }
        if (tk === "json") { try { return t == null ? null : JSON.parse(t); } catch (e) { return null; } }
        return t;
      },
      async list(opts) {
        if (Date.now() < kvBad) return { keys: [], list_complete: true };
        try { return await raw.list(opts); } catch (e) { kvTrip(e); return { keys: [], list_complete: true }; }
      },
      async put(key, val, opts) {
        if (!strict && !(env.ANALYTICS_KV === "1" && /^(s|d|v|m|u):|^agg$|^cfg:lastvisit$/.test(key))) return;   // public routes never write
        if (Date.now() < kvBad) { if (strict) throw new KvLimit(KV_MSG); return; }
        try {
          await raw.put(key, val, opts);
          if (typeof val === "string" && val.length < 150000) capSet(kvRead, key, { at: Date.now(), t: val }, 120); else kvRead.delete(key);
        } catch (e) {
          kvTrip(e);
          if (strict) throw new KvLimit(Date.now() < kvBad ? KV_MSG : "Could not save to Cloudflare KV right now: " + String((e && e.message) || e).slice(0, 120));
        }
      },
      async delete(key) {
        if (!strict && !(env.ANALYTICS_KV === "1" && /^(s|d|v|m|u):/.test(key))) return;                        // public routes never delete
        kvRead.delete(key);
        if (Date.now() < kvBad) { if (strict) throw new KvLimit(KV_MSG); return; }
        try { await raw.delete(key); }
        catch (e) { kvTrip(e); if (strict) throw new KvLimit(Date.now() < kvBad ? KV_MSG : "Could not update Cloudflare KV right now: " + String((e && e.message) || e).slice(0, 120)); }
      },
    };
  }
  const e2 = Object.create(env);
  Object.defineProperty(e2, "BOT_USERS", { value: g[k], enumerable: true });
  return e2;
}

// ============================================================================
// 15. WORKER ENTRY POINT
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/relay") return relayHandle(request, url, env);   // heavy stream proxy: handled first, no KV, no metadata work
    if (url.pathname === "/api/probe") return probeHandle(url, env);
    if (url.pathname === "/api/size") return sizeHandle(url, env);
    env = kvEnv(env, url.pathname.startsWith("/api/admin/"));
    // The Mini App and trailer player must open from this Worker's own https address
    if (url.protocol === "https:") {
      ORIGIN = url.origin;
      APP_URL = `${url.origin}/app`;
    }
    // Set APP_BASE_URL (Worker variable) to https://boa-cinema.onrender.com so bot buttons open the Render site
    // (Off by default now: the app is served by this Worker. Set UI_FROM_RENDER=1 as well only if you really want bot buttons to open another host.)
    if (env.UI_FROM_RENDER === "1" && env.APP_BASE_URL && /^https:\/\//i.test(String(env.APP_BASE_URL))) {
      ORIGIN = String(env.APP_BASE_URL).replace(/\/+$/, "");
      APP_URL = `${ORIGIN}/app`;
    }

    if (url.pathname === "/api/analytics/ping" && request.method === "POST") return analyticsPing(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: ADDON_CORS });
    if (url.pathname.startsWith("/api/admin/")) return adminRoute(request, url, env);

    if (request.method === "GET") {
      const addonRes = await addonRoute(request, url, env, ctx);
      if (addonRes) return addonRes;
      { const pw = pwaResponse(url.pathname); if (pw) return pw; }
      if (url.pathname === "/" || url.pathname === "/app") return appPage(env, url);
      const asset = siteAsset(url.pathname);
      if (asset) return asset;
      if (url.pathname === "/trailer") {
        return trailerPage(url.searchParams.get("v") || "", url.searchParams.get("t") || "");
      }
      if (url.pathname.startsWith("/api/")) return cachedApi(request, url, env, ctx);
      return new Response(`${BRAND} bot is running 🍿`);
    }

    if (request.method !== "POST") return new Response(`${BRAND} bot is running 🍿`);

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("ok");
    }
    // Reply to Telegram right away, do the work in the background
    ctx.waitUntil(setupBot(env));
    ctx.waitUntil(handleUpdate(update, env).catch((e) => console.error(e)));
    return new Response("ok");
  },
};
