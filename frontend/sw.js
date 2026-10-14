/* Radiology report AI — service worker: offline app shell + cached frames. */
const CACHE = "rrai-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname === "/events" || url.pathname === "/studies/upload") return;

  // Rendered frames: stale-while-revalidate so already-seen slices work offline.
  if (url.pathname.startsWith("/studies/") && url.pathname.endsWith("/png")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fresh = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  // Everything else: network-first with offline fallback to the shell.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && (event.request.mode === "navigate" || SHELL.includes(url.pathname))) {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request)) || (await caches.match("/")))
  );
});
