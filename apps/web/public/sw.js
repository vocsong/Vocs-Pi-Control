/* Pi Control service worker — offline-capable app shell (PWA baseline). */
const CACHE = "pi-control-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  // Never cache API or WebSocket traffic.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;
  // Navigation: network-first, fall back to cached shell.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/")),
    );
    return;
  }
  // Static assets: cache-first.
  event.respondWith(
    caches.match(event.request).then((hit) => hit ?? fetch(event.request).then((res) => {
      const copy = res.clone();
      void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return res;
    })),
  );
});
