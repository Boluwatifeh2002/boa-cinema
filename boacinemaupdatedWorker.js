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
  const url =
    `https://api.themoviedb.org/3${path}?api_key=${env.TMDB_KEY}` +
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
async function relaySign(env, u) {
  const e = Math.floor(Date.now() / 1000) + 21600;
  return "/api/relay?u=" + encodeURIComponent(u) + "&e=" + e + "&s=" + (await relayHmac(env, u + "|" + e));
}
async function relayHandle(request, url, env) {
  const u = url.searchParams.get("u") || "";
  const e = Number(url.searchParams.get("e")) || 0;
  const sg = url.searchParams.get("s") || "";
  if (!relayAllowed(u) || e < Date.now() / 1000 || sg !== (await relayHmac(env, u + "|" + e))) return new Response("forbidden", { status: 403 });
  const h = new Headers();
  h.set("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36");
  const rg = request.headers.get("range");
  if (rg) h.set("Range", rg);
  let res;
  try { res = await fetch(u, { headers: h, redirect: "follow", method: request.method === "HEAD" ? "HEAD" : "GET" }); }
  catch (err) { return new Response("relay failed", { status: 502 }); }
  const out = new Headers();
  ["content-type", "content-length", "content-range", "accept-ranges"].forEach((k) => { const v = res.headers.get(k); if (v) out.set(k, v); });
  out.set("Access-Control-Allow-Origin", "*");
  out.set("Cache-Control", "no-store");
  const ct = res.headers.get("content-type") || "";
  if (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u)) {
    const base = res.url || u;
    const lines = (await res.text()).split("\n");
    const fix = async (ref) => { try { const abs = new URL(ref.trim(), base).href; return relayAllowed(abs) ? await relaySign(env, abs) : ref; } catch (err) { return ref; } };
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
  SUBS_CACHE.set(key, { at: Date.now(), v: out });
  if (SUBS_CACHE.size > 300) SUBS_CACHE.delete(SUBS_CACHE.keys().next().value);
  return out;
}
async function subHandle(url, env) {
  const u = url.searchParams.get("u") || "";
  const e = Number(url.searchParams.get("e")) || 0;
  if (!relayAllowed(u) || e < Date.now() / 1000 || url.searchParams.get("s") !== (await relayHmac(env, "sub|" + u + "|" + e))) return new Response("forbidden", { status: 403 });
  try {
    const r = await fetch(u, { headers: { "User-Agent": "BoaCinema/1.0" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return new Response("not found", { status: 404 });
    let t = await r.text();
    if (t.length > 3000000) return new Response("too big", { status: 413 });
    t = t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (!/^WEBVTT/.test(t)) t = "WEBVTT\n\n" + t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    return new Response(t, { headers: { "content-type": "text/vtt; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
  } catch (err) { return new Response("failed", { status: 502 }); }
}

const SW_JS = "var V=\"boa-v1\";\nself.addEventListener(\"install\",function(e){self.skipWaiting();});\nself.addEventListener(\"activate\",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});\nself.addEventListener(\"fetch\",function(e){\n  var r=e.request;\n  if(r.method!==\"GET\")return;\n  var u=new URL(r.url);\n  if(u.pathname.indexOf(\"/api/\")===0)return;\n  if(r.mode===\"navigate\"){\n    e.respondWith(fetch(r).then(function(res){\n      if(u.pathname===\"/\"||u.pathname===\"/app\"){var c=res.clone();caches.open(V).then(function(ca){ca.put(\"/app\",c);});}\n      return res;\n    }).catch(function(){return caches.match(\"/app\").then(function(m){return m||new Response(\"You are offline. Open Boa Cinema again when you have a connection.\",{status:503,headers:{\"content-type\":\"text/plain\"}});});}));\n    return;\n  }\n  if(u.hostname===\"image.tmdb.org\"){\n    e.respondWith(caches.open(V).then(function(ca){return ca.match(r).then(function(hit){\n      var f=fetch(r).then(function(res){if(res.ok||res.type===\"opaque\")ca.put(r,res.clone());return res;}).catch(function(){return hit;});\n      return hit||f;\n    });}));\n  }\n});\n";
const PWA_ICONS = { "192": "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", "512": "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ev0510wH1KtXrx49eqTd6sILL+zQoUPaYikKbN68WZ0KmzFjxg033KBOi6nb2LFj1cM1a9bs3r07xYapn6pTp861116bugzPVhYgACprsBxNgW0yfrko9uu9vzKdO3fuQQcdpBayuX3zzTfqUudvf/tbdfK9efPmRxxxRN26dY877rg2bdpcfPHF6uTS559/nk39iW2nTJmS9pcShg8fniiscf/WW29169btpJNO6t69uzppo96zP/KfH9Wuenjuuec2adJEhaVGzYlN+vbtq+I2scx9WgECIC0RBcIt8LgsO18Urxe+fd+DOvPTunXrbBA3bNjQv3//Qw45ZMiQIU8//fRrr732/vvv79y5U9W5ZcuWN95444UXXhg9evSRRx7Zs2fP9evXq/XaNxUqc+bMSfGhIPXev0WLFnr1P/74461atVqyZEmKzb/77ruBAwcOGDAgRZkUTxUVFQ0bNixFAZ6qLEAAJDVYiJrAThn/X6t4TKxst0+f+FSg559//tChQ9WC3k296x8zZozKjwULFtipYdGiReqAQG2idqN2ytdYpmnTptdcc02NT6mV2m//V65c2adPH1WDndv8+fPVYY2dktXLdO3atfpK1tQoQADUyMLK0As8b5WrN/4+/q5vQvDOO+/U/qiMOlF+2mmn3X333VJmcPiiCqtNzjjjjE8//TTRB4372vbUhx122JlnnqlRYUVFRYpQqbFCdVizcOHCGp9KvfLQQw9t1qxZ6jI8mxAgABIO3EdEQO3+XrbKe1jFg0Xp1/698U9oqmuqao+ZWM70Xp3hUe9kP/vss0w3TJT/8MMP1TtoVUniYab3P//5zwcOHFh9q4suuqj6Sjtrnnvuuffee89OycplJk6cWPmh/WV1LcF+4R9KmvofAWDqzEdu3MVSPiLL2os9V4nS1336pH8VVO0T2cXFxZdddtkHH3xQpcKMHqodrrrQqv2hmho737Zt24z6kCy8dOnS5LL9hXfffVdd4bBfPllS7zAlubk5CwSAOXMd2ZF+JePTZWkbsWdcrOwTv9/1J5XbtWvXvHnz5MOMFu66667Vq1dntEmNhdXl4pm2P9pfpYZjjjmmc+fOlVcKIfR2rOr8j7o4Ubkq+8vqorf9wsmSp59+enKZhRQCBEAKHJ4KtMCnMj7XKrvSKj5D7Lk7Vp7FCR9Xhjl48GC9er/44os7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" };
const PWA_MANIFEST = {
  name: "Boa Cinema",
  short_name: "Boa Cinema",
  description: "Discover movies and series",
  id: "/app",
  start_url: "/app",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
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
    return new Response(SW_JS, { headers: { "content-type": "application/javascript", "cache-control": "no-cache", "service-worker-allowed": "/" } });
  const m = /^\/icon-(192|512)\.png$/.exec(path);
  if (m) {
    const bin = atob(PWA_ICONS[m[1]]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
  }
  return null;
}

const ACTIVE_DAYS = 30;
let usersCache = { n: null, at: 0 };

async function trackUser(env, userId) {
  if (!env.BOT_USERS || !userId) return;
  try {
    const key = `u:${userId}`;
    const today = Math.floor(Date.now() / 86400000);
    const last = await env.BOT_USERS.get(key);
    if (last !== null && Number(last) === today) return; // already counted today, no write
    await env.BOT_USERS.put(key, String(today), { expirationTtl: ACTIVE_DAYS * 86400, metadata: { d: today } });
    const now = Date.now();
    if (now - lastVisitWrite > 120000) {
      lastVisitWrite = now;
      await env.BOT_USERS.put("cfg:lastvisit", String(now));
    }
  } catch (e) {}
}
let lastVisitWrite = 0;
async function activityStats(env) {
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
  STREAM_CACHE.set(key, { at: Date.now(), list });
  if (STREAM_CACHE.size > 300) STREAM_CACHE.delete(STREAM_CACHE.keys().next().value);
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
    IDS_MEMO.set(mediaType + tmdbId, imdb);
    if (IDS_MEMO.size > 500) IDS_MEMO.delete(IDS_MEMO.keys().next().value);
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
  const url = x.url || "";
  if (!/^https?:\/\//i.test(url)) return null; // torrents/external links can't play in the app
  const bh = x.behaviorHints || {};
  const label = [x.name, x.title, x.description, bh.filename].filter(Boolean).join(" ");
  const first = String(x.title || x.description || x.name || bh.filename || "Stream").split("\n")[0].trim();
  const out = { title: first.slice(0, 120), url, quality: qualityOf(label), provider: repo.name || "Stremio" };
  if (bh.videoSize) out.size = bh.videoSize;
  if (bh.notWebReady) out.notWebReady = true;
  return out;
}
async function stremioStreams(repo, env, mediaType, tmdbId, season, episode, timeoutMs) {
  const base = repo.base || manifestBase(repo.url);
  const ids = await streamVideoIds(env, mediaType, tmdbId, season, episode);
  for (const vid of ids) {
    try {
      const r = await fetch(base + "/stream/" + (mediaType === "tv" ? "series" : "movie") + "/" + encodeURIComponent(vid).replace(/%3A/g, ":") + ".json", {
        headers: { "user-agent": "BoaCinema/1.0" },
        signal: AbortSignal.timeout(timeoutMs || 9000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const list = (Array.isArray(j.streams) ? j.streams : []).map((x) => normStremio(repo, x)).filter(Boolean);
      if (list.length) return list;
    } catch (e) {}
  }
  return [];
}
async function stremioOnly(env, mediaType, tmdbId, season, episode) {
  const repos = (await getPluginRepos(env)).filter((r) => r.enabled !== false && r.kind === "stremio" && !(r.disabled || []).includes("stremio"));
  const lists = await Promise.all(repos.map((r) => stremioStreams(r, env, mediaType, tmdbId, season, episode, Number(env.SCRAPER_TIMEOUT_MS) || 9000).catch(() => [])));
  return lists.flat();
}

async function loadManifest(url, timeoutMs, fresh) {
  const hit = MANIFEST_CACHE.get(url);
  if (!fresh && hit && Date.now() - hit.at < CODE_TTL_MS) return hit.m;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 8000), headers: { "user-agent": "BoaCinema/1.0" } });
  if (!r.ok) throw new Error("manifest " + r.status);
  const m = await r.json();
  MANIFEST_CACHE.set(url, { at: Date.now(), m });
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
  SCRIPT_CACHE.set(url, { at: Date.now(), fn });
  return fn;
}

function withTimeout(p, ms, label) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label + " timed out")), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

function startScrapers(env, tmdbId, mediaType, season, episode, key) {
  const bag = [];
  const seen = new Set();
  const job = { bag, done: null };
  job.done = (async () => {
    const perScraper = Number(env.SCRAPER_TIMEOUT_MS) || 9000;
    const only = String(env.ONLY_SCRAPERS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
    const repos = (await getPluginRepos(env)).filter((r) => r.enabled !== false);
    const tasks = [];
    await Promise.all(
      repos.map(async (repo) => {
        if (repo.kind === "stremio") {
          if ((repo.disabled || []).includes("stremio")) return;
          tasks.push(
            (async () => {
              const res = await stremioStreams(repo, env, mediaType, tmdbId, season, episode, perScraper).catch(() => []);
              for (const st of res) {
                const k = String(st.url);
                if (seen.has(k)) continue;
                seen.add(k);
                bag.push(st);
              }
              console.log("Collected " + res.length + " streams from " + (repo.name || repo.url));
            })()
          );
          return;
        }
        let manifest;
        try {
          manifest = await loadManifest(repo.url, 8000);
        } catch (err) {
          console.log("Repo failed " + repo.url + ": " + err.message);
          return;
        }
        const off = new Set((repo.disabled || []).map(String));
        for (const sc of scraperList(manifest, repo.url)) {
          const sid = String(sc.id || sc.name || "");
          const label = sc.name || sc.id || sc.url;
          if (sc.enabled === false || !sc.url || off.has(sid)) continue;
          if (only.length && !only.some((o) => String(sc.name || sc.id).toLowerCase().includes(o))) continue;
          const types = sc.supportedTypes || sc.types;
          if (Array.isArray(types) && types.length && !types.includes(mediaType)) continue;
          tasks.push(
            (async () => {
              try {
                const fn = await loadScraperFn(sc.url, 12000);
                const res = await withTimeout(
                  Promise.resolve().then(() => fn(String(tmdbId), mediaType, season, episode)),
                  perScraper,
                  label
                );
                if (Array.isArray(res)) {
                  for (const st of res) {
                    if (!st) continue;
                    const k = String(st.url || st.title || "");
                    if (seen.has(k)) continue;
                    seen.add(k);
                    bag.push({ ...st, provider: sc.name || st.provider || sc.id });
                  }
                  console.log("Collected " + res.length + " streams from " + label);
                }
              } catch (err) {
                console.log("Skipped scraper " + label + ": " + (err && err.message));
              }
            })()
          );
        }
      })
    );
    await Promise.allSettled(tasks);
  })();
  job.done
    .then(() => cacheSetStreams(key, bag.slice()))
    .catch(() => {})
    .finally(() => STREAM_JOBS.delete(key));
  return job;
}

async function fetchPluginStreams(env, tmdbId, mediaType, season = 1, episode = 1) {
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  if (globalThis.__fastStreams) {
    // your faststream.js stays the main path; installed Stremio add-ons run alongside it and get merged in
    const [fast, extra] = await Promise.all([
      Promise.resolve(globalThis.__fastStreams(env, tmdbId, mediaType, season, episode)).catch(() => []),
      withTimeout(stremioOnly(env, mediaType, tmdbId, s, e), (Number(env.SCRAPER_TIMEOUT_MS) || 9000) + 1000, "stremio").catch(() => []),
    ]);
    const seenU = new Set();
    return (Array.isArray(fast) ? fast : []).concat(extra).filter((x) => x && x.url && !seenU.has(x.url) && seenU.add(x.url));
  }
  const key = [mediaType, tmdbId, mediaType === "tv" ? s : 0, mediaType === "tv" ? e : 0].join(":");
  const cached = STREAM_CACHE.get(key);
  if (cached && Date.now() - cached.at < (cached.list.length ? STREAM_TTL_MS : EMPTY_TTL_MS)) return cached.list;

  if (env.STREAM_BACKEND) {
    try {
      const r = await fetch(
        env.STREAM_BACKEND.replace(/\/+$/, "") + "/api/plugin-streams?type=" + encodeURIComponent(mediaType) +
          "&id=" + encodeURIComponent(tmdbId) + "&s=" + s + "&e=" + e,
        { headers: { "x-stream-key": env.STREAM_KEY || "" }, signal: AbortSignal.timeout(Number(env.BACKEND_TIMEOUT_MS) || 45000) }
      );
      const list = r.ok ? await r.json() : [];
      if (Array.isArray(list)) cacheSetStreams(key, list);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  let job = STREAM_JOBS.get(key);
  if (!job) {
    job = startScrapers(env, tmdbId, mediaType, s, e, key);
    STREAM_JOBS.set(key, job);
  }
  const budget = Number(env.STREAM_BUDGET_MS) || 10000;
  let timer;
  await Promise.race([job.done, new Promise((r) => { timer = setTimeout(r, budget); })]);
  clearTimeout(timer);
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

async function handleApi(url, env, request) {
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
        const streams = await fetchPluginStreams(env, id, media, s, e);
        return send(Array.isArray(streams) ? streams : [], 200, "no-store");
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
    if (path === "/api/relay-sign") {
      const u = url.searchParams.get("u") || "";
      if (!relayAllowed(u)) return send({ error: "bad link" }, 400, "no-store");
      return send({ u: await relaySign(env, u) }, 200, "no-store");
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
#seg{position:absolute;top:calc(var(--sat) + 12px);right:14px;left:auto;transform:none;z-index:6;display:flex;padding:4px;border-radius:999px;background:rgba(20,20,22,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1)}
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
.toast{position:fixed;left:50%;bottom:calc(var(--sab) + 100px);transform:translateX(-50%);background:#fff;color:#000;font-weight:700;font-size:14px;padding:10px 18px;border-radius:999px;z-index:90;opacity:0;pointer-events:none;transition:opacity .2s}
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
.atabs{display:flex;gap:8px;padding:0 16px 12px;position:sticky;top:0;z-index:5;background:var(--bg)}
.atab{flex:1;padding:10px 0;border-radius:999px;border:0;background:#1c1c1f;color:#d4d4d8;font-weight:700;font-size:14px}
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

#player{position:fixed;inset:0;z-index:120;background:#000;display:none;opacity:0;transition:opacity .25s ease;user-select:none;-webkit-user-select:none;touch-action:manipulation}
#player.open{display:block;opacity:1}
#player .pvid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1}
#player .pamb{position:absolute;inset:-10%;width:120%;height:120%;filter:blur(70px) saturate(1.6);opacity:0;transition:opacity .4s;z-index:0}
#player.amb .pamb{opacity:.55}
#player video::cue{background:rgba(0,0,0,.7);font-size:1.1em}
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
  <div id="hero" class="sk">
    <div id="seg"><button id="segm" class="on">Movies</button><button id="segt">Series</button></div>
  </div>
  <div style="height:16px"></div>
  <div id="notice" class="notice"></div>
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
  var SUBS = [];
  var SUBSEL = "";
  var LANGS = { eng: "English", spa: "Spanish", fre: "French", fra: "French", por: "Portuguese", ara: "Arabic", ger: "German", deu: "German", ita: "Italian", rus: "Russian", hin: "Hindi", tur: "Turkish", chi: "Chinese", zho: "Chinese", jpn: "Japanese", kor: "Korean", dut: "Dutch", pol: "Polish", ind: "Indonesian", swa: "Swahili", yor: "Yoruba" };
  function applySub() {
    var v = document.querySelector("#player video, #smplayer video");
    if (!v) return;
    Array.prototype.slice.call(v.querySelectorAll("track")).forEach(function (t) { t.remove(); });
    if (SUBSEL === "") return;
    var sb = SUBS[+SUBSEL];
    if (!sb) return;
    var tr = document.createElement("track");
    tr.kind = "subtitles"; tr.label = sb.lang; tr.srclang = String(sb.lang).slice(0, 2); tr.src = sb.u; tr.default = true;
    v.appendChild(tr);
    setTimeout(function () { try { if (v.textTracks && v.textTracks[0]) v.textTracks[0].mode = "showing"; } catch (e) {} }, 300);
  }
  function loadSubs(mt, id, s, e) {
    SUBS = []; SUBSEL = "";
    var box = $("smsubs");
    if (!box) return;
    box.textContent = "";
    api("/api/subs?type=" + mt + "&id=" + encodeURIComponent(id) + "&s=" + (s || 1) + "&e=" + (e || 1), 0, 20000).then(function (list) {
      if (!list || !list.length) return;
      SUBS = list;
      var sel = h("select", "ainp");
      sel.style.cssText = "margin:0 16px 8px;width:calc(100% - 32px)";
      var o0 = h("option", null, "Subtitles: Off"); o0.value = ""; sel.appendChild(o0);
      list.forEach(function (x, i) {
        var o = h("option", null, "Subtitles: " + (LANGS[x.lang] || x.lang) + (x.n > 1 ? " " + x.n : "")); o.value = String(i); sel.appendChild(o);
      });
      var def = -1;
      list.forEach(function (x, i) { if (def < 0 && x.lang === "eng") def = i; });
      sel.onchange = function () { SUBSEL = sel.value; applySub(); };
      box.appendChild(sel);
      sel._def = def;
      if (PLSUBREFRESH) PLSUBREFRESH();
    }).catch(function () {});
  }
  function RELAY_ON() { return lsGet("boa_relay", "0") === "1"; }
  function relaySign(u) {
    return api("/api/relay-sign?u=" + encodeURIComponent(u), 0, 15000).then(function (r) { return location.origin + r.u; }).catch(function () { toast("Privacy relay unavailable, playing directly"); return u; });
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
        st.textContent = "Direct connection (Your IP is visible)";
        return;
      }
      st.style.color = "#a3a3a8";
      st.textContent = "Checking relay\u2026";
      relaySign("https://api.ipify.org?format=json").then(function (u) { return fetch(u).then(function (r) { return r.json(); }); }).then(function (j) {
        if (!cb.checked) return;
        st.style.color = "#46d369";
        st.textContent = "Protected \u2022 Relay IP: " + j.ip;
      }).catch(function () { st.style.color = "#f59e0b"; st.textContent = "Relay IP could not be confirmed"; });
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
  function closeProfiles() { $("profiles").className = ""; }
  function openProfiles(manage) {
    var box = $("profiles");
    box.textContent = "";
    box.className = "open";
    box.appendChild(h("h1", null, manage === "edit" ? "Manage profiles" : "Who's watching?"));
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
    var hls = null, relayed = false, retried = false, hideT = null, saveT = null, seeking = false, closed = false, ambT = null, finished = false;

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
    row.appendChild(bPlay); row.appendChild(bBack); row.appendChild(bFwd); row.appendChild(bMute); row.appendChild(vol); row.appendChild(tim); row.appendChild(sp); row.appendChild(cc);
    bot.appendChild(row);
    root.appendChild(bot);

    function fillCC() {
      cc.textContent = "";
      if (!SUBS || !SUBS.length) { cc.style.display = "none"; return; }
      cc.style.display = "";
      var o0 = h("option", null, "CC: Off"); o0.value = ""; cc.appendChild(o0);
      SUBS.forEach(function (x, i) { var o = h("option", null, "CC: " + (LANGS[x.lang] || x.lang) + (x.n > 1 ? " " + x.n : "")); o.value = String(i); cc.appendChild(o); });
      cc.value = SUBSEL;
    }
    fillCC();
    PLSUBREFRESH = fillCC;
    cc.onchange = function () { SUBSEL = cc.value; applySub(); };

    // ----- controls visibility (hides after 3 seconds of inactivity) -----
    function showCtl() {
      root.classList.remove("hide");
      clearTimeout(hideT);
      hideT = setTimeout(function () { if (!v.paused && !seeking) root.classList.add("hide"); }, 3000);
    }
    ["mousemove", "touchstart", "keydown"].forEach(function (ev) { root.addEventListener(ev, showCtl, { passive: true }); });

    // ----- source -----
    function fail(text) { spin.className = "pspin"; msg.textContent = text; msg.className = "pmsg on"; }
    function startSource(src0, useRelay) {
      var isHls = /\.m3u8(\?|$)/i.test(src0);
      function go(src) {
        if (closed) return;
        if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
        msg.className = "pmsg";
        spin.className = "pspin on";
        var onFatal = function () {
          if (!relayed && !retried) { retried = true; toast("Retrying through the privacy relay"); startSource(src0, true); return; }
          fail("This stream can't play in the app player. Close it and try another stream or the VLC button.");
        };
        if (isHls && window.Hls && window.Hls.isSupported()) {
          hls = new window.Hls({ maxBufferLength: 40, enableWorker: true, lowLatencyMode: false });
          hls.on(window.Hls.Events.ERROR, function (ev, d) {
            if (!d || !d.fatal) return;
            if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); return; } catch (e) {} }
            onFatal();
          });
          hls.loadSource(src);
          hls.attachMedia(v);
          var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
        } else {
          v.src = src;
          v.onerror = onFatal;
          var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {});
        }
      }
      if (useRelay || RELAY_ON()) {
        relayed = true;
        relaySign(src0).then(go);
      } else go(src0);
    }
    if (/\.m3u8(\?|$)/i.test(url)) loadHls(function () { startSource(url, false); });
    else startSource(url, false);

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
      if (!ctx || finished || !(v.currentTime > 1)) return;
      recordWatch(ctx, v.currentTime, v.duration || 0, !!force);
    }
    v.addEventListener("play", function () { paintPlay(); showCtl(); });
    v.addEventListener("pause", function () { paintPlay(); root.classList.remove("hide"); save(true); });
    v.addEventListener("waiting", function () { spin.className = "pspin on"; });
    v.addEventListener("playing", function () { spin.className = "pspin"; msg.className = "pmsg"; });
    v.addEventListener("canplay", function () { spin.className = "pspin"; });
    v.addEventListener("timeupdate", paintTime);
    v.addEventListener("progress", paintTime);
    v.addEventListener("durationchange", paintTime);
    v.addEventListener("seeking", function () { if (v.currentTime < (v.duration || 1) * 0.9) finished = false; });
    v.addEventListener("ended", function () { finished = true; if (ctx) recordWatch(ctx, v.duration || 1, v.duration || 1, true); root.classList.remove("hide"); paintPlay(); });
    v.addEventListener("loadedmetadata", function () {
      if (ctx && ctx.resumeAt > 10 && v.duration && ctx.resumeAt < v.duration - 30) { try { v.currentTime = ctx.resumeAt; } catch (e) {} ctx.resumeAt = 0; }
      applySub();
      paintTime();
    });
    v.volume = +vol.value;
    paintPlay();
    saveT = setInterval(function () { if (!v.paused) save(false); }, 5000);

    // ----- actions -----
    function toggle() { if (v.paused) { var q = v.play(); if (q && q.catch) q.catch(function () {}); } else v.pause(); }
    function seekBy(n) { if (v.duration) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + n)); showCtl(); }
    function paintVol() { bMute.innerHTML = (v.muted || v.volume === 0) ? PI.mute : PI.vol; }
    bPlay.onclick = toggle;
    bBack.onclick = function () { seekBy(-10); };
    bFwd.onclick = function () { seekBy(10); };
    bMute.onclick = function () { v.muted = !v.muted; paintVol(); };
    vol.oninput = function () { v.volume = +vol.value; v.muted = v.volume === 0; lsSet("boa_vol", vol.value); paintVol(); };
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
    bFs.onclick = function () {
      try {
        if (isFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        if (root.requestFullscreen) root.requestFullscreen();
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
        else if (tg && tg.requestFullscreen) tg.requestFullscreen();
      } catch (e) {}
    };

    // tap on the picture: first tap shows controls, next tap play/pause; double tap sides skips 10s
    var lastTap = 0;
    root.addEventListener("click", function (ev) {
      if (ev.target !== v && ev.target !== root && ev.target !== spin) return;
      var now = Date.now();
      if (now - lastTap < 300) {
        var r = root.getBoundingClientRect();
        seekBy(ev.clientX < r.left + r.width / 2 ? -10 : 10);
        lastTap = 0;
        return;
      }
      lastTap = now;
      var wasHidden = root.classList.contains("hide");
      showCtl();
      if (!wasHidden) setTimeout(function () { if (lastTap === now) { toggle(); } }, 310);
    });

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
      else if (ev.key === "f") bFs.onclick();
      else if (ev.key === "m") bMute.onclick();
      else if (ev.key === "Escape" && !isFs()) closeP();
    }
    function onHide() { if (document.hidden) save(true); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    function closeP() {
      if (closed) return;
      closed = true;
      save(true);
      clearInterval(saveT); clearInterval(ambT); clearTimeout(hideT);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      PLSUBREFRESH = null;
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

    api("/api/streams?type=" + mt + "&id=" + encodeURIComponent(id) + "&s=" + (s || 1) + "&e=" + (e || 1), 0, 60000)
      .then(function (streams) {
        clearTimeout(slowT);
        list.textContent = "";
        if (!streams || !streams.length) {
          list.appendChild(h("div", "note center", "No stream returned."));
          return;
        }
        var streamsOrig = streams.slice();
        streams.forEach(function (st) {
          var row = h("div", "sitem");
          row.setAttribute("data-prov", st.provider || "Plugin");
          var meta = h("div");
          meta.appendChild(h("b", null, st.title || "Stream"));
          meta.appendChild(h("span", null, (st.provider || "Plugin") + " \u2022 " + (st.quality || "HD")));
          row.appendChild(meta);
          var btn = h("button", "splaybtn", "Play");
          btn.onclick = function () {
  player.style.display = "block";
  player.textContent = "";
  if (btn._msg) { btn._msg.remove(); btn._msg = null; }
  var note = h("div", "note", "");
  btn._msg = note;
  meta.appendChild(note);
  if (!st.url || /^magnet:/i.test(st.url)) {
    note.textContent = "Torrent result with no direct link. It needs a debrid service.";
    return;
  }
  if (!/\/embed\/|\.html?($|\?)/i.test(st.url)) {
    note.textContent = "";
    player.style.display = "none";
    openPlayer(st.url, st);
  } else {
    var ifr = document.createElement("iframe");
    ifr.src = st.url;
    ifr.allow = "autoplay; fullscreen; encrypted-media";
    ifr.setAttribute("allowfullscreen", "");
    player.appendChild(ifr);
  }
  modal.scrollTo({ top: 0, behavior: "smooth" });
  var w0 = CUR && watchGet(CUR.mt, CUR.id);
  if (CUR && (!w0 || w0.nx || w0.e !== CUR.e || w0.s !== CUR.s)) recordWatch(CUR, 1, 0, true);
};
          row.appendChild(btn);
          var acts = h("div");
acts.style.cssText = "display:flex;gap:8px;align-items:center;flex:none";
acts.appendChild(btn);
          var rk = streamRank(st);
if (rk >= 3) {
  var badge = h("span", null, rk === 9 ? "Torrent (needs debrid)" : "Large file: best in VLC or the app");
  badge.style.cssText = "display:block;opacity:.7;font-size:12px";
  meta.appendChild(badge);
}
var vb = h("button", "splaybtn", "VLC");
vb.style.marginLeft = "8px";
vb.onclick = function () {
  var u = st.url || "";
  if (RELAY_ON() && u && !vb._r && !/^magnet:/i.test(u)) { relaySign(u).then(function (ru) { st = Object.assign({}, st, { url: ru }); vb._r = 1; vb.onclick(); }); return; }
  if (!u || /^magnet:/i.test(u)) return;
  var ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    var sch = /^https:/i.test(u) ? "https" : "http";
    location.href = "intent://" + u.replace(/^https?:\/\//i, "") + "#Intent;scheme=" + sch + ";package=org.videolan.vlc;type=video/*;end";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    location.href = "vlc://" + u;
  } else {
    var txt = "#EXTM3U\n#EXTINF:-1," + String(st.title || "Stream").replace(/[\r\n]+/g, " ") + "\n" + u + "\n";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "audio/x-mpegurl" }));
    a.download = "stream.m3u";
    a.click();
  }
};
acts.appendChild(vb);
row.appendChild(acts);
          list.appendChild(row);
        });
        var provs = [];
        function streamRank(s) {
  var u = String(s.url || ""), t = String(s.title || "");
  if (!u || /^magnet:/i.test(u)) return 9;
  var heavy = /hevc|x265|h\.?265|remux|dts|2160p|\b4k\b/i.test(t);
  if (/\.mp4(\?|$)/i.test(u) && !heavy) return 0;
  if (/\.m3u8(\?|$)/i.test(u) && !heavy) return 1;
  if (/\.mkv(\?|$)/i.test(u) || heavy) return 3;
  return 2;
}
streams = streams.slice().sort(function (a, b) { return streamRank(a) - streamRank(b); });
streams.forEach(function (s) {
  var p = s.provider || "Plugin";
  if (provs.indexOf(p) < 0) provs.push(p);
});
if (provs.length) {
  var bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;overflow-x:auto;padding:4px 0 10px";
  ["All"].concat(provs).forEach(function (name) {
    var c = document.createElement("button");
    c.textContent = name;
    c.style.cssText = "flex:none;padding:6px 14px;border-radius:999px;border:0;cursor:pointer;background:#2a2a2e;color:#fff";
    c.onclick = function () {
      Array.prototype.forEach.call(bar.children, function (x) { x.style.background = "#2a2a2e"; x.style.color = "#fff"; });
      c.style.background = "#fff"; c.style.color = "#000";
      Array.prototype.forEach.call(list.querySelectorAll(".sitem"), function (r) {
        r.style.display = (name === "All" || r.getAttribute("data-prov") === name) ? "" : "none";
      });
    };
    bar.appendChild(c);
  });
  list.insertBefore(bar, list.firstChild);
}
if (CUR && CUR.auto) {
  CUR.auto = false;
  var bi = -1, br = 99;
  streamsOrig.forEach(function (x, i) { var rk = streamRank(x); if (x.url && rk < br && rk <= 3) { br = rk; bi = i; } });
  var rowsEl = list.querySelectorAll(".sitem");
  if (bi > -1 && rowsEl[bi]) { var pbtn = rowsEl[bi].querySelector(".splaybtn"); if (pbtn) pbtn.click(); }
}
      })
      .catch(function (e) {
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
    if (d.mt === "movie" && !isUnreleased(d) && /^\d+$/.test(String(d.id))) { api("/api/streams?type=movie&id=" + d.id + "&s=1&e=1", 0, 60000).catch(function () {}); }
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
      el.appendChild(document.createTextNode(t));
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

  // ---------- owner panel (shown only to the owner; Telegram signs who you are) ----------
  var IS_OWNER = false;
  var ADM = { picks: [], custom: false, notice: "", active: null, kv: true, addons: [] };
  function adm(path, body) {
    var headers = { "x-tg-init": (tg && tg.initData) || "" };
    var opt = { headers: headers };
    if (body) { opt.method = "POST"; headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || "failed");
        return j;
      });
    });
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
    [["ov", "Overview"], ["ad", "Add-ons"], ["pl", "Plugins"]].forEach(function (t) {
      var b = h("button", "atab" + (ADM_TAB === t[0] ? " on" : ""), t[1]);
      b.onclick = function () { ADM_TAB = t[0]; showAdmTab(); };
      b.setAttribute("data-tb", t[0]);
      tabBar.appendChild(b);
    });
    box.appendChild(tabBar);
    function put(t, el) { el.setAttribute("data-t", t); box.appendChild(el); }
    function showAdmTab() {
      Array.prototype.forEach.call(box.querySelectorAll("[data-t]"), function (el) { el.style.display = el.getAttribute("data-t") === ADM_TAB ? "" : "none"; });
      Array.prototype.forEach.call(tabBar.children, function (b) { b.className = "atab" + (b.getAttribute("data-tb") === ADM_TAB ? " on" : ""); });
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
    var c1 = h("div", "stats");
    [
      ["M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8", stt.active == null ? "\u2013" : fmtN(stt.active), "Active Users", "30 days"],
      ["M3 12h4l3-9 4 18 3-9h4", stt.active == null ? "\u2013" : fmtN(stt.today || 0), "Active Today", "24 hours"],
      ["M3 4h18v16H3zM3 10h18M8 2v4M16 2v4", stt.active == null ? "\u2013" : fmtN(stt.week || 0), "This Week", "7 days"],
      ["M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", ago(stt.lastVisit), "Last Visit", "most recent"]
    ].forEach(function (c) {
      var card = h("div", "stat");
      card.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#e50914" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + c[0] + '"/></svg>';
      card.appendChild(h("b", null, c[1]));
      card.appendChild(h("span", null, c[2]));
      card.appendChild(h("i", null, c[3]));
      c1.appendChild(card);
    });
    put("ov", c1);
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
    var cHM = h("div", "acard");
    cHM.appendChild(h("h3", null, "Home page rows"));
    cHM.appendChild(h("p", null, "Choose what the home page shows below the top banner. Switch back any time; nothing is deleted."));
    var hmRow = h("div", "arow2");
    [["addons", "Add-ons only"], ["builtin", "Original rows"]].forEach(function (o) {
      var b = h("button", "abtn mini", o[1]);
      b.style.opacity = (ADM.homeMode || "builtin") === o[0] ? "1" : ".5";
      if ((ADM.homeMode || "builtin") === o[0]) b.textContent = "\u2713 " + o[1];
      b.onclick = function () {
        adm("/api/admin/homemode", { mode: o[0] }).then(function (r) { ADM.homeMode = r.homeMode; ADM_TAB = "ad"; renderAdmin(false); toast(o[0] === "addons" ? "Home now shows only your add-on rows" : "Original rows restored"); }).catch(function (e) { toast("Couldn't change: " + e.message); });
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
            adm("/api/admin/addons", { action: "add", base: r.base, subs: true, cats: [] }).then(function (res) { ADM.addons = res.addons; ADM_TAB = "ad"; renderAdmin(false); toast("Subtitles add-on installed"); }).catch(function (e) { toast("Couldn't install: " + e.message); });
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
            ADM_TAB = "ad";
            renderAdmin(false);
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
        ADM.addons = res.addons; ADM_TAB = "ad"; renderAdmin(false);
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
            adm("/api/admin/addons", { action: "update", id: a.id, cats: picked }).then(function (res) { ADM.addons = res.addons; ADM_TAB = "ad"; renderAdmin(false); toast("Saved"); }).catch(function (e) { toast("Couldn't save: " + e.message); });
          };
          det.appendChild(sv);
        }).catch(function (e) { det.textContent = ""; det.appendChild(h("p", null, "Couldn't load this add-on: " + e.message + ". It may be offline; you can still Delete it.")); });
      };
      btns.appendChild(setB);
      var rf = h("button", "abtn mini", "Refresh");
      rf.onclick = function () {
        rf.textContent = "…";
        adm("/api/admin/addons", { action: "refresh", id: a.id }).then(function (res) { ADM.addons = res.addons; ADM_TAB = "ad"; renderAdmin(false); toast("Refreshed"); }).catch(function (e) { rf.textContent = "Refresh"; toast("Couldn't refresh: " + e.message); });
      };
      btns.appendChild(rf);
      var tg2 = h("button", "abtn mini", a.enabled === false ? "Enable" : "Disable");
      tg2.onclick = function () {
        adm("/api/admin/addons", { action: "toggle", id: a.id, enabled: a.enabled === false }).then(function (res) { ADM.addons = res.addons; ADM_TAB = "ad"; renderAdmin(false); }).catch(function (e) { toast("Couldn't change: " + e.message); });
      };
      btns.appendChild(tg2);
      var rm = h("button", "abtn mini red", "Delete");
      rm.onclick = function () {
        confirmThen("Delete " + (a.name || "this add-on") + "?", function () {
          adm("/api/admin/addons", { action: "remove", id: a.id, base: a.base }).then(function (res) { ADM.addons = res.addons; ADM_TAB = "ad"; renderAdmin(false); toast("Deleted"); }).catch(function (e) { toast("Couldn't delete: " + e.message); });
        });
      };
      btns.appendChild(rm);
      card.appendChild(btns);
      card.appendChild(det);
      cAL.appendChild(card);
    });
    put("ad", cAL);

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
              ADM_TAB = "pl";
              renderAdmin(false);
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
        ADM_TAB = "pl";
        renderAdmin(false);
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

    showAdmTab();
    box.appendChild(h("div", "note center", "Only your account can see this panel."));
  }

  var yr = $("yr");
  if (yr) yr.textContent = String(new Date().getFullYear());
  $("fhandle").addEventListener("click", function (e) {
    if (tg && tg.openTelegramLink) { e.preventDefault(); try { tg.openTelegramLink(this.href); } catch (x) { openLink(this.href); } }
  });

  applyTheme();
  if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("/sw.js"); } catch (e) {} }
  profilesLoad();
  dataLoad();
  loadNotice();
  setInterval(loadNotice, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) loadNotice(); });
  checkOwner();
  paintNavAvatar();
  paintSeg();
  loadHome();
  if (PROFILES.length > 1) openProfiles(false);
  api("/api/me", 0).then(function (r) {
    if (r && r.country) { myCC = String(r.country).toUpperCase(); if (tab === "me") renderMe(); }
  }).catch(function () {});
})();
</script>
</body>
</html>
`;

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
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
}

const ICON_192_B64 = "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";
const ICON_512_B64 = "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAQAElEQVR4AeydC5gkVXn3z6nu6Z5Z2AWWZVfiBcFHjfmUVfMEFj4UREEFjCIqEEMEEkXAQEQMQdz4KRpE8YaBgBjFrEREAYlyiQiBSATxip9fFH0+QQVxF1hkV3a6Z6br5N2ZmpnumZ7uqu66nFPntw9M3c7lfX9vnfp3vae6OljGPwhAAAIQ8JJAoPgHAQhAAAJeEkAAvAw7TkNAKQUE7wkgAN6fAgCAAAR8JYAA+Bp5/IYABLwngAB4ewrgOAQg4DsBBMD3MwD/IQABbwkgAN6GHschAAFfCcz6jQDMkmAJAQhAwDMCCIBnAcddCEAAArMEEIBZEiwh4AsB/IRARAABiECwgAAEIOAbAQTAt4jjLwQgAIGIAAIQgfBngacQgAAEZgggADMc+AsBCEDAOwIIgHchx2EIQMBXAgv9RgAWEmEbAhCAgCcEEABPAo2bEIAABBYSQAAWEmEbAmUlgF8QWEAAAVgAhE0IQAACvhBAAHyJNH5CAAIQWEAAAVgApLybeAYBCECgkwAC0MmDLQhAAALeEEAAvAk1jkIAAr4SWMpvBGApMuyHAAQgUHICCEDJA4x7EIAABJYigAAsRYb9ECgLAfyAwBIEEIAlwLAbAhCAQNkJIABljzD+QQACEFiCAAKwBJjy7MYTCEAAAt0JIADdubAXAhCAQOkJIAClDzEOQgACvhLo5zcC0I8QxyEAAQiUlAACUNLA4hYEIACBfgQQgH6EOA4BVwlgNwT6EEAA+gDiMAQgAIGyEkAAyhpZ/IIABCDQhwAC0AeQu4exHAIQgEBvAghAbz4chQAEIFBaAghAaUOLYxCAgK8E4vqNAMQlRTkIQAACJSOAAJQsoLgDAQhAIC4BBCAuKcpBwBUC2AmBmAQQgJigKAYBCECgbAQQgLJFFH8gAAEIxCSAAMQE5U4xLIUABCAQjwACEI8TpSAAAQiUjgACULqQ4hAEIOArgaR+IwBJiVEeAhCAQEkIIAAlCSRuQAACEEhKAAFISozyELCVAHZBICEBBCAhMIpDAAIQKAsBBKAskcQPCEAAAgkJIAAJgdlbHMsgAAEIJCOAACTjRWkIQAACpSGAAJQmlDgCAQj4SmBQvxGAQclRDwIQgIDjBBAAxwOI+RCAAAQGJYAADEqOehCwhQB2QGBAAgjAgOCoBgEIQMB1AgiA6xHEfghAAAIDEkAABgRnTzUsgQAEIDAYAQRgMG7UggAEIOA8AQTA+RDiAAQg4CuBYf1GAIYlSH0IQAACjhJAABwNHGZDAAIQGJYAAjAsQepDoCgC9AuBIQkgAEMCpDoEIAABVwkgAK5GDrshAAEIDEkAARgSYHHV6RkCEIDAcAQQgOH4URsCEICAswQQAGdDh+EQgICvBNLyGwFIiyTtQAACEHCMAALgWMAwFwIQgEBaBBCAtEjSDgTyIkA/EEiJAAKQEkiagQAEIOAaAQTAtYhhLwQgAIGUCCAAKYHMrxl6ggAEIJAOAQQgHY60AgEIQMA5AgiAcyHDYAhAwFcCafuNAKRNlPYgAAEIOEIAAXAkUJgJAQhAIG0CCEDaRGkPAlkRoF0IpEwAAUgZKM1BAAIQcIUAAuBKpLATAhCAQMoEEICUgWbXHC1DAAIQSJcAApAuT1qDAAQg4AwBBMCZUGEoBCDgK4Gs/EYAsiJLuzkTWGXUC4w+yASvNMHrTOUvwspbTfXtYfXdZuQD4cjHw9qlYW1DWL/G1G8K6/8Zjn4nHP25WSb/yYpsyk45JAWkmBSWKlJRqksj0pQ0KM1K49KFdJSza3QHgYwIIAAZgaXZDAmMGPNso18RBieb6ofCkatN/Xvh6J1q2VVq7DI1eqEaPU/V1+v6O1TtFF17kxp5gx45XFcP1tV1uvI8VXmGruyug511MGOirMim7JRDUkCKSWGpIhWlujQiTUmD0qw0Ll1IR9Ldl01duhYDxIxnGS0mzbTGXwg4RCAaAw5ZjKm+EVht9L4mOCasvMuMXBbWbglHf2yWfU2NfVKPnqFqR+qRvVVlxezVPB840t1aVZGuxQAx43o1JiaJYWKeGCmmisFidlrG0A4EMiKAAGQElmYHJ7CTUS8NA7mSXhXWfxiO/Zca+7waPVfXT1AjB+nq03QQaD1469nUFJPEMDFPjBRTxWAxW4wXF8QRcUecyqZnWoXA4AQQgMHZUTNFAnJ9lKukXCuvC+t3m7FL9KhcSV+gKzvYd62P77UYLy6II+KOOCWuiYPipjgbvxFKQiA7AghAdmxTarm8zch1UK6Gck2UK6NcH+UqKdfKP9IV+TRdPqfFKXFNHBQ3xVlxWRwX9wVC+ZzFI1cIIACuRKokdsr1Tq56cu2TK6BcB+VqKNdEuTLK9bEkHsZwQ5wVl8VxcV8gCAoBIlgETozaFIFAagQQgNRQ0lAPAnJpO9pUPhfW5HonVz259skVUK6DPap4ckggCAoBIlgEjiB6vakILk/cx83eBLI+igBkTdjr9seMOcJULjW1b5mx96v6/roq1zuvifR0XuAIon9QdcF1iakdbgIB2LMGByEwFAEEYCh8VO5KYMSYg8PgY2HtLrPsY6p+sKrWXJ7L7epjpjsF10tV9eNqVAB+NKy9xFQEaaY90rifBBAAP+OeidfamP1M8IFwRD7AXqpHj9DVZVz3hyGtlAB8la5+avqe4P3hyDoTCOThmqQ2BOYJIADzLFgbmMBao99tRu4wY/+iRt+gR3bO92tZA5vtUEVBerQe2aBG71DLzjEje4fWfRPCIZiYOkcAAZhDwUpiAs8y+oywems4+mU19iY1sprrfmKEiSusVvp4NXK1HrslHP2bsCohSNwEFSAwSwABmCVh3dJqg54b6n80ta+a0ZN17alc94uI1dN0cKreHoJPmpqEowgT6NN5AgiA8yHM2QHJ8n8urF2rx16ueKQnZ/Zdugu0foWqSjguD2syQ9ClBLsgsDQBBGBpNhxpI6CNOTQMrjF1yfLvr6ttR1i1gsD/1lWZIbja1A8JmSi2IiJDGZFXZQQgL9LO9lM15ihTucmMXqRHn6cqzvrhheF7q8rFevRGM/paUwmM8cJnnByCAAIwBLyyV60bc3xYuVWNfVDV99Jc+p2J9zN05XxVv9mMHRNWJIjO2I2huRNAAHJH7kKHy406yVT/w4ydo+u7K06SnGOWTncyS3yurksQ32KqEtB0GqWVchFgbJcrnkN7s8qod4TV28zomaq2G4/3DM2z8AYkiO9UNQnoGWFVglu4PRhgFQEEwKpwFGlMzZiTTfVWM/ZWXVvBpb/IUKTftwT0ZF2T4MqNXYW5gfQBu9oiAmBd5AoxaJ0JbjBjZ6jaGC9vKCQAuXQqwZUbu6+aUQl3Lh3Sie0EEADbI5S1fU8y6hNhbYMa3YNP/VmztqP9Z+qKhFuCLqG3wyKsKIwAAlAY+sI7llSA5Hy+bsYO47n+woORuwESdAk9GaHcwffuMO+jCEDexC3pT5IAkgog52NJOAoxg4xQIdit6hQBsCoceRgjN/5y+y9JAEkF5NEffdhNQE4DORnklNiN743ZHaksrEMAsqBqaZvkfCwNzKxZBS4lI/TvZvRNYUVOkgLNoOucCSAAOQMvrDtyPoWhd6Tj5Tp4t65LYvAFRjtiMmYOSwABGJag/fXl1l5u8OU2X2727bcWC4slICfJF83oB8MROW2KtYTecyCAAOQAOV4X2ZR6ptFfMKNyg59N87RaQgJa66P0yOWmLidPCd3DpTYCCEAbjNKtHmOqVxse8C9dXHNx6Fm6IifP0YaXAOaCu6BOEICCwGfc7TKjLja1c/lmb8acy938mNbvV3U5keR0KrenhXtXlAEIQFHkM+z3uSb4NzN6iOJnWzKE7E/TciLJ6SQnlT8u++MpAlCuWBtzgqlcZeq816FccS3YGzmd5KQ6nnRQwXFIv3sEIH2mRbW4k1GfMfV3qfqI5jG+ooIwUL8uVJKT6pzpdJCcZi7Yi42xCCAAsTDZX+iPjf6qGX2RJu1jf6wctlDSQXKaycnmsA+Y3kYAAWiD4eiqMW8z1SvM6O68ztPRCDpltpxmcrKdaqqK3xVwKnBdjUUAumLJc+dQfa2aTvucrmoV0j5DgaRyAgJysv2Nqkm+UU6/BNUoah8BBMC+mMS26GlGXaNI+8TmRcFUCUi+8RozugevkEuVas6NIQA5A0+tu+eG+ipJ+ygimBpSGkpKQNJBV5rRvUMeOkhKbrZ80UsuH0VHYKD+9zHBv6rRXUn6D0SPSikSWKWDDWp0neFKkiLU/JoibPmxTqunV5hA0q9jJP3TAko7wxFYpvWnTf1wNGA4jIXURgAKwT54p68zlQtNvc7Vf3CE9tQsjyVyQn7M1HlxkHMRRQBcCtnbTPU8JWONlKtLUfPEVj394qCTDd9EcSngCIAj0TLmH8KR01XNEXMx01MCZ6jaueEIXxFwJfwIQGGRit9xzZhPqPrr9Uj8KpSEQFEEjtEjkg6Sk7YoA+g3PgEEID6rYkqOGvMZM3oYr/YsBj+9DkLgCF2VaeExvio8CLxc6yAAueJO2tlKo/5Vje6r+VGOpOQoXzCB/XR1gxrdla+JdY+DLXsRAFsisdiONUZdZUafp7j6L2bDHgcIrFWVK83ok9AAi2OFAFganGca/SXFrzlaGh3Mikng6TqQDzHPNjy3FhNY3sUQgLyJx+lvZ6MuMfXdec1DHFgOlvHK5N11cJGpyyntldeuOIsAWBepHYz6Z1V/Gq95sC4yGDQggT108GlVlxN7wPpUy4wAApAZ2oEarhgjn/33Ju8/ED0qWUtA5gMuNjU5va210E/DEIDc4750h9qYD5v6Op75WRoRR9wlsL+uftDU5CR314XyWY4AWBTTd6naq/hNR4sCgikpE3iNHpGTPOVGaW4IAgjAEPBSrXqSqR6v+K5vqkxpzD4CcpLLqW6fXTlZZFs3CIAVETnCVM5UvOfHilhgRNYE5FR/teHbLVljjtU+AhALU6aFXmIqHzZc/TNlTON2EZDJgINDLj7FB4UYFByD54X6QlOrar4pU3Ag8uiePmYJyAn/CVXfO+S0nyVS0BIBKAj8dLfPNPqfVX2Uq/80Df54RUBO+0+r+rP4knChUUcACsO/OlSfVfVd+MJXYRGg44IJyMn/GVWXgVCwHR53jwDkFvyOjqrG/JOur+FlDx1U2PCOgAyBi3V9hBdHFxR5BKAY8GepGl/3LQY9vVpGYK2q/C2PwBUUFASgAPAvDYPjeeS/APB0aSkBGQ6HlPuhIEvBk4LIPTBPNup8Pu/kjp0OLSdwnqrJ0LDcyPKZF5TPJZs9ktT/haq+ExO/NgcJ24ogIIPiE4rJgLzRIwC5Eif1nytuWzrDjlgEmAyIhSnVQghAqjh7NkbqvyceDkJAyWTAfoaLksrtH6xzQi35TVL/ObGmG5cJXGBqu/EzwnlFEAHInLR0oI0h9S8c+A8CfQms1oFogAyZviUpMDwBBGB4L+4AsgAAEABJREFUhv1b+Gue+u8PiRIQiAjsr6syZKINFlkSQACypDvd9joTnGqq06v8gQAEYhGQIVOKyYBYzhZYCAHIFv4qoz5qagGve8sWM62XjYAMGUkEMRmQdVwRgAwJSx5Trv678dR/hoxpurQEmAzIIbQIQIaQJY+5H7/xmyFg25vGviEJMBkwJMC+1RGAvogGLLCn0W8h9T8gPKpBICIgg2gvfjMggpH+AgFIn+lMi+81I3VS/zMs+AuBQQnIIHqPGRm0NvX6EEAA+gAa7PDhJtiP5M9g7KgFgU4CkgiSAdW5j610CCAA6XBsb2UHo84ytfY9rEMAAsMQkAElw2qYFqjblQAC0BXLUDtPNtXdefJnKIRUhkAHARlQMqw6dtm94Yp1CEDKkZK53+P5sZeUodIcBJQMK2aDVdr/EICUiTL3mzJQmoPANAGZDT6H2eBpFCn+QQBShKlkqooH/9ME6mhbmJ0NgRfr6stCLllpwoVmajRlkkqmqlJrjoYgAIFFBP5e1WSgLdrNjgEJIAADgltcTSapZKpq8X72QAACaRGQISYDLa3WaAcBSOccaJv7TadBWoEABLoSYDa4K5bBdiIAg3FbWIu534VE2IZANgSYDU6RKwKQAkzmflOASBMQiE3A3tng2C5YUhABGDYQMiXF3O+wEKkPgYQEmA1OCKx7cQSgO5f4e/9c8b3f+LQoCYF0CMhssAy9dNryuBUEYKjg1435C773OxTCMlXGl1wJHKeqMgBz7bJ0nSEAQ4X0SFNdrfRQTVAZAhAYiMAaFcgAHKgqlSICCEAEYoBFxZgT+fg/ADiqQCAlAjIAZRim1JiPzSAAg0f91aq6Z9tbPwdviJoQgMBABGQAvkJVBqpKpe0EEIDtFAb535i38mqqQcBRBwJpEvhLuQs3Js0WfWoLARgw2i8zFfn0MWBlqkEAAikReJ6qyGBMqbGBm3G1IgIwYORO0iMD1qQaBCCQKgEG48A4EYBB0O1rgueTeRyEHHUgkD4BGYwyJNNv14MWAw98TN/Ft5hq+o3SYieBlV++orLn0zv3WbqFWYUTYEgOFgIEIDG3/2X0i/j4nxhb4gqjhx265vt3LF9/lqrVElemgmcEZEg+N+QbOYmjjgAkRvY2NaI1p1piboNUqNeXn32myMDoKw8dpDp1vCGgtf4rxbRc4ngjAMmQ7WHUS03nc8fJGqB0YgKVvfZcefUV2zNCT/6DxJWp4A2Bl6vK0w2fzJLFGwFIxusUw8f/ZMTSKi0ZodX33LnjO04jI5QW0pK1U9X6RMXkXLKoIgAJeK02+k85wxIAS7moXrZsxbnrJSNUO/CAlJumuVIQeI2prg5z9cT1zhCABBE8RlXlU0aCChTNgIBkhFbdeO0uGy6rkBHKAK/TTY5pfQxf0EkSQgQgAa3DDbgS4Mq06NhRr4kyQhWmZDIl7VjjDNJEAeOKFhfXc4zeS3OtiYsrh3IzGaHVd99eWEYoByfpIiEBGaQyVBNW8rc4AhA39q8l+x8XVa7lqs959kxGKFizOteO6cxWAgzV+JFBAGKxqhpzBE9/xkJVTCHJCK25564dTn2LIiNUTAQs6vVwGaq8HzReQBCAWJz2V5VVegGrWBUplBsBvWL5Th/+wPaM0L5/klundGQhgd10sC/f1Y8XGC5qsTht/0wRqyCFCiawPSN06/U7X3ohGaGCI1Fo96+Vm4BCDXClcwSgf6SWGfVyJgD6c7KmhNbLjjuWjJA18SjAkENVZYdMfySmAJ8y6RIB6I/1JSrYQfMV8/6grCpBRsiqcORszI46OEgFOXfqYncw6h+1I/j43x+SpSXICFkamOzNYtjGYYwA9KG0q1EHkk/sA8nuw+0ZoXTu5Oz2F+umCciwXUUWaBpFjz8IQA842w+9ylRGuGpsJ+H2/zMZod3uuLnGM0JuRzKu9TJsX8ZHt360EIA+hA7XvF+wDyKHDo+8YO2qmWeEVu7ikNmYOhgBskB9uSEAvRA91ai1i97/06sCx+wnMJ0RWn3PXctOOM5+Y7FwGAL7qGAPskA9CSIAvfAcqeQ+kud/eiFy9Fiw68qdL/ro6u/dQUbI0QjGMVtr/WrFz4T1QoUA9KLzUj7+98Lj/DGeEXI+hP0cSHsI9+vPteMIwJIRW2HUc3iUeEk8ZTkwnRGKvjWmudsrS1hn/fhDFexEFmiWxuIlArCYSbRnHxNozRUholHuBc8IlTW+Mob/xHCVWzK8oFkSzb6at/8vCaeUB0b6PSNUSq9L7xQDuUeIEYAl4cgdwJLHOFBWAtMZoegZIe7/ShFlBnKPMCIA3eEwAdCdix97Z54R2u2Om0eev7cfHpfZS6YBekQXAegORz41aN05AdC9IHtLS0AyQqIBO33s/GAl3xpzOMpMA/QIHgLQHQ55w+5cfNsbBDucdGKUEfLN9xL5y3BeKpgIQHcycgfQ/QB7/SMwkxFadev1ZIQcDf7ww9lRx/uajQB0QcQEQBco3u+qrdtnJiOkl+/oPQzHADANsFTAEIAuZOTzgtZMAHQh4/uu6YzQmnvuGjv6KN9ROOU/0wBLhQsB6EKGjGEXKD7v6vQ9eNKaXT57iWSEqn/4rM4jbNlLgEHdNTYIQBcscgfQZS+7INBGQDJCq+++fcV57yUj1EbF3lUGddfYIAALsTABsJAI20sRqFZ3PP0UMkJL4bFqP9MAXcOBACzEIp8UtG6fAFhYgG0ItBOYyQjtesM1ZITasdi2zjRA14ggAAuxkCtcSITtGATqB70oygiNjcUoTpECCDC0F0NHABYyeTHvDlyIhO14BKYzQqt/+K3RVx8erwKlciUgN/eJ+yt7BQSgI8KBMWv4DYAOJGwkI1B56lNWfuFyyQhV9nx6spqUzpjAUxSp3YWIEYAOIrsrvQMTAB1I2BiEQP2gF635/h3L15+lyQgNwi+TOit0sBs/DtOJFgHo4PEUPv538PB8Yzj36/XlZ5+5+p47R1956HANUTs1AnsxwDtZIgAdPPY03CR2AGFjSAKVpzx55dVXrPzyFZUn/8GQTVF9eAIM8AUMEYAOIM/QAOkAwkYqBEYPO1RuBXZ8x2mqVkulQRoZjAADfAE3rncdQNqniToOsAGB4QjoZctWnLteJgZqBx4wXEvUHpwAA3wBOwSgA8hepIA6eLCRMoHKXnuuuvHaXTZcRkYoZbLxmmOAL+CEAMwDCYzZgzmieR6sZUVg7KjXRBmhSiWrPmi3GwEZ4DLMux1ZsM+XTQRgPtJPV0GFZ0DnebCWIYGZjNDqu28nI5Qh5UVNywDfnW8DtGFBAOZhcHs4z4K1XAhUn/PsmYxQsGZ1Lh3SiXoGd/ltZwECMA+DCaJ5Fn6v5ey9ZITW3HPXDqe+RZERyh49n/PaGSMA8zT20tCYp8FangT0iuU7ffgD2zNC+/5Jnv162BfDvD3oXPLmaezFa+DmYbBWAIHtGaFbr9/50gvJCGVHn2HezhYBmKcRpYDmd7AGgdwJaL3suGOjjBCPJGSAn2HeDhUBiGgsM+pJPB4QwWBRMIGZjNBud9xcIyOUdihkmO/IK+FmqSIAEYk9lK5oXgQU0WBhA4GRF6xdNZMRWrmLDfaUwwYZ5k9d+qNeOXyM7wUCELHajXMiIsHCJgLTGaHV99y17ITjFB9QUooMg30OJAIQoVgeLVlAwDoCwa4rd77oo5IRGnn+3tYZ56BBDPa5oCEAEYq6Iv8TofB3YbfnIy9YKxqw08fOD1aSERoqVAz2OXwIQISixrxQRIKFxQSCYIeTTowyQhabablpDPa5ACEAEYqdSLBGJFjYTmAmIyTzw2SEBgsVg32OGwIQoVhuohUWEHCCQG3dPjMZIb18RycMtsfI5dzuzwYDAYhI1LkDiEiwcIfAdEZozT13jR19lDtGF28pg30uBghAhKIeLVlAwDECwZPW7PLZSyQjVP3DZzlmekHmdhnsBVlSeLcIQBSCFfwWWESChZMEJCO0+u7bV5z3XjJCfePHYJ9DhABEKHg0OALBwl0C1eqOp59CRqhvAOs88j3LCAGISNT5HkBEwsNFqVyeyQjtesM1ZISWiiuPgc6RQQAiFHwoiECwKAWB+kEvijJCY2OlcChNJ1bwxMcsTgQgIrGCJ8MiEizKQmA6I7T6h98affXhZXEpHT8Y7HMcEQA1w2I5KaAZEPwtF4HKU5+y8guXS0aosufTy+XZ4N6Q751jhwBEKOrRkgUESkhAMkJrvn/H8vVnaTJCStVKGOEBXUIAInAr+EHgiASLkhKo15effebq79w++spDS+phXLdWzd/ux61S1nIIQBTZpmESIELBoswEanz8VRNlDnAy3xCAiNcWhQBEKFiUk0CzufW8Czat3a9x49fL6WBsrxjsc6gQgAgFHwoiED4t/PG1eds3N77wgK3nnm/Gx/3xeilPGexzZBCACEWTO4CIBItSEWj9+oHNxx7/6GGvbd13f6kcG8IZBvscPAQgQrGFb4dHJFiUhcDU1O8/cfGm5+/fuO76sriUjh8M9jmOHgvAHIPplS1MAk9z4E85CEjOZ9M+B245+z3kfBYHlME+xwQBiFBMcAcQkWDhNoHwtxsfO+GtkvOZ+unP3PYkM+u3Ztaycw0jAFHImjwEFJFg4SyB6ZzPxrXrxr94tbM+5GF4U5k8unGhDwQgitIWjQJEKFi4SGDirrujnM/W37tof542N7ndn8WNAEQkSAtGIFi4RmAm5/PIwYeT84kZOgb7HCgEIEKxlQ8FEQkPFqVxMQyfuPQz5HySxpPBPkcMAYhQ8CqICAQLRwhIzufhAw55/O1nGXI+CUPGYJ8DhgBEKBrRkgUEbCcQPrr5d6eeITmfyR/+yHZbrbSPwT4XFg8FYM73jpWtTAJ38GDDSgLTOZ9Na9dt++wGK+1zwygG+1ycEIAIBY8GRyBY2Epg8gf3zOR8ws2P2WqjG3Yx2OfihABEKJrRkgUErCMwk/ORqz85n2FjM13/cV78Nc1B/iAAAmH7fw+ocPuC/yFgFQFjtm34QpTz4W0lKYXmEQRgliQCEJF4SJkWAyyCwcIKApLzkZne3510GjmfFOMhw1wGe4oNOt0UAhCFL9T6l9wERDDKunDGL7Nl6+PvPEdyPhPf/o4zRjtiqAxzGeyOGJu5mQjAPOJf8CDQPAzWCiIwnfPZuHbdExd9SnFLmkEQGObtUBGAeRoPkBmch8FaAQSmfnJvlPPZuKmA7v3okmHeHmePBKDd7a7r/98wD9wVDDszJzCT89m0z4HkfLJmzTBvJ4wAzNO4jxTQPAzW8iMwfvVXopxPq5Vfr772xDBvjzwCME/jASaB52GwlgeB7TmfVx752HFvDsn5ZMt7vnWG+TwLpRCAeRoP8SToPAzWsiVgtm3bsv7c7Tmf2+/ItidabyPwhDEyzNt2+L6KAMyfASFPgs7DYC1DApLz2bR2v99/5EJFzidDzF2a5hnQBVAQgA4gPCLWgaMsG4uyWwgAABAASURBVPb40frFfY9M53xaD/7GHqv8seQ3zPN1BhsB6ODxAE+CdvBgIzUCMzmfjS88YIKcT2pQEzfEI0ALkCEAHUA4PzpwsJESgcYNX49yPhMTKTVJM4MQ4BZ/ATUPBGCBxz03eUSsJx4OJibQeuDBzUe9cfPr3kjOJzG7DCo8yC1+J1UEoIPHAzwJ2sGDjSEINJtbz7tAPvg3bvz6EK1QNU0Cv2CAd+JEADp4PKTMVr4P3IGEjUEING/7pqT7t557vhkfH6Q+dVIi0N7MFhM+rNt3sM73ADrPgVDrX3OT2MmErUQEWr9+YPOxxz962Gtb992fqCKFsybwAEN7EWLuABYiuVvzRqCFTNiORWBq6vefuHjT8/dvXHd9rPIUypcAQ3sxbwRgIZNvG97HspCJq9s52i05n037HLjl7PeQ88mRerKuGNqLeSEAC5l8R4ch72FfSIXtJQmEv9342AlvlZzP1E9/tmQhDhRNwBjDHcDiICAAC5k8rtVPeVRgIRW2uxGYzvlsXLtu/ItXdzvMPosI/ESFW5gBXhSQEgvAIl9j7+CTQmxU/hacuOvuKOez9ff+UnDHcwZ111ghAF2wkCvsAoVdswRmcj6PHHw4OZ9ZJA4sGdRdg4QAdMHCNEAXKOwSAmH4xKWfIecjJGz/r9M+JgA6ecxvIQDzLObWmAaYQ8HKHAHJ+Tx8wCGPv/0sQ85nDoojK0wALBUoBKA7GTKG3bl4uTd8dPPvTj1Dcj6TP/yRlwCcd5rhvFQIEYDuZMgYdufixt70rJzO+Wxau27bZzek1ygt5U2A4bwUcQSgOxmmAbpz8Wnv5A/umcn5hJsf88nvsvnKBECPiCIA3eEwDdCdix97Z3I+cvUn51OCgDMB0COIJRSAHt4mOkTeMBGukhQ2ZtuGL0Q5H74QXoqgMpB7hBEBWBIOecMl0ZT0gOR8ZKb3dyedRs6nTBFmIPeIJgKwJBymAZZEU7oDZsvWx995juR8Jr79ndI555VDC51lAmAhkc5tBKCTR9sW0wBtMMq7Op3z2bh23RMXfUqR8yldnJkA6B1SBKAXn28qXg3di4/rx6Z+cm+U89m4yXVfsL8rgVv4eY+uXGZ3IgCzJLotr9cIQDcutu6Lb9fMcz6b/vgAcj7xoblY8mtqykWzc7MZAeiF+ifa/De/D9OLkIPHpnM+0XM+DpqPyfEJyOD9hTbxy3tYEgHoE/Rr+QTRh5BLh3nOx6VoDW0rg7cvwhIJQF9fByrwVd0yzA0OhM6qSjznY1U4cjBm0ph/I4XbDzQC0IfQo1rdzQ+E9YFk92Gz/btdPOdjd5DSt+5O1drMT4D144oA9COk1DWaeaT+lOwswXM+dsYldasWN8gTHIuZLN6DACxmsnDPTar1BFmghVRs357J+Wza50Ce87E9VBnYt82YG5m9iwEWAegPaZtWt/GFAOXOv/acT4sHed0JXHqW3qSmxjUJoP5AEYD+jKQETxMLBHv/a7OMnE8bDH9Xyf/EjD0CEAvUbbr1iAljFaVQQQTI+RQE3rpuHzXht7hljxcWBCAWpymtv8YjZbFQFVNo/OqvRM/5kPMpJgIW9fpV3ZIBa5FBFptSAgHIiS5ZoJxAJ+xme87nlUc+dtybQ97nkxBdWYtfw/Rv7NAiAHFR3aPCX5EFiksrj3Jm27Yt68/d/pzP7Xfk0R99uEDgv03rJ7z+IXakEIDYqLS+jixQbFpZF5Scz6a1+/3+Ixcqcj5Zs7a5/UW23cAgXcSkxw4EoAechYeuVZO8FmIhlNy3W7+475HpnE/rwd/k3jkdWk1Ahuf15H+ShAgBSEDr11rxeqkEvNIuOpPz2fjCAybI+aTNthztyfB8gKf/k8QSAUhCS6l/0lPyKSNZHUqnQaBxw9ejnM/ExGx7LCEwT0AG5sV6cn6btRgEEIAYkNqK3K/NLSQZ24DksCo5n81HvXHz695IzicH2u52IQPzl3z8Txg/BCAhMKUuMswEJIY2YIVmc+t5F0jOp3Hj1wdsgWp+EJCP//+o+PifONgOC0BiX1Oq8OPAfJPvGaYEs0czkvORS//Wc89X5Hx6YOLQNAEZkv+Ppz+nUST6gwAkwhUV/hQviI5IZLjYnvO57/4MO6DpEhFgSA4WTARgEG7f1uEPuQkYhBx1IJAKgY5GZDDKkOzYxUY8AghAPE6LSl1qSDgugsIOCBRBgME4MHUEYEB039Ct+3gzxIDwqAaB1Aj82LRkMKbWnGcNIQCDBlzrS3joeFB4Q9ajOgTmCHxahqHm8c85HslWEIBkvNpLX6emuAloB8I6BHImIAPwJmbjhoCOAAwOr6X1Z3j0eHB+1ITAsARkAMowHLYVj+s7KAA2RetaPbVRhTZZhC0Q8IXAJmVkAPribTZ+IgBDcW1qvYG3Dw6FkMoQGJDAZWZCBuCAlak2TQABmMYwxJ/Pq6mHeBxoCIBUhUB8AnMlZdB9ibdyzeEYdAUBGJTcbL0ntDpf837KWRwsIZALARl0MvRy6arMnSAAKUT3eh1+y0yl0BBNQAACMQjcaaZk0MUoSJE+BBCAPoBiHn6vnmwaE7MwxQYkQDUIKCUD7T2a7+GncyogAOlw/IU2l/NIaDosaQUCvQjIQLuPF3/2IpTgGAKQAFbvov+kmQ3uTYijEBiWgMz9ykAbthXqzxJwSABmTbZ1KVNSMjFlq3XYBYEyEHifmpCBVgZP7PABAUgzDjIxxWxwmkBpCwJtBP7TTH0j4HuXbUSGXkUAhkbY2QCzwZ082IJAGgSm537fz9xvOiznW0EA5lmkssZscCoYaQQCCwgw97sASCqbCEAqGDsakUkqmarq2MUGBCAwBAEZUDKshmiAqt0JIADduQyzVyapmA0eBuCiuuzwnQBzvxmdAQhAJmCZDc4EK416SYC53+zCjgBkxZbZ4KzI0q5PBJrGMPebXcAdEIDsnM+0ZWaDM8VL454QYO4300AjABni/Yie5GsBGfKl6bITuNNMySAqu5dF+ocAZEjfaH2mntjErwVkyJimS0vgYROeoSdkEJXWQwscQwCyDcLDWokGZNsHrUOgdARCY87QE4/o0jlmmUMIQOYBuVOHksfMvBs6gECJCFymJu/SYYkcstQVBCCPwHxITdyjWnn0VK4+8MZPAj9SrY/z1odcYo8A5IF5UuvTVfNxJgPygE0fbhOQYXKaak5psj95xBEByIOy9PGgVmcrfjpYSPAfBHoROEtNyGDpVYJj6RGwWADSc9KSlm4OQiYDLIkFZthJQAbILbzwOcfYIAA5wlaKyYBccdOZUwQk9X++4i4515ghALniZjIgV9x05g6BBal/dwx321IEIO/4SX7zPZqPOXljpz/LCZD6LyRACEAB2K/X4TVmsoCO6RICVhIg9V9UWBCAYsj/vZ7gNUFLoueATwRkIFxA6r+giCMAxYBvan2KnrjXtIrpnl4hYAcBGQIyEGQ42GGOd1YgAIWF/AmtTlTNjSoszAI6hkChBOTklyEgA6FQK7zu3EIB8Cgem4LtGvAY3xD2KOa4GhGQ016u/jIEom0WRRBAAIqg3tbnz7T5K9VsGNO2j1UIlJyAnPBy2svJX3I/rXcPASg+RD8KzOmqGRo0oPhYYEEOBORUlxNeTvsufbErXwIIQL68l+jt1iB8Hw9CLAGH3SUjIKe6nPAlc8pRdxAAWwJ3RdD6pOLLAbaEAzsyIiAnuZzqGTVOs0kJIABJiWVY/kI9+RWvvyCWIVuatoHA59WknOQ2WIINMwQQgBkOtvz9Oz1xi5qyxRrsgEB6BOTEluRPeu3RUgoEEIAUIKbYRGv6p2P4+bAUkdKUDQTklJaJX37h3YZYtNtgkQC0m+XzelPrv1LNX/LlAJ9PgnL5fq9pySktJ3a53CqDNwiAjVH8nVYn6sZGviRsY3CwKRkBOY1PVE05pZNVo3QuBBCAXDAn7+RXWr1ONe7nPiA5OmrYQ0BuZI9SjRhf97XHZL8sQQDsjfdvtTpGNyR5aq+JWAaBpQn8X9V6g25s1EuX4EjRBBCAoiPQs/9HtTpONf5D8dLQnpg4aB+B28zUn6nGZq7+9oWm3SIEoJ2GjevjWp+sGl8zZX421Ebu2DQEgRvU1Em62dBc/oeAmEtVBCAXzMN10tL67br5acMPSQ7Hkdq5EPismjxdNUPN1T8X3MN1ggAMxy+32lqfH0x9UE0Y3hmXG3M6SkhATs4PmOY/6EnF1T8huqKKWyAARbnuYL//rKfkVmAKDXAwdqU3uWXMabp5ecB8lUuhRgBcipbYer0OT9ET29AAYcF/1hAYN0aS/jdpft7OmpDEMwQBiMfJplL/oVvHqcYjhsFmU1Q8tuVRE/6Zatw+0NXfY2xWuI4AWBGGpEb8KDDH6MZDaEBScJRPm8BDKnyDbvw4MGk3THt5EEAA8qCcRR+/1EoG3k8NKdcs6NJmLAI/M63Xq8aveN4nFi0bCyEANkYlpk3TXxVu3uju66Nj+kkxKwncrKZer5t80dfK4MQ1CgGIS8rOck9odZqeeJdqyiycnRZiVfkIyMn2btXc/jACn/2V2/8QALfjN2P9l3Tr9bpxH1MCMzj4myWB7e93040vanKPWVLOq+0CBSAvF/3o515tjtQN0kF+RLswL79iJv9UN36umfItLATpdowApMuzyNZIBxVJv+x9N4w5UzXfGUxuI+1TolgjACUK5rQrpIOmMfAnTQKS9nmtblyXYtonTetoa3ACCMDg7KytOZMOutpMWmshhjlEgLSPQ8FKaioCkJSYG+UlHfR3weRZPB3kRrgstZK0j6WBSc8sBCA9lva1dI2lTwfZRwqLFhH4mWmR9llEpWw7EICyRXSBP6SDFgBhMw4BSfvI1Z+nfeKwcroMAuB0+GIZP5MOOk41fs57I2IB87qQnCRyqrwzmGzyTn8PToQCBMADqja6eJcOX6Ub7zfNrXxfzMb4FG+TnBgfME05SeRUKd4aLMiFAAKQC2Y7Omlp/bmg9XLduMFM2WERVlhBwBhzjZmUE+PyoCUniRU2YUQuBBCAXDDb1MnDWp0eTMhtvtzs22QXthRDQE6Do3XjrGBSTozsLaAHuwggAHbFIzdr5DZfbvbJCOUG3MKO5nI+P9C82sHC+ORhEgKQB2U7+5CbfTJCdoYma6vI+WRN2JX2EQBXIpWVnXLjn1tGKCsfaDcJAXI+SWiVvCwCUPIAx3SPjFBMUE4XI+fjdPiyMB4ByIKqk23OZIReohsXm4ktPCrqZAyXNPoxE35STUpwec5nSUZeHshRALzk65zTj2v1sWDqIN34kJp4GBlwLn6LDJYgXqAmDtTjF+pJCe6i4+zwmgAC4HX4l3J+q1aX6amX6PH1pvkrZGApTHbv/7UJ/940JYiX6qlxvtZrd7CKsg4BKIq8A/02tb4yaB2ix09XjZ/wGgkHIhaZKME6QzVfpse/ELQkiNHeQhd0bicBBMDOuFhkVaj1DTr806AzRdxbAAAITElEQVR5smn8SLUssgxTFhH4rmm9WTUkWF/VLQncouPsgEAHAQSgAwcbPQh8IwiP0s0/V43/4k0SPTAVdOhbZuoYNX5s0LxNhwWZQLfuEUAA3ItZsRZ/W4fHBxNHmvEb1VRoTCxjKJQZAQnBv6spCcebgonvacKRGeiSNowAlDSwGbv148CcpideoRtXmclJZCBj2l2bF+xfNpMSgrfpCQlH1zLshEBvAghAbz4c7UXgPm3OCSb/SG87Vo1fqaZ+Z0g+9MKVyjGBLKj/TI0L9rODSQlBKs3SiJ8EchAAP8H65LXW39VmvZ7YX4//tWncrKYmuCdIO/4NY25QU281DYEsqL8j2R6e7EwbsoftIQAeBj0rlye1vikIT5lWgner5t2mZVACNdQ/ASgY16uJdXr8dD1xSxAKZMU/CKREAAFICSTNtBF4XKsv6tYbg+aL9fiH1MRPDQ+PttGJtyrQPqwmBKBgvFJPPaHjVbOtFPbYTQABsDs+jlv32+lvFL8qaB6uxi8xE79hkqBfQAXRpWZCcAm0T+kpAdivBschMDgBBGBwdtSMT+Bn2nwkmDpQjx+hxt9rmpLOfhgxmMUnKASIYHmVGhdEFwRTgmv2IEsIZEgAAcgQrvdNLwKg9b3afD5oSTp7/6DxMrXtHNW81kw+6J8YiMviuLh/iBoXFAJEsPyUqd1Fpww7MiWAAGSKl8Z7EfilVlfp1t8GkwcFjQPUtjNV80ozeV95xUBc+6KZfKdqirPisjgu7t8vF/1ekDgGgQwJIAAZwqXp+AQ2anWdbq0PJg8NGvuqbaepxhVq8geq9YTLzxFtNaG48Dk1+Taz3Slx7d3B5Fd0S5yNT4aSEMiOQIYCkJ3RtFxuApu1ulGH/0dPvkE3nx+Mr1PbjlHjZ6umzI7erKZ+blpN+1RBTBLDxLxPmYl3qeaxanw/te2FQUNceL+e/PcgFKfKHTW8c5EAAuBi1Pyy+VGtvqfNl3VLZkdP0ROHBc3n6W0HqW0nqMZ7TfNf1OR/mqlfmzDMSxWkI+lOOpWu32eaJ6rGS9Q2MUkME/M+HEx9Sbe+q80jPLjp13nqpLcIgJNh89xoo/WDWt2hQ5k4PVdP/mUwcXDQeLbe9sdq24vVtiPU+NFq/M2q8Teqsd40P6QmLjITG9TkNWbyG2rqTjP1Y9O634SPTk82yCd3WZFN2SmHpIAUk8JSRSpK9berpjQltyDS7IFqexfSkXQnnUrXG4LWN3X4gFZikudB6XSfLTcIIABuxAkr+xPQeotWD2l1rzbf1+Y2HV6vwyuD1mV66uPB1Pv05FnB5Ml64i+CiSOD5iFBY13QeKbe9lxJMQUN2ZSdckgKSDEpLFWkolT/mm5JU3ILIs3+RivpQvEOhv7BoIQbBBAAN+KElRCAAARSJ4AApI6UBhUIIAABJwggAE6ECSMhAAEIpE8AAUifKS1CAAIQcIJABgLghN8YCQEIQMB7AgiA96cAACAAAV8JIAC+Rh6/IZABAZp0iwAC4Fa8sBYCEIBAagQQgNRQ0hAEIAABtwggAG7Fy25rsQ4CEHCKAALgVLgwFgIQgEB6BBCA9FjSEgQgAAGnCKQoAE75jbEQgAAEvCeAAHh/CgAAAhDwlQAC4Gvk8RsCKRKgKTcJIABuxg2rIQABCAxNAAEYGiENQAACEHCTAALgZtzsshprIAABJwkgAE6GDaMhAAEIDE8AARieIS1AAAIQcJJACgLgpN8YDQEIQMB7AgiA96cAACAAAV8JIAC+Rh6/IZACAZpwmwAC4Hb8sB4CEIDAwAQQgIHRURECEICA2wQQALfjV6z19A4BCDhNAAFwOnwYDwEIQGBwAgjA4OyoCQEIQMBpAkMIgNN+YzwEIAAB7wkgAN6fAgCAAAR8JYAA+Bp5/IbAEASoWg4CCEA54ogXEIAABBITQAASI6MCBCAAgXIQQADKEcd8vaA3CECgFAQQgFKEEScgAAEIJCeAACRnRg0IQAACpSAwgACUwm+cgAAEIOA9AQTA+1MAABCAgK8EEABfI4/fEBiAAFXKRQABKFc88QYCEIBAbAIIQGxUFIQABCBQLgIIQLnima03tA4BCJSKAAJQqnDiDAQgAIH4BBCA+KwoCQEIQKBUBBIIQKn8xhkIQAAC3hNAALw/BQAAAQj4SgAB8DXy+A2BBAQoWk4CCEA544pXEIAABPoSQAD6IqIABCAAgXISQADKGdd0vaI1CECglAQQgFKGFacgAAEI9CeAAPRnRAkIQAACpSQQQwBK6TdOQQACEPCeAALg/SkAAAhAwFcCCICvkcdvCMQgQJFyE0AAyh1fvIMABCCwJAEEYEk0HIAABCBQbgIIQLnjO5x31IYABEpNAAEodXhxDgIQgMDSBBCApdlwBAIQgECpCfQQgFL7jXMQgAAEvCeAAHh/CgAAAhDwlQAC4Gvk8RsCPQhwyA8CCIAfccZLCEAAAosIIACLkLADAhCAgB8EEAA/4pzMS0pDAAJeEEAAvAgzTkIAAhBYTAABWMyEPRCAAAS8INBFALzwGychAAEIeE8AAfD+FAAABCDgKwEEwNfI4zcEuhBgl18EEAC/4o23EIAABOYIIABzKFiBAAQg4BcBBMCvePf2lqMQgIBXBBAAr8KNsxCAAATmCSAA8yxYgwAEIOAVgTYB8MpvnIUABCDgPQEEwPtTAAAQgICvBBAAXyOP3xBoI8CqnwQQAD/jjtcQgAAEFALASQABCEDAUwIIgKeB73CbDQhAwEsCCICXYcdpCEAAAooUECcBBCAAAV8JBEr56jp+QwACEPCbACkgv+OP9xCAgMcEEACPg4/rEICA3wT+BwAA//9BHgx4AAAABklEQVQDANioYcRiBqqPAAAAAElFTkSuQmCC";
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
        orientation: "portrait",
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

function appPage() {
  return new Response(APP_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
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

  if (url.pathname === "/api/relay") return relayHandle(request, url, env);
  if (url.pathname === "/api/sub") return subHandle(url, env);

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
  if (!ttl) return handleApi(url, env, request);

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

  const res = await handleApi(url, env, request);
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
    if (path === "/api/admin/state" && !isPost) {
      let notice = "";
      let homeMode = "builtin";
      let noticePri = false;
      try { if (env.BOT_USERS) noticePri = (await env.BOT_USERS.get("cfg:notice_pri")) === "1"; } catch (e) {}
      const stats = await activityStats(env);
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
        homeMode,
        noticePri,
        stats,
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
      body = await request.json();
    } catch (e) {}

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
    return json({ error: "server error" }, 500);
  }
}

// ============================================================================
// 15. WORKER ENTRY POINT
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // The Mini App and trailer player must open from this Worker's own https address
    if (url.protocol === "https:") {
      ORIGIN = url.origin;
      APP_URL = `${url.origin}/app`;
    }
    // Set APP_BASE_URL (Worker variable) to https://boa-cinema.onrender.com so bot buttons open the Render site
    if (env.APP_BASE_URL && /^https:\/\//i.test(String(env.APP_BASE_URL))) {
      ORIGIN = String(env.APP_BASE_URL).replace(/\/+$/, "");
      APP_URL = `${ORIGIN}/app`;
    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: ADDON_CORS });
    if (url.pathname.startsWith("/api/admin/")) return adminRoute(request, url, env);

    if (request.method === "GET") {
      const addonRes = await addonRoute(request, url, env, ctx);
      if (addonRes) return addonRes;
      { const pw = pwaResponse(url.pathname); if (pw) return pw; }
      if (url.pathname === "/" || url.pathname === "/app") return appPage();
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
