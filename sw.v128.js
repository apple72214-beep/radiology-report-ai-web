const BUILD = "v128";
const CACHE = "rrai-web-v128";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v128.html", "./app.v128.js", "./dicom.v128.js", "./report.v128.js", "./sw.v128.js", "./triage.v128.js", "./consult.v128.js", "./docx.v128.js", "./measure.v128.js", "./compare.v128.js",
  "./mpr.v128.js", "./viewer-state.v128.js", "./codecs/decode.v128.js", "./icons/logo.png"
];
const LEN = {"consult.v128.js": 5341, "codecs/decode.v128.js": 5236, "dicom.v128.js": 15714, "triage.v128.js": 5542, "docx.v128.js": 20507, "measure.v128.js": 1652, "compare.v128.js": 1444, "report.v128.js": 9460, "mpr.v128.js": 8058, "viewer-state.v128.js": 9480, "app.v128.js": 297500, "ui.v128.html": 56158, "start.html": 18436, "index.html": 941};;
const okLen = (u, n) => { for (const k in LEN) if (u.endsWith(k)) return n === LEN[k]; return true; };
/* v128 — the launcher is the one file whose length CHANGES with every build, so
   this build's byte table can no longer tell a fresh launcher from a poisoned
   one: every new release looked like tampering, the cache won, and the device
   stayed on the old build however often it reloaded. Accept a launcher that is
   whole and carries a well-formed pinned commit — it verifies its own build
   against its own integrity file. A truncated or injected copy has no PIN. */
const launcherOk = async (buf, pathname) => {
  if (okLen(pathname, buf.byteLength)) return true;
  try {
    const s = new TextDecoder("utf-8").decode(buf);
    if (s.length < 8000) return false;
    return /radiology-report-ai-web@[0-9a-f]{40}\//.test(s);
  } catch (e) { return false; }
};
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
/* Diagnostics must always be the bytes we just shipped: a cached probe lies
   about the running build (and hides the fields we added to debug with). */
/* The launcher is fetched from the network and length-checked below (it is in
   LEN), so its cache entry can never outlive the build it verifies. */
const NEVER_CACHED = /\/((probe|diag)\.html)$/;
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (NEVER_CACHED.test(url.pathname)) return;   /* let the browser go to the network */
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      /* The launcher is a control file. A stale cached copy of start.html
         carries the hashes of an older release, so it rejects every build it is
         given and hands the device back to an old one — the update loop. Never
         let a launcher page through unless its length matches this build. */
      const launcher = /\/(start|index)\.html$/.test(url.pathname);
      try {
        const r = await fetch(new Request(e.request, { cache: "no-store" }));
        if (r.ok) {
          const buf = await r.clone().arrayBuffer();
          if (!launcher || await launcherOk(buf, url.pathname)) {
            try { const c = await caches.open(CACHE); c.put(e.request, r.clone()); } catch (e2) {}
            return r;
          }
          /* stale or poisoned by the network: one cache-busted retry */
          const r2 = await fetch(url.pathname + "?swb=" + Date.now(), { cache: "no-store" });
          const b2 = await r2.clone().arrayBuffer();
          if (r2.ok && await launcherOk(b2, url.pathname)) {
            try { const c = await caches.open(CACHE); c.put(url.pathname, r2.clone()); } catch (e2) {}
            return r2;
          }
        }
      } catch (e2) {}
      const c = await caches.open(CACHE);
      /* Offline (or every copy is stale): the single-file edition boots on its
         own, so prefer it over a launcher that can no longer verify anything. */
      for (const k of [e.request.url, "./standalone.html", "./start.html", "./index.html", "./"]) {
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
