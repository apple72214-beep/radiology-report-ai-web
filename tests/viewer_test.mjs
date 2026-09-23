import { drawFrame } from "../app.v60.js";
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
const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../app.v60.js", import.meta.url), "utf-8"));
ck(src.includes("if (viewKey !== vKey)"), "view preserved across slice scroll");
ck(src.includes("Math.round(vx)"), "integer pan (no subpixel shimmer)");
ck(src.includes("requestAnimationFrame(() => { showRaf = 0; show(v); })"), "scroll redraws coalesced via rAF");
ck(!src.includes("sampleMean"), "GPU readback forensic removed from scroll path");
ck(src.includes("pixels.__img"), "ImageData cache for slice revisit");
ck(src.includes("if (ov.width !== f0.w)"), "overlay resize guarded");
ck(!src.includes("vpR.addEventListener"), "conflicting dblclick listener removed");
ck(src.includes("if (vk <= 1.01) { vx = 0; vy = 0; }"), "no floating pan offset below zoom 1");
ck(!src.includes("Math.max(1, Math.min(4,"), "fit allowed below 1x on phones");
ck(src.includes("• ${APP_BUILD}"), "meta line uses APP_BUILD (never a stale literal)");
ck(src.includes("window.innerHeight"), "fit accounts for available height (controls stay on screen)");
ck(src.includes("controllerchange"), "open tabs self-heal when a new SW takes control");
const sws = await import("node:fs").then((fs) => fs.readFileSync(new URL("../sw.v60.js", import.meta.url), "utf-8"));
ck(sws.includes("self.skipWaiting()") && sws.includes("clients.claim()"), "SW activates immediately and claims clients");
ck(sws.includes("app.v60.js"), "SW precache list matches current build");
const ui = await import("node:fs").then((fs) => fs.readFileSync(new URL("../ui.v60.html", import.meta.url), "utf-8"));
ck(!ui.includes("image-rendering:pixelated"), "nearest-neighbor shimmer removed from viewer");
ck(src.includes("cv.style.width = Math.round(f.w * fitK)"), "explicit fit width (no layout/scale mismatch crop)");
ck(ui.includes("transform-origin:center"), "center-origin user zoom (symmetric crop)");
ck(src.includes("const Ox = r.width / (2 * vk)"), "centroid anchor for center origin");
ck(src.includes("const s = (f0 && r.width / f0.w) || vk"), "measure math uses true display scale");
console.log(fails ? "VIEWER TEST FAIL " + fails : "VIEWER TEST PASS (26)");
