// Boa Entertainment Bot - Cloudflare Worker (v91: Nuvio-style Media Servers & Plugins, Nuvio-style Boa Cinema, worldwide "Where to watch", library, caching)
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

const ACTIVE_DAYS = 30;
let usersCache = { n: null, at: 0 };

async function trackUser(env, userId) {
  if (!env.BOT_USERS || !userId) return;
  try {
    const key = `u:${userId}`;
    const today = Math.floor(Date.now() / 86400000);
    const last = await env.BOT_USERS.get(key);
    if (last !== null && Number(last) === today) return; // already counted today, no write
    await env.BOT_USERS.put(key, String(today), { expirationTtl: ACTIVE_DAYS * 86400 });
  } catch (e) {}
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
    const out = [];
    const picks = await getPicks(env);
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      if ((p.media || "movie") !== media) continue;
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
      out.push(card);
    }
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
async function fetchPluginStreams(env, tmdbId, mediaType, season = 1, episode = 1) {
  try {
    const rawPlugins = (await env.BOT_USERS.get('cfg:plugins')) || (await env.BOT_USERS.get('cfg:addons'));
    if (!rawPlugins) return [];

    const parsed = JSON.parse(rawPlugins);
    // Support both top-level array (your addons.json format) and { repos: [] }
    const repos = Array.isArray(parsed)
      ? parsed
      : (parsed.repos || parsed.addons || []);

    let allStreams = [];

    for (const repo of repos) {
      if (repo.enabled === false) continue;
      const manifestUrl = repo.url || repo.transportUrl;
      if (!manifestUrl) continue;

      console.log(`Fetching Nuvio repo manifest: ${manifestUrl}`);

      try {
        const manifestRes = await fetch(manifestUrl);
        if (!manifestRes.ok) continue;
        const manifest = await manifestRes.json();

        // Nuvio manifests list scrapers under manifest.scrapers or manifest.plugins
        const scrapers = manifest.scrapers || manifest.plugins || [];

        for (const scraper of scrapers) {
          if (scraper.enabled === false) continue;
// If the scraper has a filename instead of a direct url, resolve it against the manifest origin
if (!scraper.url && scraper.filename) {
  const repoBase = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
  scraper.url = repoBase + scraper.filename;
}
if (!scraper.url) continue;
          try {
            console.log(`Running scraper: ${scraper.name || scraper.id}`);
            const codeRes = await fetch(scraper.url);
            if (!codeRes.ok) continue;
            const scriptCode = await codeRes.text();

            // Execute Nuvio-compatible JS scraper module
            // Execute Nuvio-compatible JS scraper module
const moduleObj = { exports: {} };
const mockRequire = (mod) => {
  if (mod === 'axios') return fetch;
  return {};
};
const fn = new Function('module', 'exports', 'require', 'moduleObj', 'fetch', 'console', scriptCode);
fn(moduleObj, moduleObj.exports, mockRequire, moduleObj, fetch, console);

            const getstreams = moduleobj.exports.getstreams || moduleobj.exports.default?.getstreams;
    if (typeof getstreams === 'function') {
      try {
        const scraperPromise = getstreams(String(tmdbId), mediaType, Number(season) || 1, Number(episode) || 1);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Scraper timeout')), 5000));
        const streams = await Promise.race([scraperPromise, timeoutPromise]);
        
        if (Array.isArray(streams) && streams.length > 0) {
          allStreams.push(...streams);
          console.log(`Collected ${streams.length} streams from ${scraper.name || scraper.id}`);
        }
      } catch (err) {
        console.log(`Skipped scraper ${scraper.name || scraper.id}: ${err.message}`);
      }
    }
          } catch (scraperErr) {
            console.error(`Scraper ${scraper.name || scraper.url} failed:`, scraperErr.message);
          }
        }
      } catch (repoErr) {
        console.error(`Failed to load repo ${manifestUrl}:`, repoErr.message);
      }
    }

    console.log(`Total streams collected: ${allStreams.length}`);
    return allStreams;
  } catch (err) {
    console.error("Plugin stream fetch failed:", err.message);
    return [];
  }
}

          

