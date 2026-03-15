// ─── CONFIG ────────────────────────────────────────────────────────────────
const USERNAME = "YOUR_USERNAME";
const PASSWORD = "YOUR_PASSWORD";

// Rutracker anime forum IDs (covers most anime sub-sections)
// Leave empty to search all forums
const ANIME_FORUMS = [
  7,    // Аниме (main)
  2076, // Аниме (HD Video)
  2133, // Аниме (480p-SD Video)
  2134, // Аниме (720p)
  2135, // Аниме (1080p)
  2136, // Аниме (4K)
  9    // Аниме (DVD)
];

// ─── SESSION CACHE ──────────────────────────────────────────────────────────
// Module-level: survives across search() calls within a session
let sessionCookie = null;

// ─── LOGIN ──────────────────────────────────────────────────────────────────
async function login(request) {
  const body = new URLSearchParams({
    login_username: USERNAME,
    login_password: PASSWORD,
    login: "Вход"
  });

  // Hayase's request object mirrors the Fetch API; pass options as 2nd arg
  const html = await request.text("https://rutracker.org/forum/login.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "https://rutracker.org/forum/index.php"
    },
    body: body.toString()
  });

  // After login, Rutracker sets a bb_session cookie.
  // The request object should persist cookies automatically — if not,
  // parse it from the response headers if your Hayase version exposes them.
  return html;
}

// ─── SEARCH ─────────────────────────────────────────────────────────────────
export async function search(request, query) {
  // Login once per worker lifecycle
  if (!sessionCookie) {
    await login(request);
    sessionCookie = true; // mark as done; cookie jar handled by request proxy
  }

  // Build search URL — restrict to anime forums
  const forumParam = ANIME_FORUMS.map(f => `f[]=${f}`).join("&");
  const url = `https://rutracker.org/forum/tracker.php?nm=${encodeURIComponent(query)}&${forumParam}`;

  const html = await request.text(url);

  return parseResults(html);
}

// ─── PARSE SEARCH RESULTS ───────────────────────────────────────────────────
function parseResults(html) {
  const results = [];

  // Match each torrent row in the results table
  // Rutracker rows look like: <tr class="trs"> ... </tr>
  const rowRegex = /<tr[^>]+class="trs[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];

    // Topic ID and title
    const topicMatch = row.match(/viewtopic\.php\?t=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!topicMatch) continue;

    const topicId = topicMatch[1];
    const title = decodeHTMLEntities(topicMatch[2].trim());

    // Seeds
    const seedMatch = row.match(/class="seed[^"]*"><[^>]+>(\d+)</);
    const seeds = seedMatch ? parseInt(seedMatch[1]) : 0;

    // Leechers
    const leechMatch = row.match(/class="leech[^"]*"><[^>]+>(\d+)</);
    const leechers = leechMatch ? parseInt(leechMatch[1]) : 0;

    // Size (in bytes — Rutracker stores it in a data-ts_text attr)
    const sizeMatch = row.match(/data-ts_text="(\d+)"/);
    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;

    results.push({
      title,
      url: `https://rutracker.org/forum/viewtopic.php?t=${topicId}`,
      seeds,
      leechers,
      size
    });
  }

  return results;
}

// ─── DETAIL (get magnet from topic page) ────────────────────────────────────
export async function detail(request, url) {
  if (!sessionCookie) {
    await login(request);
    sessionCookie = true;
  }

  const html = await request.text(url);

  // Magnet link lives in <a class="magnet-link" href="magnet:...">
  const magnetMatch = html.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/);

  // Fallback: .torrent download link
  const torrentMatch = html.match(/href="(dl\.php\?t=\d+)"/);

  const magnetOrTorrent = magnetMatch
    ? magnetMatch[1]
    : torrentMatch
    ? `https://rutracker.org/forum/${torrentMatch[1]}`
    : url;

  return {
    episodes: [
      {
        title: "Episode",
        url: magnetOrTorrent
      }
    ]
  };
}

// ─── UTILS ──────────────────────────────────────────────────────────────────
function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));
}
