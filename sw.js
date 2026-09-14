/* Offline shell for the browser edition (GitHub Pages).
   v7: release-keyed cache keys (?b=BUILD) so a stale CDN edge can never
   serve a mixed release; navigations resolve to the keyed index.html. */
const BUILD = "v8";
const CACHE = "rrai-web-v8";
const SHELL = ["./", "./index.html", "./app.js", "./dicom.js", "./report.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
const keyed = (u) => u + (u.includes("?") ? "&" : "?") + "b=" + BUILD;
const isShellPath = (url) => SHELL.some((s) => url.pathname.endsWith(s.replace("./", "/")) || url.pathname + "/" === s);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((s) => keyed(s)))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (event.request.mode === "navigate") {
    const indexUrl = keyed(new URL("./index.html", self.location.href).href);
    event.respondWith(
      caches.match(indexUrl).then(
        (cached) =>
          cached ||
          fetch(indexUrl).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(indexUrl, copy));
            }
            return response;
          })
      )
    );
    return;
  }
  if (url.pathname.includes("/codecs/")) {
    // Immutable decoder assets: runtime cache-first for offline reuse.
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
      )
    );
    return;
  }
  if (!isShellPath(url)) return;
  const kUrl = keyed(url.href);
  event.respondWith(
    caches.match(kUrl).then(
      (cached) =>
        cached ||
        fetch(kUrl).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(kUrl, copy));
          }
          return response;
        })
    )
  );
});
