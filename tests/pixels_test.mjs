/* A frame that cannot be drawn must never render as a silent black rectangle.
   This suite locks that rule: refuse bad pixel data at parse time, say why on
   the canvas and in the viewer, and never feed blank frames to MPR. */
import { parseDicom } from "../dicom.v108.js";
import { drawFrame, pixelProblem, pixelProblemText } from "../app.v108.js";
import fs from "node:fs";

let fails = 0;
const ck = (c, n) => { if (!c) { fails++; console.log("FAIL " + n); } };

/* ---- minimal Explicit VR Little Endian builder ---- */
const LONG = new Set(["OB", "OW", "OF", "SQ", "UC", "UN", "UR", "UT"]);
function el(g, e, vr, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt16LE(g, 0);
  head.writeUInt16LE(e, 2);
  head.write(vr, 4, "ascii");
  if (LONG.has(vr)) {
    head.writeUInt16LE(0, 6);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(payload.length, 0);
    return Buffer.concat([head, len, payload]);
  }
  head.writeUInt16LE(payload.length, 6);
  return Buffer.concat([head, payload]);
}
const cs = (v) => Buffer.from(v, "ascii");
const us = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };

function dcm({ rows = 4, cols = 4, bits = 16, bytes = null, photometric = "MONOCHROME2", frames = 1 } = {}) {
  const parts = [
    el(0x0008, 0x0060, "CS", cs("MR")),
    el(0x0028, 0x0002, "US", us(1)),
    el(0x0028, 0x0004, "CS", cs(photometric)),
    el(0x0028, 0x0008, "IS", cs(String(frames))),
  ];
  if (rows) parts.push(el(0x0028, 0x0010, "US", us(rows)));
  if (cols) parts.push(el(0x0028, 0x0011, "US", us(cols)));
  parts.push(el(0x0028, 0x0100, "US", us(bits)));
  parts.push(el(0x0028, 0x0103, "US", us(0)));
  const px = bytes === null ? Buffer.alloc(rows * cols * (bits === 8 ? 1 : 2)) : bytes;
  parts.push(el(0x7fe0, 0x0010, bits === 8 ? "OB" : "OW", px));
  return Buffer.concat(parts);
}
const asBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);

/* ---- 1. parse time: bad pixel data is refused, never stored as a frame ---- */
{
  const p = parseDicom(asBuffer(dcm({ rows: 4, cols: 4, bits: 16, bytes: Buffer.alloc(0) })));
  ck(p.pixels === null, "empty pixel data yields no pixels");
  ck(p.pixelInfo && p.pixelInfo.problem === "empty", "empty pixel data flagged (was: black frame)");
  ck(p.pixelInfo.need === 32, "expected byte count reported");
}
{
  const p = parseDicom(asBuffer(dcm({ rows: 8, cols: 8, bits: 16, bytes: Buffer.alloc(64) })));
  ck(p.pixels === null && p.pixelInfo.problem === "short", "truncated pixel data flagged as short");
  ck(p.pixelInfo.have === 64 && p.pixelInfo.need === 128, "have/need exposed for the report");
}
{
  const data = Buffer.alloc(4 * 4 * 2);
  for (let i = 0; i < data.length; i += 2) data.writeUInt16LE(i * 7, i);
  const p = parseDicom(asBuffer(dcm({ rows: 4, cols: 4, bits: 16, bytes: data })));
  ck(p.pixels !== null, "valid 16-bit frame accepted");
  ck(p.pixelInfo.problem === "", "valid frame carries no problem");
  ck(p.pixels.info && p.pixels.info.need === 32, "frame keeps its pixel info for diagnostics");
  ck(p.pixels.data.length === 16, "16-bit data length is rows*cols");
}
{
  const data = Buffer.alloc(4 * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 13) & 255;
  const p = parseDicom(asBuffer(dcm({ rows: 4, cols: 4, bits: 8, bytes: data })));
  ck(p.pixels !== null && p.pixelInfo.problem === "" && p.pixelInfo.bpp === 1, "valid 8-bit frame accepted");
}
{
  /* an odd trailing byte used to throw on new Uint16Array and lose the whole file */
  const data = Buffer.alloc(4 * 4 * 2 + 1);
  let threw = "";
  let p = null;
  try { p = parseDicom(asBuffer(dcm({ rows: 4, cols: 4, bits: 16, bytes: data }))); } catch (e) { threw = String(e); }
  ck(!threw, "odd trailing byte no longer throws: " + threw);
  ck(p && p.pixels && p.pixels.data.length === 16, "odd trailing byte trimmed to the frame");
}
{
  const p = parseDicom(asBuffer(dcm({ rows: 0, cols: 0, bits: 16, bytes: Buffer.alloc(8) })));
  ck(p.pixels === null && p.pixelInfo.problem === "nosize", "no rows/cols flagged instead of guessed");
}

