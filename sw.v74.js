const BUILD = "v74";
const CACHE = "rrai-web-v74";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v74.html", "./app.v74.js", "./dicom.v74.js", "./report.v74.js", "./sw.v74.js",
  "./triage.v74.js", "./consult.v74.js", "./docx.v74.js", "./measure.v74.js", "./compare.v74.js"
];
const LEN = {"consult.v74.js": 729d62402ecb1ccc2959c7f55fc55f5141c5f088f4881bf8aa378bc565daf8ec, "codecs/decode.v74.js": f2b87411b1e3c14edc6b0815a16cb775dffccdffa078d946968db818e1f9abd2, "dicom.v74.js": caa2012696c8af3e71e79644e205b939774b9d1913c7b4827b86b80df4d34438, "triage.v74.js": a434a45f28ede36f9018e983fb3c8f3a599df0674d0e94528843fd7db2b83a47, "docx.v74.js": d1158b48a70d49c523b99d6b1dff1245c0507bae8e05e731a0a1c467c6f9c367, "measure.v74.js": 39044eae7274081becae2478481b4eace4ed9d8bfa5063e0d9c9513c33bd667f, "compare.v74.js": a4308f873614e66ca3c21378554778d11afbbb9ebd9f2e8e41bf7b3cefe23c0b, "report.v74.js": 0e46cb9e36837d05d069de060d94c7fefb3001a07bee532fe29bde05c01e091e, "app.v74.js": bb04fd9ec4ebf53e49a29ba362de95201aa30dd00a8227dd5dfac9dbe53d405d, "ui.v74.html": 2526e12304d7d8b5035f3939a3480ee1650ba0bd31cee1a41d02ff9276fcdc9b};
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
        const hit = await c.match(k);
        if (hit) return hit;
      }
      return new Response("offline", { status: 503 });
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
        const bb = await res.clone().arrayBuffer();
        if (okLen(url.pathname, bb.byteLength)) c.put(e.request, new Response(bb, { status: res.status, headers: res.headers }));
      }
    } catch (err) {}
    return res;
  })());
});
