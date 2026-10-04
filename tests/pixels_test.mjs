/* A frame that cannot be drawn must never render as a silent black rectangle.
   This suite locks that rule: refuse bad pixel data at parse time, say why on
   the canvas and in the viewer, and never feed blank frames to MPR. */
import { parseDicom } from "../dicom.v105.js";
import { drawFrame, pixelProblem, pixelProblemText } from "../app.v105.js";
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
const src = fs.readFileSync(new URL("../app.v105.js", import.meta.url), "utf-8");
ck(src.includes("if (pixelProblem(px)) { bad++"), "ingest counts files with unreadable pixels");
ck(src.includes("if (!study.frames.length) { bad++; continue; }"), "a study with no drawable frame is not stored");
ck(src.includes("const badFrame = frames.find((f) => pixelProblem(f));"), "MPR refuses to reslice blank frames");
ck(src.includes("showPixelNote(f0);"), "viewer shows the reason under the image");
ck(src.includes("function copyDiagnostics(px)"), "one-tap diagnostics report for support");
ck(/len=" \+ st\.len/.test(src), "meta line exposes len/need for forensics");
const ui = fs.readFileSync(new URL("../ui.v105.html", import.meta.url), "utf-8");
ck(ui.includes('id="img-note"') && ui.includes('id="img-note-copy"'), "viewer has a diagnostics box + copy button");
ck(ui.includes('id="img-note-text"'), "diagnostics text node present");
/* ---- 5. a dominant background must not blank the image ---- */
const spread = (im) => {
  const a = im.data;
  let mn = 255, mx = 0;
  for (let j = 0; j < a.length; j += 4) { const g = a[j]; if (g < mn) mn = g; if (g > mx) mx = g; }
  return mx - mn;
};
{
  /* 99% of the frame is one value (air/padding): the 2-98% window collapses to lo == hi
     and every pixel used to map to the same grey — the "black image" report. */
  const d = new Uint16Array(64 * 64).fill(500);
  for (let i = 0; i < 40; i++) d[i * 97 % d.length] = 200 + (i % 300);
  const px2 = { w: 64, h: 64, data: d };
  ck(Math.max(...d) > Math.min(...d), "fixture: the data is NOT flat (so no early plate)");
  ck(pixelProblem(px2) === "", "a dominant-background frame has no data problem");
  const cv = paintCanvas();
  drawFrame(cv, px2, "auto", "MR");
  ck(cv.calls.put === 1, "image is painted");
  ck(cv.calls.last && spread(cv.calls.last) > 20, "background-aware rescue restores contrast (was: solid black)");
  ck(px2.__win && px2.__win.hi > px2.__win.lo, "rescued window is remembered for the next slice");
  ck(!px2.__blank, "rescued frame is not flagged blank");
}
{
  /* nothing left to rescue: everything sits in one grey → the plate, never a black rectangle */
  const d = new Uint16Array(32 * 32).fill(500);
  for (let i = 0; i < 6; i++) d[i] = 499;
  const px3 = { w: 32, h: 32, data: d };
  const cv = paintCanvas();
  drawFrame(cv, px3, "auto", "MR");
  ck(cv.calls.put === 0, "no blit when the rescue cannot help");
  ck(cv.calls.text.join(" ").includes("لا توجد بيانات صورة"), "canvas explains the blank render");
  ck(px3.__blank === 1, "blank render flagged for the viewer note");
}
{
  /* a blank ImageData cached by an older build must not be trusted again */
  const d = new Uint16Array(32 * 32);
  for (let i = 0; i < d.length; i++) d[i] = 100 + (i % 900);
  const px4 = { w: 32, h: 32, data: d, __img: { k: "auto|MR", img: { data: new Uint8ClampedArray(32 * 32 * 4) } } };
  const cv = paintCanvas();
  drawFrame(cv, px4, "auto", "MR");
  ck(cv.calls.last && spread(cv.calls.last) > 20, "stale blank cache re-rendered instead of replayed");
}
ck(src.includes("windowOutsideMode(d, n)"), "drawFrame re-windows outside the dominant band");
ck(src.includes("imgSpread(pixels.__img.img) >= 2"), "a cached blank image is rejected");
ck(src.includes('drawReasonPlate(canvas, pixels, "blank")'), "a blank render ends in a reason plate");
ck(src.includes('pixels.__blank = 1'), "blank render recorded on the frame");
ck(src.includes('(px && px.__blank) ? "blank" : ""'), "viewer note covers render-time blanks");
ck(src.includes('+ " • " + APP_BUILD;'), "viewer header shows the build (any screenshot identifies the version)");

const probe = fs.readFileSync(new URL("../probe.html", import.meta.url), "utf-8");
ck(probe.includes('from "./dicom.v105.js"'), "DICOM probe page imports the current parser");
ck(probe.includes("problem=") && probe.includes("pixelBytes="), "probe reports pixel bytes vs needed bytes");
ck(probe.includes("نسخ التقرير"), "probe has a copy-report button (Arabic UI)");

console.log(fails ? "pixels: " + fails + " FAIL" : "pixels: ok");
process.exit(fails ? 1 : 0);
