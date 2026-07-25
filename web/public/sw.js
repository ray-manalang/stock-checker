// Minimal service worker for the PWA (Phase 5.1). The app is data-driven and
// LAN-only, so the strategy is:
//   - /api/*            → always network (never cache: data stays fresh)
//   - navigations/HTML  → network-first (so a new deploy is picked up; the
//                          cached shell is only a fallback when offline)
//   - hashed assets     → cache-first (Vite fingerprints them, so they're
//                          immutable and safe to serve from cache)
// Network-first on the document is what keeps installed clients from getting
// stuck on a stale index.html after a rebuild.

const CACHE = "market-specialist-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API responses — always hit the network so data stays fresh.
  if (url.pathname.startsWith("/api/")) return;

  const isNavigation =
    e.request.mode === "navigate" ||
    (e.request.destination === "document") ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isNavigation) {
    // Network-first: fetch fresh HTML, cache it, fall back to cache offline.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html"))),
    );
    return;
  }

  // Cache-first for fingerprinted static assets; back-fill the cache on miss.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        }),
    ),
  );
});
