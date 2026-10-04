const BUILD = "v105";
const CACHE = "rrai-web-v105";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v105.html", "./app.v105.js", "./dicom.v105.js", "./report.v105.js", "./sw.v105.js", "./triage.v105.js", "./consult.v105.js", "./docx.v105.js", "./measure.v105.js", "./compare.v105.js",
  "./mpr.v105.js", "./codecs/decode.v105.js", "./icons/logo.png"
];
const LEN = {"consult.v105.js": 5341, "codecs/decode.v105.js": 5236, "dicom.v105.js": 10473, "triage.v105.js": 5542, "docx.v105.js": 20498, "measure.v105.js": 1652, "compare.v105.js": 1444, "report.v105.js": 9460, "mpr.v105.js": 8058, "app.v105.js": 217686, "ui.v105.html": 44034};;
const okLen = (u, n) => { for (const k in LEN) if (u.endsWith(k)) return n === LEN[k]; return true; };
/* a cached body that does not match this build's byte table is poison (old build, proxy
   injection, partial download): refuse it and go to the network instead. */
const trustedHit = async (hit, pathname) => {
  if (!hit) return null;
  try {
    const buf = await hit.clone().arrayBuffer();
    if (okLen(pathname, buf.byteLength)) return hit;
  } catch (e) {}
  return null;
};
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
    const hit0 = await caches.match(e.request, { ignoreSearch: true });
    const hit = await trustedHit(hit0, url.pathname);
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
      const fall0 = await c.match(url.pathname) || await c.match(e.request, { ignoreSearch: true });
      const fall = await trustedHit(fall0, url.pathname);
      if (fall) return fall;
      throw err;
    }
  })());
});
