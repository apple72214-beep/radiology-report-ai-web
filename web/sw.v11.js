/* Offline shell v9: version-named assets + immutable launcher.
   release.json is never cached; everything else is cache-first. */
const BUILD = "v11";
const CACHE = "rrai-web-v11";
const PRECACHE = [
  "./index.html",
  "./start.html",
  "./sw.v11.js",
  "./ui.v11.html",
  "./app.v11.js",
  "./dicom.v11.js",
  "./report.v11.js",
  "./codecs/decode.v11.js",
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
      caches.match("./index.html",
  "./start.html",
  "./sw.v11.js").then(
        (cached) =>
          cached ||
          fetch("./index.html",
  "./start.html",
  "./sw.v11.js").then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(CACHE).then((c) => c.put("./index.html",
  "./start.html",
  "./sw.v11.js", copy));
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
