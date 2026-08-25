// Badminton Club — Service Worker
// Strategy: network-first, fallback to cache. Supabase API calls are never cached.
// CACHE version is bumped on every deploy by CI (replace __BUILD_HASH__ via build script)
// If you deploy manually, increment the number suffix each time (MED-05)
const CACHE = 'bk-v70';

// App shell to pre-cache. Paths are RELATIVE to the SW location so the app works
// when served from a project-page subpath (…/<repo>/). Runtime requests with a
// ?v= query are matched via ignoreSearch.
// (legacy badminton_v6-*.html pages are intentionally NOT pre-cached — they are
// kept only as archived URLs and would waste ~230KB of every install)
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'redesign.css',
  'admin-v2.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'assets/crown.png',
  'js/i18n.js',
  'js/exp-engine.js',
  'js/db.js',
  'js/elo.js',
  'js/auth.js',
  'js/leaderboard.js',
  'js/profile.js',
  'js/stats.js',
  'js/season.js',
  'js/achievements.js',
  'js/rankup.js',
  'js/daily.js',
  'js/avatar.js',
  'js/gacha.js',
  'js/gacha-element.js',
  'js/economy-catalog.js',
  'js/collection.js',
  'js/economy.js',
  'js/fusion.js',
  'js/market.js',
  'js/dashboard.js',
  'js/aof.js',
  'js/mailbox.js',
  'js/tournament.js',
  'js/tournament-knockout.js',
  'js/utils.js',
  'js/notifications.js',
  'js/perf.js',
  'js/levels.js',
  'js/levelrewards.js',
  'js/partner-system.js',
  'js/admin/scoring.js',
  'js/admin/ui.js',
  'js/admin/api.js',
  'js/admin/core.js',
  'js/admin/overview.js',
  'js/admin/players.js',
  'js/admin/matches.js',
  'js/admin/referee.js',
  'js/admin/roster-parse.js',
  'js/admin/roster-match.js',
  'js/admin/bracket.js',
  'js/admin/tournaments.js',
  'js/admin/tournament-wizard.js',
  'js/admin/tournament-draw.js',
  'js/admin/tournament-ops.js',
  'js/admin/referee-v2.js',
  'js/admin/achievements.js',
  'js/admin/rewards.js',
  'js/admin/logs.js',
  'js/admin/settings.js',
  'js/admin/rankings.js',
  'js/tournament/scoring-presets.js',
  'js/tournament/validation.js',
  'js/tournament/draw.js',
  'js/tournament/standings.js',
  'js/tournament/errors.js',
  'js/tournament/service.js'
];

// ── Install: pre-cache shell (individually, so one 404 won't abort the rest) ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: drop old caches, take control immediately ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fallback to cache ──
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET; let everything else hit the network untouched.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase API calls — always go straight to the network.
  if (url.hostname.endsWith('supabase.co')) {
    return; // default browser handling
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        // Cache a copy of successful same-origin responses for offline use.
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => {
        // Offline: serve from cache (ignore ?v= query strings), fall back to the app shell for navigations (MED-07)
        return caches.match(req, { ignoreSearch: true })
          .then(hit => {
            if (hit) return hit;
            if (req.mode === 'navigate') {
              // Notify the active client that we are offline so the app can show a banner
              self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(c => c.postMessage({ type: 'OFFLINE' }));
              });
              return caches.match('index.html');
            }
            return undefined;
          });
      })
  );
});
