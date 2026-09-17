const BUILD = "v35";
const CACHE = "rrai-web-v35";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v35.html", "./app.v35.js", "./dicom.v35.js", "./report.v35.js", "./sw.v35.js",
  "./triage.v35.js", "./consult.v35.js", "./docx.v35.js", "./measure.v35.js", "./compare.v35.js"
];
const BEST_EFFORT = [
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./codecs/decode.v35.js", "./codecs/charlswasm.js", "./codecs/charlswasm.wasm",
  "./codecs/openjpegwasm.js", "./codecs/openjpegwasm.wasm", "./codecs/openjphjs.js", "./codecs/openjphjs.wasm"
];
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(CRITICAL.map((u) => c.add(u)));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    const c = await caches.open(CACHE);
    Promise.allSettled(BEST_EFFORT.map((u) => c.add(u)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      for (const k of ["./start.html", "./index.html", "./"]) {
        const hit = await c.match(k);
        if (hit) return hit;
      }
      return fetch(e.request);
    })());
    return;
  }
  if (url.pathname.endsWith("/release.json")) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    try {
      if (res.ok && url.origin === location.origin) {
        const c = await caches.open(CACHE);
        c.put(e.request, res.clone());
      }
    } catch (err) {}
    return res;
  })());
});
