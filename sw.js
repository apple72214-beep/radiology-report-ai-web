/* Offline shell v9: version-named assets + immutable launcher.
   release.json is never cached; everything else is cache-first. */
const BUILD = "v10";
const CACHE = "rrai-web-v10";
const PRECACHE = [
  "./index.html",
  "./ui.v10.html",
  "./app.v10.js",
  "./dicom.v10.js",
  "./report.v10.js",
  "./codecs/decode.v10.js",
  "./codecs/charlswasm.js?b=v9",
  "./codecs/openjphjs.js?b=v9",
  "./codecs/openjpegwasm.js?b=v9",
  "./codecs/charlswasm.wasm",
  "./codecs/openjphjs.wasm",
  "./codecs/openjpegwasm.wasm",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
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
    event.respondWith(
      caches.match("./index.html").then(
        (cached) =>
          cached ||
          fetch("./index.html").then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(CACHE).then((c) => c.put("./index.html", copy));
            }
            return r;
          })
      )
    );
    return;
  }
  if (url.pathname.endsWith("/release.json")) return; // always network, never cached
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return r;
        })
    )
  );
});
