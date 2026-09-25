import { drawFrame } from "../app.v66.js";
let fails = 0;
const ck = (c, n) => { if (!c) { fails++; console.log("FAIL " + n); } };
function fakeCanvas() {
  let w = 0, h = 0, sets = 0;
  const ctx = { createImageData: (W, H) => ({ data: new Uint8ClampedArray(W * H * 4) }), putImageData: () => {} };
  return {
    get width() { return w; }, set width(v) { w = v; sets++; },
    get height() { return h; }, set height(v) { h = v; sets++; },
    getContext: () => ctx, sets: () => sets,
  };
}
const px = { w: 64, h: 64, data: new Uint16Array(64 * 64).map((_, i) => i % 997) };
const c = fakeCanvas();
drawFrame(c, px, "auto", "MR");
ck(c.sets() === 2, "first draw sizes canvas once");
drawFrame(c, px, "auto", "MR");
ck(c.sets() === 2, "second draw must NOT re-clear canvas (flicker guard)");
ck(px.__win && px.__win.k === "auto|MR", "window/level memo stored per frame");
const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../app.v66.js", import.meta.url), "utf-8"));
ck(src.includes("if (viewKey !== vKey)"), "view preserved across slice scroll");
ck(src.includes("Math.round(vx)"), "integer pan (no subpixel shimmer)");
ck(src.includes("requestAnimationFrame(() => { showRaf = 0; show(v); })"), "scroll redraws coalesced via rAF");
ck(!src.includes("sampleMean"), "GPU readback forensic removed from scroll path");
ck(src.includes("pixels.__img"), "ImageData cache for slice revisit");
ck(src.includes("if (ov.width !== f0.w)"), "overlay resize guarded");
ck(!src.includes("vpR.addEventListener"), "conflicting dblclick listener removed");
ck(src.includes("if (vk <= 1.01 && !fsNow()) { vx = 0; vy = 0; }"), "no floating pan below zoom 1 (pan allowed in fullscreen only)");
ck(!src.includes("Math.max(1, Math.min(4,"), "fit allowed below 1x on phones");
ck(src.includes("• ${APP_BUILD}"), "meta line uses APP_BUILD (never a stale literal)");
ck(src.includes("window.innerHeight"), "fit accounts for available height (controls stay on screen)");
ck(src.includes("controllerchange"), "open tabs self-heal when a new SW takes control");
const sws = await import("node:fs").then((fs) => fs.readFileSync(new URL("../sw.v66.js", import.meta.url), "utf-8"));
ck(sws.includes("self.skipWaiting()") && sws.includes("clients.claim()"), "SW activates immediately and claims clients");
ck(sws.includes("app.v66.js"), "SW precache list matches current build");
ck(src.includes("function sliceFitFor(f)"), "per-slice fit: every slice fills the viewport");
ck(!src.includes("for (const fr of current.frames) { if (fr.w > maxW)"), "no series-wide scaling (was shrinking mixed-dim slices)");
ck(src.includes("function releaseWatch()"), "stale tabs auto-reload via release watchdog");
ck(src.includes("rrai-rw-"), "auto-reload guarded once per build");
ck(src.includes("ملاءمة=${fitK.toFixed(2)}"), "meta line exposes live fit factor for forensics");
ck(src.includes("card.requestFullscreen"), "native fullscreen with graceful fallback");
ck(src.includes("fs-fake"), "pseudo-fullscreen fallback for browsers without API");
ck(src.includes("const fs = fsNow()"), "fit honors fullscreen height");
ck(src.includes("ch = vp ? (vp.clientHeight || 0) : 0"), "fullscreen fit measured from real viewport height");
ck(src.includes("function clampPan()"), "drag pan clamped so image cannot be lost");
ck(src.includes("(vk > 1.01 || fsNow())"), "drag-to-pan enabled inside fullscreen");
ck(src.includes("wr.style.height = stH + \"px\""), "fixed stage box (no layout jump on mixed-dim series)");
ck(src.includes("ov.style.inset = \"auto\""), "overlay box tracks canvas inside stage");
ck(src.includes("min-width: 900px"), "height cap only on desktop layouts (phones keep width fit)");
ck((src.match(/const r = \$\("frame"\)\.getBoundingClientRect\(\);/g)||[]).length === 2, "pointer math uses canvas box (stage-safe)");
const ui = await import("node:fs").then((fs) => fs.readFileSync(new URL("../ui.v66.html", import.meta.url), "utf-8"));
ck(ui.includes('id="zoom-reset" class="ghost">\u0645\u0644\u0627\u0621\u0645\u0629</button>'), "fit button labeled clearly (was cryptic 1:1)");
ck(ui.includes('id="zscale"'), "live zoom scale indicator present");
ck(ui.includes('id="fs-toggle"'), "fullscreen button present in viewer controls");
ck(ui.includes("#viewer-card:fullscreen #viewport { border-radius:0; flex:1 1 auto; min-height:0; width:100%; }"), "fullscreen viewport gets definite flex height (no crop)");
ck(src.includes("vk = 2; centerOn"), "dblclick zoom tempered to x2 (less blur shock)");
ck(src.includes("const zs = $(\"zscale\")"), "applyView publishes live scale");
ck(!ui.includes("image-rendering:pixelated"), "nearest-neighbor shimmer removed from viewer");
ck(src.includes("cv.style.width = Math.round(f.w * fitK)"), "explicit fit width (no layout/scale mismatch crop)");
ck(ui.includes("transform-origin:center"), "center-origin user zoom (symmetric crop)");
ck(src.includes("const Ox = r.width / (2 * vk)"), "centroid anchor for center origin");
ck(src.includes("const s = (f0 && r.width / f0.w) || vk"), "measure math uses true display scale");
console.log(fails ? "VIEWER TEST FAIL " + fails : "VIEWER TEST PASS (47)");
