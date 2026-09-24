const BUILD = "v62";
const CACHE = "rrai-web-v62";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v62.html", "./app.v62.js", "./dicom.v62.js", "./report.v62.js", "./sw.v62.js",
  "./triage.v62.js", "./consult.v62.js", "./docx.v62.js", "./measure.v62.js", "./compare.v62.js"
];
const LEN = {"consult.v62.js": 729d62402ecb1ccc2959c7f55fc55f5141c5f088f4881bf8aa378bc565daf8ec, "codecs/decode.v62.js": f2b87411b1e3c14edc6b0815a16cb775dffccdffa078d946968db818e1f9abd2, "dicom.v62.js": caa2012696c8af3e71e79644e205b939774b9d1913c7b4827b86b80df4d34438, "triage.v62.js": a434a45f28ede36f9018e983fb3c8f3a599df0674d0e94528843fd7db2b83a47, "docx.v62.js": 31e8fda41b121ce7379a747c70bff050dd25a72d466cb2c9c287b5c0de1178db, "measure.v62.js": 39044eae7274081becae2478481b4eace4ed9d8bfa5063e0d9c9513c33bd667f, "compare.v62.js": a4308f873614e66ca3c21378554778d11afbbb9ebd9f2e8e41bf7b3cefe23c0b, "report.v62.js": 0e46cb9e36837d05d069de060d94c7fefb3001a07bee532fe29bde05c01e091e, "app.v62.js": 2193d5de56a19181dfc9712dad9bdc7b9e7a80b759a4f6855204bee7616d82c5, "ui.v62.html": 17e80bf9bbeaa98cb3e65207cac286a6c31bcf049b896713601b3c379dc0df2f};
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
