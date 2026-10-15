/* A frame that cannot be drawn must never render as a silent black rectangle.
   This suite locks that rule: refuse bad pixel data at parse time, say why on
   the canvas and in the viewer, and never feed blank frames to MPR. */
import { parseDicom } from "../dicom.v122.js";
import { drawFrame, pixelProblem, pixelProblemText, fixStoredDepth } from "../app.v122.js";
import fs from "node:fs";
const build = JSON.parse(fs.readFileSync(new URL("../release.json", import.meta.url), "utf8")).build;

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

function dcm({ rows = 4, cols = 4, bits = 16, bytes = null, photometric = "MONOCHROME2", frames = 1, extra = [] } = {}) {
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
  for (const x of extra) parts.push(x);
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
  ck(p.pixelInfo.need === 16 && p.pixelInfo.bytes === 32, "sample count and byte count reported separately");
}
{
  const p = parseDicom(asBuffer(dcm({ rows: 8, cols: 8, bits: 16, bytes: Buffer.alloc(20) })));
  ck(p.pixels === null && p.pixelInfo.problem === "short", "a fragment too small to make one row is still refused");
  ck(p.pixelInfo.haveBytes === 20 && p.pixelInfo.bytes === 128, "byte counts exposed for the report");
}
{
  const data = Buffer.alloc(4 * 4 * 2);
  for (let i = 0; i < data.length; i += 2) data.writeUInt16LE(i * 7, i);
  const p = parseDicom(asBuffer(dcm({ rows: 4, cols: 4, bits: 16, bytes: data })));
  ck(p.pixels !== null, "valid 16-bit frame accepted");
  ck(p.pixelInfo.problem === "", "valid frame carries no problem");
  ck(p.pixels.info && p.pixels.info.need === 16 && p.pixels.info.bytes === 32, "frame keeps its pixel info for diagnostics");
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
  const calls = { put: 0, text: [], fill: 0 };
  const ctx = {
    createImageData: (W, H) => ({ data: new Uint8ClampedArray(W * H * 4) }),
    putImageData: () => { calls.put++; },
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
const src = fs.readFileSync(new URL("../app.v122.js", import.meta.url), "utf-8");
ck(src.includes("if (pixelProblem(px)) {") && src.includes("bad++;"), "ingest counts files with unreadable pixels");
ck(/if \(!study\.frames\.length\) \{ bad\+\+;.*continue; \}/.test(src), "a study with no drawable frame is not stored");
ck(src.includes("const badFrame = frames.find((f) => pixelProblem(f));"), "MPR refuses to reslice blank frames");
ck(src.includes("showPixelNote(f0);"), "viewer shows the reason under the image");
ck(src.includes("function copyDiagnostics(px)"), "one-tap diagnostics report for support");
ck(/len=" \+ st\.len/.test(src), "meta line exposes len/need for forensics");
const ui = fs.readFileSync(new URL("../ui.v122.html", import.meta.url), "utf-8");
ck(ui.includes('id="img-note"') && ui.includes('id="img-note-copy"'), "viewer has a diagnostics box + copy button");
ck(ui.includes('id="img-note-text"'), "diagnostics text node present");
const probe = fs.readFileSync(new URL("../probe.html", import.meta.url), "utf-8");
ck(probe.includes('from "./dicom.' + build + '.js"'), "DICOM probe page imports the current parser");
ck(probe.includes("problem=") && probe.includes("pixelBytes="), "probe reports pixel bytes vs needed bytes");
ck(probe.includes("نسخ التقرير"), "probe has a copy-report button (Arabic UI)");

/* ---- 12. short pixel data is shown at the depth it really has (v116) ---- */
{
  /* the reported case: 512x512 declared 16-bit, exactly 512x512 bytes present */
  const N = 64, W = 8;
  const data = Buffer.alloc(N);
  for (let i = 0; i < N; i++) data[i] = 20 + (i % W) * 4 + Math.floor(i / W) * 2;
  const p = parseDicom(asBuffer(dcm({ rows: 8, cols: 8, bits: 16, bytes: data })));
  ck(p.pixels !== null, "a block that is one byte per pixel is shown, not refused");
  ck(p.pixelInfo && p.pixelInfo.problem === "", "…and carries no problem (was: silent black frame)");
  ck(p.pixelInfo.depthFit === "8bit" && p.pixels.data.length === N, "…read as an 8-bit frame of the full size");
  ck(p.pixels.w === 8 && p.pixels.h === 8, "…with the declared rows and columns");
  ck(p.pixelInfo.declaredBits === 16 && p.pixelInfo.declaredNeed === 128, "…and the header's claim kept for the report");
  /* The point of the whole exercise: the viewer must agree it can draw it.
     `need` stayed at the header's claim, so the app refused the very frame the
     parser had just repaired — the import report still said pixel-problem=short. */
  ck(pixelProblem(p.pixels) === "", "…and the viewer's own drawability check accepts it");
}
{
  /* real 16-bit data: the image lives in the high byte, the low byte is detail */
  const W = 8, samples = 32;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = 1000 + (i % W) * 90 + Math.floor(i / W) * 40;   /* smooth image  */
    data.writeUInt16LE(v, i * 2);
    data[i * 2] = (i * 37) % 256;                             /* noisy low byte */
  }
  const half = data.subarray(0, 64);
  const p = parseDicom(asBuffer(dcm({ rows: 8, cols: 8, bits: 16, bytes: half })));
  ck(p.pixels !== null && p.pixelInfo.depthFit === "partial16",
     "half a 16-bit frame is recognised as 16-bit, not mistaken for 8-bit");
  ck(p.pixels.h === 4 && p.pixels.w === 8, "…and shows as many rows as the bytes cover");
}
{
  /* the header says the values exceed 8 bits: believe it, do not measure */
  const data = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) data[i] = 30 + (i % 8) * 6;
  const p = parseDicom(asBuffer(dcm({ rows: 8, cols: 8, bits: 16, bytes: data,
    extra: [el(0x0028, 0x0107, "US", us(3000))] })));
  ck(p.pixelInfo && p.pixelInfo.depthFit === "partial16",
     "LargestImagePixelValue above 255 settles the question without a measurement");
}
{
  /* frames stored by older builds: the bytes are still there, only misread */
  const f = { w: 8, h: 8, data: new Uint16Array(32), info: { bitsAllocated: 16, need: 64 } };
  for (let i = 0; i < 32; i++) f.data[i] = 0x1000 + i;
  const fx = fixStoredDepth(f);
  ck(!!fx, "a stored short frame is repaired on open, not left black");
  ck(fx && fx.data.length === 64 && fx.info.depthFit === "8bit", "…re-read as one byte per pixel");
  ck(fx && fx.data[0] === 0x00 && fx.data[1] === 0x10, "…from the bytes the device still holds");
  ck(fixStoredDepth({ w: 8, h: 8, data: new Uint16Array(64), info: {} }) === null, "a complete frame is left alone");
  ck(fixStoredDepth({ w: 8, h: 8, data: new Uint16Array(8), info: {} }) === null,
     "a frame with too few bytes is not invented");
}

/* ---- 13. a complete frame is never called short (v118) -------------------- */
{
  /* The field report read len=65536 need=131072 for files that were complete:
     `need` was a byte count while data.length counts samples, so every 16-bit
     frame looked half-empty and every 16-bit import was refused. */
  const W = 8;
  const data = Buffer.alloc(W * W * 2);
  for (let i = 0; i < W * W; i++) data.writeUInt16LE(500 + i * 13, i * 2);
  const p = parseDicom(asBuffer(dcm({ rows: W, cols: W, bits: 16, bytes: data })));
  ck(p.pixels !== null && pixelProblem(p.pixels) === "",
     "a complete 16-bit frame is accepted: need counts samples, not bytes");
  ck(p.pixelInfo.need === W * W && p.pixelInfo.bytes === W * W * 2,
     "…need is the sample count; bytes keeps the byte count");
  ck(p.pixels.data.length === W * W, "…and the frame holds one sample per pixel");
}
{
  /* the same frame at 8 bits: the two agreed only because bpp was 1 */
  const W = 8;
  const data = Buffer.alloc(W * W);
  for (let i = 0; i < W * W; i++) data[i] = (i * 11) & 255;
  const p = parseDicom(asBuffer(dcm({ rows: W, cols: W, bits: 8, bytes: data })));
  ck(p.pixels !== null && pixelProblem(p.pixels) === "", "a complete 8-bit frame is accepted");
}

/* ---- 14. nothing drawn above the image may be opaque (v119) --------------
   The main view went black for a whole study while the pixels underneath were
   perfect: #annot sits on top of #frame with `inset:0`, and the blanket rule
   `.viewer canvas{background:#000}` gave that transparent info layer an
   opaque black background — a solid sheet over a correctly painted image.
   The letterbox colour belongs to #frame and #viewport, never to a layer. */
ck(/\.viewer canvas#annot[^{]*\{[^}]*background:\s*transparent/.test(ui),
  "the stylesheet keeps #annot transparent instead of black");
ck(/\.viewer canvas#overlay[^{]*\{[^}]*background:\s*transparent/.test(ui),
  "the stylesheet keeps #overlay transparent instead of black");
ck(/id="annot"[^>]*background:\s*transparent/.test(ui),
  "#annot carries transparency inline too, so a cached stylesheet cannot undo it");
ck(/function drawAnnot\(\)[\s\S]{0,900}?cv\.style\.background = "transparent"/.test(src),
  "drawAnnot clears the layer background on every draw");
ck(/ov0\.style\.background = "transparent"/.test(src),
  "drawAnnot clears the overlay background on every draw");
ck(src.includes('why.push("opaque:" + el.id)'),
  "the audit names an opaque layer instead of staying silent");
ck(src.includes('x.indexOf("opaque:") === 0'),
  "an opaque layer is repaired like any other layout fault");
ck(/if \(an\) an\.style\.background = "transparent"/.test(src),
  "the layout repair clears #annot's background");

console.log(fails ? "pixels: " + fails + " FAIL" : "pixels: ok");
process.exit(fails ? 1 : 0);
