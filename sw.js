/* ============================================================
   CGE Service Worker — mobile.html only
   Handles: cache-first serving, offline incident queue
============================================================ */

const CACHE_NAME = 'cge-mobile-v5';

// Core files to cache on install
// Supabase API calls are NOT cached — always go to network
const CORE_FILES = [
  './mobile.html',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── INSTALL — cache core files ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting()) // activate immediately
  );
});

// ── ACTIVATE — clean up old caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — cache-first for core files, network-first for API ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept Supabase API calls — always go to network
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Network failed — return a generic offline JSON response
        // so the app can detect it and queue the request
        return new Response(
          JSON.stringify({ error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // For map tiles — cache dynamically (network first, fallback to cache)
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For everything else — cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── BACKGROUND SYNC — replay offline incident queue ──────────
self.addEventListener('sync', event => {
  if (event.tag === 'incident-queue') {
    event.waitUntil(replayOfflineQueue());
  }
});

async function replayOfflineQueue() {
  // Open IndexedDB and replay pending requests
  // The actual queue is managed by offline.js in the main thread
  // Here we just notify the client to trigger the replay
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'REPLAY_QUEUE' });
  });
}

// ── MESSAGE HANDLER — receive messages from main thread ───────
self.addEventListener('message', event => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
