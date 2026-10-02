/* Radiology report AI — retired service worker (self-destruct pill).
   Any device still registered on an old build gets this on its next update
   check: it wipes every cache, unregisters itself and reloads the page, so
   the browser must go to the network and pick up the current launcher. */
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (x) {}
    let cls = [];
    try { cls = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); } catch (x) {}
    for (const c of cls) { try { c.postMessage("rrai-sw-updated"); } catch (x) {} }
    try { await self.registration.unregister(); } catch (x) {}
    for (const c of cls) { try { await c.navigate(c.url); } catch (x) {} }
  })());
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate" || (e.request.method || "GET") !== "GET") return;
  e.respondWith(fetch(e.request, { cache: "no-store" }).catch(async () => {
    try { const r = await caches.match(e.request); if (r) return r; } catch (x) {}
    return new Response("", { status: 504 });
  }));
});