async function handleApi(url, env) {
  const send = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": status === 200 ? "public, max-age=300" : "no-store",
      },
    });
  const media = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  try {

    const path = url.pathname;
    if (path === "/api/streams") {
      const id = url.searchParams.get("id") || "";
      const s = url.searchParams.get("s") || "1";
      const e = url.searchParams.get("e") || "1";
      if (!/^\d{1,9}$/.test(id)) return send({ error: "bad id" }, 400);
      try {
      console.log("Fetching streams for ID:", id, "media:", media, "s:", s, "e:", e);
      const streams = await fetchPluginStreams(env, id, media, s, e);
      console.log("Streams found:", JSON.stringify(streams));
      return send(streams);
    } catch (err) {
      console.error("Plugin fetch error:", err.message);
      return send({ error: err.message }, 500);
    }
    }
    if (path === "/api/providers") {
      const raw = (await env.BOT_USERS.get("cfg:plugins")) || (await env.BOT_USERS.get("cfg:addons")) || "[]";
      const parsed = JSON.parse(raw);
      const savedRepos = Array.isArray(parsed) ? parsed : (parsed.repos || []);
      const repos = [];
      const providers = [];

      for (const repo of savedRepos) {
        try {
          const res = await fetch(repo.url);
          const manifest = res.ok ? await res.json() : {};
          const items = manifest.scrapers || manifest.plugins || manifest.providers || [];

          repos.push({
            id: repo.id,
            name: manifest.name || repo.name,
            version: manifest.version || "1.0.0",
            url: repo.url,
            providerCount: items.length
          });

          for (const p of items) {
            providers.push({
              name: p.name,
              description: p.description || "",
              version: p.version || "1.0.0",
              types: Array.isArray(p.types) ? p.types.join(" | ") : (p.type || "movie | tv"),
              repoName: manifest.name || repo.name,
              url: p.url || p.scriptUrl || ""
            });
          }
        } catch (e) {
          repos.push({ ...repo, version: "1.0.0", providerCount: 0 });
        }
      }
      return send({ repos, providers }, 200);
    }
    if (path === "/api/rows") {
      const base = ROW_ORDER[media].map((k) => ({ key: k, title: ROW_DEFS[media][k].title }));
      const extra = await importedRowList(env, media);
      // imported add-on rows go right after Trending and Boa Picks
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
    if (path === "/api/notice") {
      let n = "";
      try {
        if (env.BOT_USERS) n = (await env.BOT_USERS.get("cfg:notice")) || "";
      } catch (e) {}
      return send({ n });
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>
:root{--bg:#0a0a0a;--card:#1b1b1d;--card2:#252528;--text:#fff;--muted:#a3a3a8;--line:#2b2b2e;--gold:#f5c518;--accent:#e50914;--ok:#46d369;--sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px)}
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
#seg{position:absolute;top:calc(var(--sat) + 12px);left:50%;transform:translateX(-50%);z-index:6;display:flex;padding:4px;border-radius:999px;background:rgba(20,20,22,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1)}
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
.nfb{position:absolute;top:7px;left:8px;color:#e50914;font-size:22px;font-weight:800;line-height:1;font-family:Georgia,"Times New Roman",serif;text-shadow:0 1px 6px rgba(0,0,0,.8)}
.badge.soon{background:var(--accent);color:#fff;font-size:10px;margin:0}
#q{width:100%;border:0;border-radius:999px;background:var(--card);color:#fff;font:inherit;font-size:16px;padding:14px 20px;outline:none}
#q::placeholder{color:#7d7d83}
#q::-webkit-search-cancel-button{display:none}

/* ---------- bottom pill nav ---------- */
#nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--sab) + 14px);z-index:40;width:min(92vw,430px);display:flex;justify-content:space-between;gap:2px;padding:6px;border-radius:999px;background:rgba(34,34,36,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 30px rgba(0,0,0,.5)}
.ni{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 4px 8px;border:0;border-radius:999px;background:none;color:#a3a3a8;font-size:12px;font-weight:700}
.ni.on{background:rgba(255,255,255,.14);color:#fff}
.ni svg{width:26px;height:26px}
.av{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#ff7a8a,#e50914);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;overflow:hidden}
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
.me .big{width:92px;height:92px;border-radius:50%;background:linear-gradient(135deg,#ff7a8a,#e50914);display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:800;overflow:hidden}
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
.notice{display:none;margin:12px 16px 0;padding:12px 40px 12px 14px;border-radius:14px;background:linear-gradient(135deg,#3a0b10,#1b1b1d);border:1px solid rgba(229,9,20,.35);font-weight:600;line-height:1.45;position:relative}
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
.pplay{position:absolute;right:8px;bottom:8px;width:34px;height:34px;border-radius:50%;border:0;background:rgba(229,9,20,.92);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.6)}
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
/* ---------- wide screens (website on laptop/tablet): keep the phone layout, centred ---------- */
@media (min-width:720px){
  html{background:#000}
  body{max-width:560px;margin:0 auto;background:var(--bg);min-height:100vh;box-shadow:0 0 0 1px #1b1b1d,0 0 80px rgba(229,9,20,.08)}
  #detail,#dbar,#catmenu,#admin{left:50%;right:auto;width:560px;margin-left:-280px}
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
  <div class="splayer" id="smplayer"></div>
  <div id="smlist"></div>
</div>
<div id="v-home" class="view on">
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
    <p>Movie data and images by TMDB. Streaming availability by JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB. Boa Entertainment is a discovery platform and does not host or stream any media. Netflix is a trademark of Netflix, Inc. Boa Entertainment is not affiliated with Netflix.</p>
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
  function api(path, tries) {
    tries = tries == null ? 1 : tries;
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 14000);
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
        if (tries > 0) return api(path, tries - 1);
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

  // ---------- library (saved on this device, mirrored to Telegram cloud when available) ----------
  var cloud = null;
  try {
    if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) cloud = tg.CloudStorage;
  } catch (e) {}
  function libKey(mt, id) { return "l_" + mt + "_" + id; }
  function libIdx(mt, id) {
    for (var i = 0; i < LIB.length; i++) if (LIB[i].m === mt && String(LIB[i].i) === String(id)) return i;
    return -1;
  }
  function libSaveLocal() {
    try { localStorage.setItem("boa_lib", JSON.stringify(LIB)); } catch (e) {}
  }
  function libLoad() {
    try { LIB = JSON.parse(localStorage.getItem("boa_lib") || "[]") || []; } catch (e) { LIB = []; }
    if (!cloud) return;
    try {
      cloud.getKeys(function (err, keys) {
        if (err || !keys || !keys.length) return;
        var want = keys.filter(function (k) { return k.indexOf("l_") === 0; }).slice(0, 200);
        if (!want.length) return;
        cloud.getItems(want, function (err2, vals) {
          if (err2 || !vals) return;
          var changed = false;
          want.forEach(function (k) {
            try {
              var o = JSON.parse(vals[k]);
              if (o && o.m && o.i && libIdx(o.m, o.i) < 0) { LIB.push(o); changed = true; }
            } catch (e) {}
          });
          if (changed) { libSaveLocal(); if (tab === "lib") renderLib(); if (tab === "me") renderMe(); }
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
      if (LIB.length > 200) LIB.length = 200;
      if (cloud) { try { cloud.setItem(libKey(d.mt, d.id), JSON.stringify(o)); } catch (e) {} }
      toast("Added to Library");
    }
    libSaveLocal();
  }
  function paintLibBtn(d) {
    $("dlib").innerHTML = libHas(d.mt, d.id) ? ICON.check : ICON.plus;
    $("dlib").setAttribute("aria-label", libHas(d.mt, d.id) ? "Remove from library" : "Add to library");
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
    var plBadge = h("span", "pplay");
    plBadge.innerHTML = ICON.play;
    plBadge.onclick = function (ev) {
      ev.stopPropagation();
      openStreams(m.mt, m.id, m.t, 1, 1);
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
      list.forEach(function (m) { g.appendChild(makeCard(m, { badge: true })); });
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
  function renderLib() {
    var box = $("libgrid");
    box.textContent = "";
    if (!LIB.length) {
      box.appendChild(h("div", "note center", "Your library is empty. Open any title and tap + to save it here."));
      return;
    }
    var g = h("div", "grid");
    LIB.slice().sort(function (a, b) { return (b.a || 0) - (a.a || 0); }).forEach(function (o) {
      g.appendChild(makeCard({ id: o.i, mt: o.m, t: o.t, p: o.p, y: o.y }, { badge: true }));
    });
    box.appendChild(g);
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
    var list = h("div", "list");
    function item(label, val, fn, cls) {
      var b = h("button", "li" + (cls ? " " + cls : ""), label);
      if (val) b.appendChild(h("span", null, val));
      b.onclick = fn;
      list.appendChild(b);
    }
    item("Library", LIB.length + (LIB.length === 1 ? " title" : " titles"), function () { showTab("lib"); });
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
  function openStreams(mt, id, title, s, e) {
    var modal = $("streammodal");
    var list = $("smlist");
    var player = $("smplayer");
    $("smtitle").textContent = title || "Streams";
    player.style.display = "none";
    player.textContent = "";
    list.textContent = "";
    list.appendChild(h("div", "note center", "Discovering streams from enabled plugins\u2026"));
    modal.classList.add("open");

    api("/api/streams?type=" + mt + "&id=" + encodeURIComponent(id) + "&s=" + (s || 1) + "&e=" + (e || 1), 0)
      .then(function (streams) {
        list.textContent = "";
        if (!streams || !streams.length) {
          list.appendChild(h("div", "note center", "No streams returned by your enabled plugins for this title."));
          return;
        }
        streams.forEach(function (st) {
          var row = h("div", "sitem");
          var meta = h("div");
          meta.appendChild(h("b", null, st.title || "Stream"));
          meta.appendChild(h("span", null, (st.provider || "Plugin") + " \u2022 " + (st.quality || "HD")));
          row.appendChild(meta);
          var btn = h("button", "splaybtn", "Play");
          btn.onclick = function () {
            player.style.display = "block";
            player.textContent = "";
            if (/\.m3u8|\.mp4|\.mkv|\.webm/i.test(st.url)) {
              var v = document.createElement("video");
              v.src = st.url;
              v.controls = true;
              v.autoplay = true;
              v.setAttribute("playsinline", "");
              player.appendChild(v);
            } else {
              var ifr = document.createElement("iframe");
              ifr.src = st.url;
              ifr.allow = "autoplay; fullscreen; encrypted-media";
              ifr.setAttribute("allowfullscreen", "");
              player.appendChild(ifr);
            }
            modal.scrollTo({ top: 0, behavior: "smooth" });
          };
          row.appendChild(btn);
          list.appendChild(row);
        });
      })
      .catch(function () {
        list.textContent = "";
        list.appendChild(h("div", "note center", "Failed to query plugins."));
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
    if (d.trailer) {
    var streamBtn = h("button", "btn primary");
    streamBtn.innerHTML = ICON.play;
    streamBtn.appendChild(document.createTextNode(d.mt === "tv" ? "Play S1 E1" : "Play"));
    streamBtn.onclick = function () { openStreams(d.mt, d.id, d.t, 1, 1); };
    acts.appendChild(streamBtn);
      var pb = h("button", "btn primary");
      pb.innerHTML = ICON.play;
      pb.appendChild(document.createTextNode("Play trailer"));
      pb.onclick = play;
      acts.appendChild(pb);
      var yt = h("button", "btn ghost", "Open on YouTube");
      yt.onclick = function () { openLink("https://www.youtube.com/watch?v=" + d.trailer); };
      acts.appendChild(yt);
    } else {
      var sy = h("button", "btn ghost", "Find trailer on YouTube");
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
        c.onclick = function () { openStreams("tv", d.id, d.t + " (S" + n + "E" + e.n + ")", n, e.n); };
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
      if (!t || t === seen) { el.className = "notice"; return; }
      el.appendChild(document.createTextNode(t));
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

    var c1 = h("div", "acard");
    c1.appendChild(h("h3", null, "Members"));
    c1.appendChild(h("p", null, ADM.active === null ? "Member counting needs the BOT_USERS storage connected." : ADM.active + " active in the last 30 days"));
    if (!ADM.kv) c1.appendChild(h("p", null, "Storage isn't connected, so picks and notices can't be saved yet."));
    box.appendChild(c1);

    var c2 = h("div", "acard");
    c2.appendChild(h("h3", null, "Site notice"));
    c2.appendChild(h("p", null, "A short message shown at the top of the home page for everyone. People can dismiss it."));
    var ni = h("input", "ainp");
    ni.type = "text";
    ni.maxLength = 200;
    ni.placeholder = "e.g. Jagun Jagun 2 trailer is out!";
    ni.value = ADM.notice || "";
    c2.appendChild(ni);
    var ns = h("button", "abtn", "Save notice");
    ns.onclick = function () {
      adm("/api/admin/notice", { text: ni.value }).then(function (r) {
        ADM.notice = r.notice;
        toast(r.notice ? "Notice saved" : "Notice cleared");
        try { localStorage.removeItem("boa_notice_x"); } catch (e) {}
      }).catch(function (e) { toast("Couldn't save: " + e.message); });
    };
    var nc = h("button", "abtn alt", "Clear");
    nc.onclick = function () { ni.value = ""; ns.onclick(); };
    c2.appendChild(ns);
    c2.appendChild(nc);
    box.appendChild(c2);

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
    box.appendChild(c3);
    var c4 = h("div", "acard");
    c4.appendChild(h("h3", null, "Catalog add-ons"));
    c4.appendChild(h("p", null, "Paste a Stremio-style add-on link (ending in manifest.json) to add its catalogs as rows on your home page. Only the catalogs are used. Streams and downloads are never loaded."));
    (ADM.addons || []).forEach(function (a, i) {
      var row = h("div", "arow" + (i === 0 ? " first" : ""));
      var info = h("div");
      info.appendChild(h("b", null, a.name));
      info.appendChild(h("span", null, a.cats.length + (a.cats.length === 1 ? " catalog row" : " catalog rows")));
      row.appendChild(info);
      var rm = h("button", "abtn red", "Remove");
      rm.onclick = function () {
        function go() {
          adm("/api/admin/addons", { action: "remove", base: a.base }).then(function (r) { ADM.addons = r.addons; renderAdmin(false); toast("Removed"); }).catch(function (e) { toast("Couldn't remove: " + e.message); });
        }
        if (tg && tg.showConfirm) { try { tg.showConfirm("Remove " + a.name + "?", function (ok) { if (ok) go(); }); return; } catch (e) {} }
        if (window.confirm("Remove " + a.name + "?")) go();
      };
      row.appendChild(rm);
      c4.appendChild(row);
    });
    var au = h("input", "ainp");
    au.type = "url";
    au.placeholder = "https://.../manifest.json";
    au.setAttribute("autocapitalize", "off");
    au.setAttribute("autocomplete", "off");
    c4.appendChild(au);
    var ares = h("div");
    var ab = h("button", "abtn", "Check add-on");
    ab.onclick = function () {
      var u = au.value.trim();
      if (!u) { toast("Paste the add-on link first"); return; }
      ares.textContent = "";
      ares.appendChild(h("p", null, "Checking…"));
      adm("/api/admin/addon-inspect", { url: u }).then(function (r) {
        ares.textContent = "";
        ares.appendChild(h("h3", null, r.name));
        if (r.description) ares.appendChild(h("p", null, r.description));
        if (r.hasStreams) ares.appendChild(h("p", null, "This add-on also offers streams. Boa Cinema ignores them and only uses its catalogs."));
        if (!r.cats.length) {
          var rs = r.resources || [];
          var why = "No usable catalogs found (catalogs that need a search or filter are skipped).";
          if (rs.indexOf("subtitles") >= 0) why = "This is a subtitles add-on. Boa Cinema doesn't play videos, so there is nothing to show from it. Add-ons that list movies and series (catalogs) can be installed, for example a metadata or catalog add-on.";
          else if (rs.indexOf("stream") >= 0) why = "This add-on only offers streams, which Boa Cinema never uses. Add-ons with movie and series catalogs can be installed.";
          ares.appendChild(h("p", null, why));
          return;
        }
        var boxes = [];
        r.cats.forEach(function (c, i) {
          var lab = h("label", "achk");
          var cb = h("input");
          cb.type = "checkbox";
          cb.checked = i < 6;
          boxes.push({ cb: cb, c: c });
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(c.name + " (" + (c.type === "series" ? "Series" : "Movies") + ")"));
          ares.appendChild(lab);
        });
        var inst = h("button", "abtn", "Add selected");
        inst.onclick = function () {
          var picked = boxes.filter(function (x) { return x.cb.checked; }).map(function (x) { return { type: x.c.type, id: x.c.id }; });
          if (!picked.length) { toast("Tick at least one catalog"); return; }
          adm("/api/admin/addons", { action: "add", base: r.base, cats: picked }).then(function (res) {
            ADM.addons = res.addons;
            renderAdmin(false);
            toast("Added. Reopen the app to see the new rows");
          }).catch(function (e) { toast("Couldn't add: " + e.message); });
        };
        ares.appendChild(inst);
      }).catch(function (e) {
        ares.textContent = "";
        ares.appendChild(h("p", null, "Couldn't use that link: " + e.message));
      });
    };
    c4.appendChild(ab);
    c4.appendChild(ares);
    box.appendChild(c4);

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
    box.appendChild(cMS);

    // === PLUGINS CARD (Nuvio style) ===
    var cPl = h("div", "acard");
    cPl.appendChild(h("h3", null, "Plugins"));
    cPl.appendChild(h("p", null, "Install JavaScript scraper repositories and test providers internally."));
    var nuvioListWrap = h("div", null);
    nuvioListWrap.appendChild(h("div", "note", "Loading repositories & providers..."));
    cPl.appendChild(nuvioListWrap);

    fetch("/api/providers").then(function(r) { return r.json(); }).then(function(data) {
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
          adm("/api/admin/plugins", { action: "remove", id: repo.id }).then(function(res) {
            ADM.plugins = res.plugins;
            renderAdmin(false);
            toast("Repository removed");
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
      try { ipHidden = JSON.parse(localStorage.getItem("ipHidden") || "{}") || {}; } catch (e) { ipHidden = {}; }
      var ipSave = function () {
        try { localStorage.setItem("ipHidden", JSON.stringify(ipHidden)); } catch (e) {}
      };
      var ipKey = function (p) {
        return String(p.repoId || (typeof p.repo === "string" ? p.repo : "") || "") + "::" + String(p.id || p.name || "");
      };

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
        tb.onclick = function () {
          toast("Provider testing isn't connected yet");
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
          ipHidden[ipKey(p)] = 1;
          ipSave();
          ipDraw();
          toast(pname + " deleted");
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
        ipHidden = {};
        ipSave();
        ipDraw();
        toast("Deleted providers restored");
      };
      ipRefresh.onclick = function () {
        ipRefresh.textContent = "Refreshing...";
        ipRefresh.disabled = true;
        fetch("/api/providers?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
          return r.json();
        }).then(function (d) {
          providers = Array.isArray(d.providers) ? d.providers : [];
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
}).catch(function () { nuvioListWrap.textContent = "Couldn't load repositories."; });



      // 2. Render Expanded Providers Section
    var plName = h("input", "ainp"); plName.placeholder = "Plugin Name";
    var plUrl = h("input", "ainp"); plUrl.type = "url"; plUrl.placeholder = "Repository URL (https://...)";
    cPl.appendChild(plName); cPl.appendChild(plUrl);
    var plAdd = h("button", "abtn", "Install Plugin");
    plAdd.onclick = function() {
      adm("/api/admin/plugins", { action: "add", name: plName.value, url: plUrl.value }).then(function(r) {
        ADM.plugins = r.plugins;
        renderAdmin(false);
        toast("Plugin installed");
      }).catch(function(e) { toast("Error: " + e.message); });
    };
    cPl.appendChild(plAdd);
    box.appendChild(cPl);
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
    box.appendChild(lpWrap);
    // ===== end licensed providers =====

    box.appendChild(h("div", "note center", "Only your account can see this panel."));
  }

  var yr = $("yr");
  if (yr) yr.textContent = String(new Date().getFullYear());
  $("fhandle").addEventListener("click", function (e) {
    if (tg && tg.openTelegramLink) { e.preventDefault(); try { tg.openTelegramLink(this.href); } catch (x) { openLink(this.href); } }
  });

  libLoad();
  loadNotice();
  checkOwner();
  paintNavAvatar();
  paintSeg();
  loadHome();
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
  "/api/notice": 60,
};

async function cachedApi(request, url, env, ctx) {
  const json = (data, status = 200, extra = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
    });

  // The visitor's country (from Cloudflare), used to highlight "available in your country"
  if (url.pathname === "/api/me") {
    return json({ country: (request.cf && request.cf.country) || "" });
  }

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
  if (!ttl) return handleApi(url, env);

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

  const res = await handleApi(url, env);
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
  if (init === "local-dev") return { ok: true, status: 200 };
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
    return Array.isArray(a) ? a : [];
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
  if (text.length > 400000) throw new Error("That manifest is too large");
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new Error("That link isn't an add-on manifest");
  }
  const cats = (Array.isArray(m.catalogs) ? m.catalogs : (m.cats || [])).map((c) => ({
    type: c.type,
    id: String(c.id).slice(0, 60)
  }));
  const resNames = (Array.isArray(m.resources) ? m.resources : []).map((r) => (typeof r === "string" ? r : r && r.name));
  return {
    name: String(m.name || "Add-on").slice(0, 60),
    description: String(m.description || "").slice(0, 200),
    base,
    cats,
    hasStreams: resNames.includes("stream"),
    resources: resNames.filter((x) => typeof x === "string").slice(0, 10),
  };
}

const importedRowList = async (env, media) => {
  const out = [];
  for (const a of await getAddons(env)) {
    for (const c of a.cats || []) {
      if (stType(c.type) === media) out.push({ key: c.k, title: `${a.name}: ${c.name}`.slice(0, 60) });
    }
  }
  return out;
};

// One imported row: reads the add-on's catalog, then matches every title to TMDB for posters and details.
async function importedRow(env, media, key) {
  for (const a of await getAddons(env)) {
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
          } catch (e) {}
          return null;
        })
      );
      return slimList(items.filter(Boolean), media);
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
      let custom = false;
      if (env.BOT_USERS) {
        notice = (await env.BOT_USERS.get("cfg:notice")) || "";
        custom = (await env.BOT_USERS.get("cfg:picks")) !== null;
      }
      let mediaServer = null;
      let plugins = [];
      if (env.BOT_USERS) {
        const msRaw = await env.BOT_USERS.get("cfg:media_server");
        if (msRaw) try { mediaServer = JSON.parse(msRaw); } catch(e) {}
        const plRaw = await env.BOT_USERS.get("cfg:plugins");
        if (plRaw) try { plugins = JSON.parse(plRaw); } catch(e) {}
      }
      return json({
        picks: await getPicks(env),
        custom,
        notice,
        active: await activeUsers(env, true),
        kv: !!env.BOT_USERS,
        addons: await getAddons(env),
        mediaServer,
        plugins,
      });
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
    if (path === "/api/admin/plugins") {
      let plugins = [];
      const plRaw = await env.BOT_USERS.get("cfg:plugins");
      if (plRaw) try { plugins = JSON.parse(plRaw); } catch(e) {}

      if (body.action === "remove") {
        const id = body.id;
        plugins = plugins.filter(p => p.id !== id);
      } else if (body.action === "add") {
        const pUrl = String(body.url || "").trim();
        const pName = String(body.name || "Custom Plugin").trim();
        if (!pUrl) return json({ error: "Plugin URL required" }, 400);
        plugins.push({ id: "pl_" + Date.now(), name: pName, url: pUrl });
      }
      await env.BOT_USERS.put("cfg:plugins", JSON.stringify(plugins));
      return json({ plugins });
    }
    if (path === "/api/admin/picks") {
      if (body.reset) {
        await env.BOT_USERS.delete("cfg:picks");
        return json({ picks: BOA_PICKS, custom: false });
      }
      if (!Array.isArray(body.picks) || body.picks.length > 30) return json({ error: "bad list" }, 400);
      const list = body.picks.map(cleanPick).filter(Boolean);
      await env.BOT_USERS.put("cfg:picks", JSON.stringify(list));
      return json({ picks: list, custom: true });
    }
    if (path === "/api/admin/addon-inspect") {
      const base = addonBase(body.url);
      if (!base) return json({ error: "Paste a full https add-on link" }, 400);
      try {
        return json(await inspectAddon(base));
      } catch (e) {
        return json({ error: e && e.message ? e.message : "Couldn't read that add-on" }, 400);
      }
    }
    if (path === "/api/admin/addons") {
      let list = await getAddons(env);
      if (body.action === "remove") {
        const base = addonBase(body.base);
        list = list.filter((a) => a.base !== base);
      } else if (body.action === "add") {
        const base = addonBase(body.base);
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
          .map((c) => ({ ...c, k: "x" + fnv(`${base}|${c.type}|${c.id}`) }));
        if (!cats.length) return json({ error: "Pick at least one catalog" }, 400);
        list = list.filter((a) => a.base !== base);
        list.push({ name: info.name, base, cats });
        if (list.length > 6 || list.reduce((n, a) => n + (a.cats || []).length, 0) > 20) {
          return json({ error: "Limit reached: 6 add-ons and 20 catalogs in total" }, 400);
        }
      } else {
        return json({ error: "bad action" }, 400);
      }
      await env.BOT_USERS.put("cfg:addons", JSON.stringify(list));
      return json({ addons: list });
    }
    if (path === "/api/admin/notice") {
      const text = String(body.text || "").trim().slice(0, 200);
      if (text) await env.BOT_USERS.put("cfg:notice", text);
      else await env.BOT_USERS.delete("cfg:notice");
      return json({ notice: text });
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

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: ADDON_CORS });
    if (url.pathname.startsWith("/api/admin/")) return adminRoute(request, url, env);

    if (request.method === "GET") {
      const addonRes = await addonRoute(request, url, env, ctx);
      if (addonRes) return addonRes;
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