/* ---- 2. pixelProblem / pixelProblemText ---- */
ck(pixelProblem(null) === "noframe", "missing frame detected");
ck(pixelProblem({ w: 8, h: 8, data: new Uint16Array(0) }) === "empty", "empty data detected");
ck(pixelProblem({ w: 8, h: 8, data: new Uint16Array(20) }) === "short", "short data detected");
ck(pixelProblem({ w: 4, h: 4, data: new Uint16Array(16).fill(7) }) === "flat", "uniform data detected (would be blank)");
{
  const d = new Uint16Array(64);
  for (let i = 0; i < 64; i++) d[i] = i * 3;
  ck(pixelProblem({ w: 8, h: 8, data: d }) === "", "a real image has no problem");
  ck(pixelProblemText({ w: 8, h: 8, data: d }, "ar") === "", "no message for a real image");
}
ck(/len=0/.test(pixelProblemText({ w: 8, h: 8, data: new Uint16Array(0) }, "en")), "message carries the numbers");
ck(pixelProblemText({ w: 4, h: 4, data: new Uint16Array(16).fill(7) }, "ar").includes("متطابقة"), "Arabic message in Arabic mode");
ck(/min = max/.test(pixelProblemText({ w: 4, h: 4, data: new Uint16Array(16).fill(7) }, "en")), "English message in English mode");

/* ---- 3. drawFrame draws the reason, never a black rectangle ---- */
function paintCanvas() {
  const calls = { put: 0, text: [], fill: 0, last: null };
  const ctx = {
    createImageData: (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }),
    putImageData: (im) => { calls.put++; calls.last = im; },
    fillRect: () => { calls.fill++; },
    strokeRect: () => {},
    measureText: (t) => ({ width: String(t).length * 7 }),
    fillText: (t) => { calls.text.push(String(t)); },
    save: () => {}, restore: () => {},
    set fillStyle(v) {}, get fillStyle() { return ""; },
    set strokeStyle(v) {}, get strokeStyle() { return ""; },
    set lineWidth(v) {}, get lineWidth() { return 1; },
    set font(v) {}, get font() { return ""; },
    set textBaseline(v) {}, get textBaseline() { return ""; },
  };
  let w = 0, h = 0;
  return { calls, get width() { return w; }, set width(v) { w = v; }, get height() { return h; }, set height(v) { h = v; }, getContext: () => ctx };
}
const greySpread = (im) => {
  const a = im.data;
  let mn = 255, mx = 0;
  for (let j = 0; j < a.length; j += 4) { const g = a[j]; if (g < mn) mn = g; if (g > mx) mx = g; }
  return mx - mn;
};
{
  const cv = paintCanvas();
  drawFrame(cv, { w: 64, h: 64, data: new Uint16Array(0) }, "auto", "MR");
  ck(cv.calls.put === 0, "no pixel blit when there is no pixel data");
  ck(cv.calls.text.join(" ").includes("لا توجد بيانات صورة"), "canvas states the reason in words");
}
{
  const cv = paintCanvas();
  const d = new Uint16Array(64 * 64);
  for (let i = 0; i < d.length; i++) d[i] = i % 500;
  drawFrame(cv, { w: 64, h: 64, data: d }, "auto", "MR");
  ck(cv.calls.put === 1, "a real image is still blitted normally");
  ck(cv.calls.text.length === 0, "no reason plate on a healthy frame");
}

