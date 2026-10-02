const BUILD = "v99";
const CACHE = "rrai-web-v99";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v99.html", "./app.v99.js", "./dicom.v99.js", "./report.v99.js", "./sw.v99.js",
  "./triage.v99.js", "./consult.v99.js", "./docx.v99.js", "./measure.v99.js", "./compare.v99.js", "./codecs/decode.v99.js",
  "./icons/logo.png"
];
const LEN = {"consult.v99.js": 5341, "codecs/decode.v99.js": 5236, "dicom.v99.js": 7420, "triage.v99.js": 5542, "docx.v99.js": 20498, "measure.v99.js": 1652, "compare.v99.js": 1444, "report.v99.js": 9460, "app.v99.js": 184837, "ui.v99.html": 41399};;
const okLen = (u, n) => { for (const k in LEN) if (u.endsWith(k)) return n === LEN[k]; return true; };
const vPut = async (c, u, res) => {
  try {
    const b = await res.arrayBuffer();
    if (!okLen(u, b.byteLength)) return;
    await c.put(u, new Response(b, { status: res.status, headers: res.headers }));
  } catch (e) {}
};
const BEST_EFFORT = [
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./codecs/decode.v41.js", "./codecs/charlswasm.js", "./codecs/charlswasm.wasm",
  "./codecs/openjpegwasm.js", "./codecs/openjpegwasm.wasm", "./codecs/openjphjs.js", "./codecs/openjphjs.wasm"
];
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(CRITICAL.map(async (u) => {
      try { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) return; await vPut(c, u, r); } catch (e) {}
    }));
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
    try { const cls = await self.clients.matchAll(); for (const c of cls) c.postMessage("rrai-sw-updated"); } catch (e2) {}
  })());
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request);
        if (r.ok) {
          try { const c = await caches.open(CACHE); c.put(e.request, r.clone()); } catch (e2) {}
          return r;
        }
      } catch (e2) {}
      const c = await caches.open(CACHE);
      for (const k of [e.request.url, "./start.html", "./index.html", "./"]) {
        const hit = await c.match(k, { ignoreSearch: true });
        if (hit) return hit;
      }
      return new Response("offline", { status: 503 });
    })());
    return;
  }
  if (url.pathname.endsWith("/release.json")) return;
  if (/\/(sw\.js|sw\.v\d+\.js|integrity\.v\d+\.json)$/.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request, { cache: "no-store" });
        if (r.ok) return r;
      } catch (e2) {}
      const c = await caches.open(CACHE);
      const hit = await c.match(url.pathname) || await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      return new Response("offline", { status: 503 });
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      try {
        if (res.ok && url.origin === location.origin) {
          const c = await caches.open(CACHE);
          const bb = await res.clone().arrayBuffer();
          if (okLen(url.pathname, bb.byteLength)) c.put(url.pathname, new Response(bb, { status: res.status, headers: res.headers }));
        }
      } catch (err) {}
      return res;
    } catch (err) {
      const c = await caches.open(CACHE);
      const fall = await c.match(url.pathname) || await c.match(e.request, { ignoreSearch: true });
      if (fall) return fall;
      throw err;
    }
  })());
});
