// Badminton Club — Service Worker
// Strategy: network-first, fallback to cache. Supabase API calls are never cached.
const CACHE = 'bk-v1';

// App shell to pre-cache (bare paths; runtime requests with ?v= query are matched via ignoreSearch)
const ASSETS = [
  '/',
  '/index.html',
  '/badminton_v6-4.html',
  '/styles.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/js/i18n.js',
  '/js/db.js',
  '/js/elo.js',
  '/js/auth.js',
  '/js/leaderboard.js',
  '/js/profile.js',
  '/js/stats.js',
  '/js/season.js',
  '/js/achievements.js',
  '/js/rankup.js',
  '/js/daily.js',
  '/js/avatar.js',
  '/js/gacha.js',
  '/js/mailbox.js',
  '/js/tournament.js',
  '/js/utils.js'
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
      .catch(() =>
        // Offline: serve from cache (ignore ?v= query strings), fall back to the app shell for navigations.
        caches.match(req, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined))
      )
  );
});
