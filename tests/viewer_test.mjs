import { drawFrame } from "../app.v54.js";
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
const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../app.v54.js", import.meta.url), "utf-8"));
ck(src.includes("if (viewKey !== vKey)"), "view preserved across slice scroll");
ck(src.includes("Math.round(vx)"), "integer pan (no subpixel shimmer)");
ck(src.includes("requestAnimationFrame(() => { showRaf = 0; show(v); })"), "scroll redraws coalesced via rAF");
ck(!src.includes("sampleMean"), "GPU readback forensic removed from scroll path");
ck(src.includes("pixels.__img"), "ImageData cache for slice revisit");
ck(src.includes("if (ov.width !== f0.w)"), "overlay resize guarded");
ck(!src.includes("vpR.addEventListener"), "conflicting dblclick listener removed");
ck(src.includes("if (vk <= 1.01) { vx = 0; vy = 0; }"), "no floating pan offset below zoom 1");
console.log(fails ? "VIEWER TEST FAIL " + fails : "VIEWER TEST PASS (11)");