/* ---- 4. wiring: ingest refuses them, MPR refuses them, UI has a place to say so ---- */
const src = fs.readFileSync(new URL("../app.v108.js", import.meta.url), "utf-8");
ck(src.includes("if (pixelProblem(px)) { bad++"), "ingest counts files with unreadable pixels");
ck(src.includes("if (!study.frames.length) { bad++; continue; }"), "a study with no drawable frame is not stored");
ck(src.includes("const badFrame = frames.find((f) => pixelProblem(f));"), "MPR refuses to reslice blank frames");
ck(src.includes("showPixelNote(f0);"), "viewer shows the reason under the image");
ck(src.includes("function copyDiagnostics(px)"), "one-tap diagnostics report for support");
ck(/len=" \+ st\.len/.test(src), "meta line exposes len/need for forensics");
const ui = fs.readFileSync(new URL("../ui.v108.html", import.meta.url), "utf-8");
ck(ui.includes('id="img-note"') && ui.includes('id="img-note-copy"'), "viewer has a diagnostics box + copy button");
ck(ui.includes('id="img-note-text"'), "diagnostics text node present");

/* ---- 5. a collapsed window must not paint a flat frame ---- */
{
  const d = new Uint16Array(64 * 64).fill(4000);
  for (let i = 0; i < 6; i++) d[i * 7] = i % 2 ? 0 : 4095;
  const cv = paintCanvas();
  drawFrame(cv, { w: 64, h: 64, data: d }, "auto", "MR");
  const im = cv.calls.last;
  let white = 0, n = 0;
  if (im) { for (let j = 0; j < im.data.length; j += 4) { if (im.data[j] === 255) white++; n++; } }
  ck(!im || white / n < 0.9, "collapsed window no longer paints a flat frame");
}
{
  const d = new Uint16Array(64 * 64).fill(500);
  for (let i = 0; i < 40; i++) d[i * 97 % d.length] = 200 + (i % 300);
  const cv = paintCanvas();
  drawFrame(cv, { w: 64, h: 64, data: d }, "auto", "MR");
  ck(cv.calls.last && greySpread(cv.calls.last) > 20, "background-aware rescue restores contrast");
}
{
  const d = new Int16Array(64 * 64).fill(1200);
  for (let i = 0; i < d.length; i += 3) d[i] = 300 + (i % 900);
  const cv = paintCanvas();
  drawFrame(cv, { w: 64, h: 64, data: d }, "bone", "CT");
  ck(cv.calls.put === 1, "explicit CT preset renders");
}
{
  const d = new Uint16Array(32 * 32).fill(500);
  for (let i = 0; i < 6; i++) d[i] = 499;
  const cv = paintCanvas();
  drawFrame(cv, { w: 32, h: 32, data: d }, "auto", "MR");
  ck(cv.calls.text.join(" ").includes("لا توجد بيانات صورة"), "hopeless frame ends in a reason plate");
}
{
  const d = new Uint16Array(32 * 32);
  for (let i = 0; i < d.length; i++) d[i] = 100 + (i % 900);
  const cv = paintCanvas();
  drawFrame(cv, { w: 32, h: 32, data: d, __img: { k: "auto|MR", img: { data: new Uint8ClampedArray(32 * 32 * 4) } } }, "auto", "MR");
  ck(cv.calls.last && greySpread(cv.calls.last) > 20, "stale blank cache re-rendered instead of replayed");
}
ck(src.includes("windowOutsideMode(d, n)"), "drawFrame re-windows outside the dominant band");
ck(src.includes("const poorRender = (r) =>"), "collapse detection covers flat and clipped renders");
ck(src.includes('const autoWin = !(win && modality === "CT")'), "only the automatic window is rescued");
ck(!/current\.frames\[sliceIdx\(\)\]/.test(src), "no study-wide indexing left after series scoping");
ck(src.includes("resetView(true, f0)"), "viewer fit sizes the canvas from the drawn frame");
ck(src.includes("resetView(fit, frameOverride)"), "resetView accepts the drawn frame");
ck(/const f = curFrame\(\) \|\| current\.frames\[0\];/.test(src), "annotation layer reads the series-local frame");
ck(src.includes("let mn2 = Infinity, mx2 = -Infinity;"), "full-range window is the last resort before the plate");

/* ---- 6. diagnostics pages must never be served stale ---- */
const probeSrc = fs.readFileSync(new URL("../probe.html", import.meta.url), "utf-8");
ck(probeSrc.includes('from "./dicom.v108.js"'), "probe page imports the current parser");
ck(probeSrc.includes('const PROBE_BUILD = "v108"'), "probe prints its own build (a cached copy is detectable)");
ck(probeSrc.includes("function windowReport"), "probe recomputes the viewer window");
ck(probeSrc.includes("greySpread="), "probe reports the grey spread (0 = blank render)");
ck(probeSrc.includes("hist16%="), "probe prints a 16-bucket histogram");
const sw = fs.readFileSync(new URL("../sw.v108.js", import.meta.url), "utf-8");
ck(sw.includes("NEVER_CACHED") && sw.includes("(probe|diag)") && sw.includes(".test(url.pathname)"), "service worker never caches the diagnostics pages");
ck(sw.indexOf("NEVER_CACHED.test(url.pathname)") < sw.indexOf('if (e.request.mode === "navigate")'), "the bypass runs before any cache lookup");
ck(!sw.includes("(probe|diag|start|index)"), "start/index stay cached: offline escape hatches");
const vj = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf-8"));
ck(vj.headers[0].source.includes("probe") && vj.headers[0].source.includes("diag"), "host config: diagnostics pages are no-store");
ck(vj.headers[0].headers.some((h) => String(h.value).includes("no-store")), "host config sends Cache-Control: no-store");
ck(vj.rewrites.some((r) => r.destination === "/probe.html"), "host config: /p reaches the probe");

/* ---- 7. on-image diagnostics: one screenshot must be enough to debug ---- */
ck(src.includes("export function diagLines(f, extra)"), "diagnostics text builder exists");
ck(src.includes('APP_BUILD + " • "'), "diagnostics line carries the build");
ck(src.includes('" • len="'), "diagnostics line carries size and buffer length");
ck(/"win=" \+ \(w \? Math\.round\(w\.lo\)/.test(src), "diagnostics line carries the window actually used");
ck(src.includes('ovPrefD("rrai-ov-diag", false)'), "diagnostics layer is opt-in (off by default)");
ck(src.includes("function ovPrefD(k, def)"), "unset preference keys have a real default");
ck(src.includes("].concat(diagLines(pixels));"), "the reason plate carries the numbers too");
ck(src.includes("pixels.__spread = spread;"), "render outcome recorded on the frame");
ck(ui.includes('id="ov-diag-chk"'), "settings has a diagnostics-layer switch");
ck(ui.includes('id="dx-foot"') && ui.includes('id="dx-foot-ok"'), "not-certified notice with an acknowledge button");
ck(ui.includes("mpr-pane-axial") && ui.includes(".mpr-pane.max"), "MPR panes can be maximised");
ck(src.includes("function mprSetMax(pl)") && src.includes("function mprWireMax()"), "pane maximise is wired");
ck(src.includes('localStorage.setItem("rrai-dx-ack", "1")'), "the notice can be dismissed for good");

console.log(fails ? "pixels: " + fails + " FAIL" : "pixels: ok");
process.exit(fails ? 1 : 0);
