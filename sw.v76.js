const BUILD = "v76";
const CACHE = "rrai-web-v76";
const CRITICAL = [
  "./", "./start.html", "./index.html", "./manifest.webmanifest",
  "./ui.v76.html", "./app.v76.js", "./dicom.v76.js", "./report.v76.js", "./sw.v76.js",
  "./triage.v76.js", "./consult.v76.js", "./docx.v76.js", "./measure.v76.js", "./compare.v76.js"
];
const LEN = {"consult.v76.js": 729d62402ecb1ccc2959c7f55fc55f5141c5f088f4881bf8aa378bc565daf8ec, "codecs/decode.v76.js": f2b87411b1e3c14edc6b0815a16cb775dffccdffa078d946968db818e1f9abd2, "dicom.v76.js": caa2012696c8af3e71e79644e205b939774b9d1913c7b4827b86b80df4d34438, "triage.v76.js": a434a45f28ede36f9018e983fb3c8f3a599df0674d0e94528843fd7db2b83a47, "docx.v76.js": d1158b48a70d49c523b99d6b1dff1245c0507bae8e05e731a0a1c467c6f9c367, "measure.v76.js": 39044eae7274081becae2478481b4eace4ed9d8bfa5063e0d9c9513c33bd667f, "compare.v76.js": a4308f873614e66ca3c21378554778d11afbbb9ebd9f2e8e41bf7b3cefe23c0b, "report.v76.js": 0e46cb9e36837d05d069de060d94c7fefb3001a07bee532fe29bde05c01e091e, "app.v76.js": b9b521ab662469f2396239f90aa282e4d4ae8aa785ce1fbafaea14621f44f035, "ui.v76.html": 19b41ef55a42e0f2d93824566ddf7f439f11277d75fd9f9add9b246ac4fbf440};
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
