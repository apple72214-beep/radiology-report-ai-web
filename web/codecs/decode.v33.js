/* Lazy compressed-transfer-syntax decoders (loaded on first need, then
   runtime-cached by the service worker for offline use).
   JPEG-LS  -> CharLS wasm   |  J2K/HTJ2K -> OpenJPH wasm  |  RLE -> hand-rolled. */

let charlsP = null;
let ojphP = null;
let ojpegP = null;
let nodeRequire = null;
if (typeof document === "undefined") {
  const { createRequire } = await import("node:module");
  nodeRequire = createRequire(import.meta.url);
}
const wasmPath = (p) =>
  typeof document === "undefined" ? new URL("./" + p, import.meta.url).pathname : "./codecs/" + p;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

function getCharls() {
  if (!charlsP) {
    charlsP = nodeRequire
      ? Promise.resolve(nodeRequire("./charlswasm.js")({ locateFile: wasmPath }))
      : loadScript("./codecs/charlswasm.js?b=v33").then(() =>
          self.CharLSWASM({ locateFile: (p) => "./codecs/" + p })
        );
  }
  return charlsP;
}

function getOjph() {
  if (!ojphP) {
    ojphP = nodeRequire
      ? Promise.resolve(nodeRequire("./openjphjs.js")({ locateFile: wasmPath }))
      : loadScript("./codecs/openjphjs.js?b=v33").then(() =>
          self.Module({ locateFile: (p) => "./codecs/" + p })
        );
  }
  return ojphP;
}

function getOjpeg() {
  if (!ojpegP) {
    ojpegP = nodeRequire
      ? Promise.resolve(nodeRequire("./openjpegwasm.js")({ locateFile: wasmPath }))
      : loadScript("./codecs/openjpegwasm.js?b=v33").then(() =>
          self.OpenJPEGWASM({ locateFile: (p) => "./codecs/" + p })
        );
  }
  return ojpegP;
}

function grayFromBuffer(view, fi, photometric) {
  const w = fi.width || fi.Width;
  const h = fi.height || fi.Height;
  const bits = fi.bitsPerSample || fi.BitsPerSample || 8;
  const signed = !!(fi.isSigned || fi.Signed);
  let data;
  if (bits <= 8) data = new Uint8Array(view.slice(0, w * h));
  else {
    const src = signed ? new Int16Array(view.buffer.slice(0, w * h * 2)) : new Uint16Array(view.buffer.slice(0, w * h * 2));
    data = src;
  }
  return { kind: "gray", w, h, data, photometric: photometric || "MONOCHROME2" };
}

/* DICOM RLE (packbits, big-endian byte planes), single sample per pixel. */
function decodeRLE(fragments, meta) {
  const buf = fragments[0];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nSeg = dv.getUint32(0, true);
  if (nSeg < 1 || nSeg > 15) throw new Error("bad RLE segment count");
  const offs = [];
  for (let i = 0; i < 15; i++) offs.push(dv.getUint32(4 + i * 4, true));
  const bytesPerSample = Math.max(1, Math.ceil((meta.bitsAllocated || 8) / 8));
  const n = meta.rows * meta.cols;
  const out = new Uint8Array(n * bytesPerSample);
  for (let s = 0; s < bytesPerSample; s++) {
    const start = offs[s];
    const end = s + 1 < bytesPerSample ? offs[s + 1] : buf.byteLength;
    let p = start;
    let o = s; // plane s writes bytes at o, o+=bytesPerSample (MSB plane first)
    while (p < end) {
      const ctrl = dv.getInt8(p);
      p++;
      if (ctrl >= 0) {
        const len = ctrl + 1;
        for (let i = 0; i < len && p < end; i++, p++) { out[o] = buf[p]; o += bytesPerSample; }
      } else if (ctrl > -128) {
        const len = 1 - ctrl;
        const v = buf[p]; p++;
        for (let i = 0; i < len; i++) { out[o] = v; o += bytesPerSample; }
      }
    }
  }
  let data;
  if (bytesPerSample === 1) data = out;
  else {
    // RLE stores MSB plane first -> big-endian assemble
    data = meta.signed ? new Int16Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) data[i] = (out[i * 2] << 8) | out[i * 2 + 1];
  }
  return { kind: "gray", w: meta.cols, h: meta.rows, data, photometric: meta.photometric };
}

export async function decodeCompressed(comp, meta) {
  const ts = comp.tsuid;
  if (/^1\.2\.840\.10008\.1\.2\.5$/.test(ts)) return decodeRLE(comp.fragments, meta);
  if (/^1\.2\.840\.10008\.1\.2\.4\.(80|81)$/.test(ts)) {
    const m = await getCharls();
    const d = new m.JpegLSDecoder();
    const eb = d.getEncodedBuffer(comp.fragments[0].length);
    eb.set(comp.fragments[0]);
    d.decode();
    const fi = d.getFrameInfo();
    const px = grayFromBuffer(d.getDecodedBuffer(), fi, meta.photometric);
    d.delete();
    return px;
  }
  if (/^1\.2\.840\.10008\.1\.2\.4\.(90|91)$/.test(ts)) {
    const m = await getOjpeg();
    const d = new m.J2KDecoder();
    const eb = d.getEncodedBuffer(comp.fragments[0].length);
    eb.set(comp.fragments[0]);
    d.decode();
    const fi = d.getFrameInfo();
    const px = grayFromBuffer(d.getDecodedBuffer(), fi, meta.photometric);
    d.delete();
    return px;
  }
  if (/^1\.2\.840\.10008\.1\.2\.4\.(201|202)$/.test(ts)) {
    const m = await getOjph();
    const d = new m.HTJ2KDecoder();
    const eb = d.getEncodedBuffer(comp.fragments[0].length);
    eb.set(comp.fragments[0]);
    d.decode();
    const fi = d.getFrameInfo();
    const px = grayFromBuffer(d.getDecodedBuffer(), fi, meta.photometric);
    d.delete();
    return px;
  }
  throw new Error("unsupported transfer syntax " + ts);
}
