/* Minimal DICOM parser: Explicit/Implicit VR Little Endian, uncompressed. */

const LONG_VRS = new Set(["OB", "OW", "OF", "SQ", "UC", "UN", "UR", "UT"]);

function tagKey(g, e) {
  return `${g.toString(16).padStart(4, "0")},${e.toString(16).padStart(4, "0")}`;
}

/* Is this block really 16-bit data cut in half, or 8-bit data mislabelled?
   Read as bytes, a 16-bit frame alternates low half / high half, so neighbouring
   bytes differ far more than bytes two apart (same phase) do: real CT/MR data
   measured here gives 3.4 and 7.2. An 8-bit image has no such alternation —
   neighbours differ about half as much as bytes two apart (0.53 both times).
   One threshold, a six-fold margin either side, nothing else to tune. */
function looksLike16(u8, n) {
  if (n < 32) return false;
  let d1 = 0, c1 = 0, d2 = 0, c2 = 0;
  for (let i = 0; i + 1 < n; i++) { d1 += Math.abs(u8[i] - u8[i + 1]); c1++; }
  for (let i = 0; i + 2 < n; i++) { d2 += Math.abs(u8[i] - u8[i + 2]); c2++; }
  const mad1 = c1 ? d1 / c1 : 0;
  const mad2 = c2 ? d2 / c2 : 0;
  return mad1 / (1 + mad2) > 1.6;
}

/* Some exports store one byte per pixel while the header still declares 16
   bits; others are simply cut short mid-frame. When the bytes we do have make
   a whole number of pixels, read them at that depth instead of refusing the
   file — a refused file is a black rectangle to the physician. */
function fitDepth(bytes, rows, cols, declaredBpp, hint, signed, slope, intercept) {
  if (!bytes || !rows || !cols) return null;
  const px = rows * cols;
  const le = true;
  const asU8 = (n) => {
    if (n > bytes.length) return null;
    const u = new Uint8Array(bytes.buffer, bytes.byteOffset, n);
    if (slope === 1 && intercept === 0 && !signed) return new Uint8Array(u);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (signed ? (u[i] > 127 ? u[i] - 256 : u[i]) : u[i]) * slope + intercept;
    return out;
  };
  const asU16 = (n) => {
    if (n * 2 > bytes.length) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    const rd = (i) => (signed ? dv.getInt16(i * 2, le) : dv.getUint16(i * 2, le));
    if (slope === 1 && intercept === 0) {
      const out = signed ? new Int16Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) out[i] = rd(i);
      return out;
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = rd(i) * slope + intercept;
    return out;
  };
  const cands = [];
  /* one byte per pixel: the whole frame, at 8 bits */
  if (bytes.length >= px) cands.push({ mode: "8bit", w: cols, h: rows, n: px, mk: asU8 });
  /* two bytes per pixel: as much of the frame as the bytes cover (partial rows) */
  const h16 = Math.floor(bytes.length / (cols * 2));
  if (declaredBpp === 2 && h16 >= 2) cands.push({ mode: "partial16", w: cols, h: h16, n: cols * h16, mk: asU16 });
  /* three bytes per pixel: RGB cut short */
  const h24 = Math.floor(bytes.length / (cols * 3));
  if (declaredBpp === 3 && h24 >= 2) cands.push({ mode: "partial24", w: cols, h: h24, n: cols * h24 * 3, mk: (n3) => asU8(n3) });
  if (!cands.length) return null;
  let pick = null;
  if (hint === "16" ) pick = cands.find((c) => c.mode !== "8bit") || cands[0];
  else if (hint === "8") pick = cands.find((c) => c.mode === "8bit") || cands[0];
  if (!pick) {
    const as16 = cands.length > 1 && looksLike16(new Uint8Array(bytes.buffer, bytes.byteOffset,
      Math.min(bytes.length, Math.max(px, (cands[1] ? cands[1].n * 2 : 0)))), Math.min(bytes.length, px * 2));
    pick = as16 ? (cands.find((c) => c.mode !== "8bit") || cands[0])
                : (cands.find((c) => c.mode === "8bit") || cands[0]);
  }
  if (!pick) return null;
  const data = pick.mk(pick.n);
  if (!data) return null;
  return { mode: pick.mode, w: pick.w, h: pick.h, data: data };
}

export function parseDicom(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let off = 0;
  if (bytes.byteLength > 132 &&
      String.fromCharCode(bytes[128], bytes[129], bytes[130], bytes[131]) === "DICM") {
    off = 132;
  }
  const tags = {};
  let pixelData = null;
  let compressedFragments = null;
  let implicit = false;

  // Meta group is explicit; detect implicit if first VR looks invalid.
  if (off + 8 <= bytes.byteLength) {
    const vr = String.fromCharCode(bytes[off + 4], bytes[off + 5]);
    if (!/^[A-Z]{2}$/.test(vr)) implicit = true;
  }

  while (off + 8 <= bytes.byteLength) {
    const group = dv.getUint16(off, true);
    const element = dv.getUint16(off + 2, true);
    off += 4;
    let vr = null;
    let length;
    if (group === 0xfffe) {
      length = dv.getUint32(off, true);
      off += 4;
      if (group === 0xfffe && element === 0xe000) { // item
        if (length === 0xffffffff) length = 0;
        off += length;
        continue;
      }
      continue;
    }
    if (!implicit) {
      vr = String.fromCharCode(bytes[off], bytes[off + 1]);
      off += 2;
      if (LONG_VRS.has(vr)) {
        off += 2; // reserved
        length = dv.getUint32(off, true);
        off += 4;
      } else {
        length = dv.getUint16(off, true);
        off += 2;
      }
    } else {
      length = dv.getUint32(off, true);
      off += 4;
    }
    if (length === 0xffffffff) {
      if (group === 0x7fe0 && element === 0x0010) {
        // Encapsulated pixel data: collect item fragments (skip empty BOT).
        const frags = [];
        let scan = off;
        while (scan + 8 <= bytes.byteLength) {
          const g2 = dv.getUint16(scan, true);
          const e2 = dv.getUint16(scan + 2, true);
          const l2 = dv.getUint32(scan + 4, true);
          if (g2 === 0xfffe && e2 === 0xe0dd) { scan += 8; break; }
          if (g2 === 0xfffe && e2 === 0xe000) {
            if (l2 !== 0xffffffff && l2 > 0) frags.push(bytes.subarray(scan + 8, scan + 8 + l2));
            scan += 8 + (l2 === 0xffffffff ? 0 : l2);
            continue;
          }
          break;
        }
        compressedFragments = frags;
        off = scan;
        continue;
      }
      // Undefined length: skip to sequence/item delimitation tag.
      let scan = off;
      while (scan + 8 <= bytes.byteLength) {
        const g2 = dv.getUint16(scan, true);
        const e2 = dv.getUint16(scan + 2, true);
        if (g2 === 0xfffe && (e2 === 0xe00d || e2 === 0xe0dd)) {
          scan += 8;
          break;
        }
        scan += 2;
      }
      off = scan;
      continue;
    }
    const key = tagKey(group, element);
    const slice = bytes.subarray(off, off + length);
    if (group === 0x7fe0 && element === 0x0010) {
      pixelData = slice;
    } else {
      tags[key] = decodeValue(slice, vr);
    }
    off += length;
  }

  const rows = num(tags["0028,0010"]);
  const cols = num(tags["0028,0011"]);
  const bitsAllocated = num(tags["0028,0100"]) || 16;
  const photometric = str(tags["0028,0004"]) || "MONOCHROME2";
  const tsuid = str(tags["0002,0010"]);
  const signed = num(tags["0028,0103"]) === 1;
  const slope = num(tags["0028,1053"]) || 1;
  const intercept = num(tags["0028,1052"]) || 0;
  let compressed = null;
  if (compressedFragments && compressedFragments.length) {
    let frags = compressedFragments;
    // drop basic offset table if present (first item whose first uint32 == 0)
    if (frags.length > 1 && frags[0].length >= 4 &&
        new DataView(frags[0].buffer, frags[0].byteOffset, 4).getUint32(0, true) === 0) {
      frags = frags.slice(1);
    }
    compressed = { tsuid, fragments: frags.map((f) => f.slice()) };
  }
  /* Only a header that actually states these values may settle the question:
     a missing tag means "unknown", never "zero". */
  const has = (k) => tags[k] != null && Number.isFinite(typeof tags[k] === "number" ? tags[k] : Number.parseFloat(str(tags[k])));
  const bitsStored = has("0028,0101") ? num(tags["0028,0101"]) : null;
  const hdrMax = has("0028,0107") ? num(tags["0028,0107"]) : null;   // LargestImagePixelValue
  const hdrMin = has("0028,0106") ? num(tags["0028,0106"]) : null;   // SmallestImagePixelValue
  let depthHint = "";
  if ((bitsStored != null && bitsStored > 8) || (hdrMax != null && hdrMax > 255) ||
      (hdrMin != null && hdrMin < -128)) depthHint = "16";
  else if ((bitsStored != null && bitsStored > 0 && bitsStored <= 8) ||
           (hdrMax != null && hdrMin != null && hdrMax <= 255 && hdrMin >= 0)) depthHint = "8";
  let pixels = null;
  const bppX = (photometric.startsWith("RGB") || num(tags["0028,0002"]) === 3) ? 3 : (bitsAllocated === 8 ? 1 : 2);
  const needX = (rows || 0) * (cols || 0) * bppX;
  const haveX = pixelData ? pixelData.length : 0;
  /* A frame with no (or truncated) pixel data used to sail through as a valid
     frame and render as a silent black rectangle. It is now refused here, with
     the numbers kept so the viewer can say why. */
  /* `need` counts SAMPLES (what data.length counts). The byte count lives in
     `bytes`: comparing samples against bytes made every 16-bit frame look
     short, so a complete study was refused with len=65536 need=131072. */
  const pixelInfo = {
    have: 0, need: (rows || 0) * (cols || 0), bpp: bppX,
    bytes: needX, haveBytes: haveX,
    bitsAllocated, signed, photometric,
    tsuid: tsuid || "",
    encapsulated: !!(compressedFragments && compressedFragments.length),
    slope, intercept, rows: rows || 0, cols: cols || 0,
    frames: num(tags["0028,0008"]) || 1,
    problem: "",
  };
  if (!rows || !cols) {
    pixelInfo.problem = "nosize";
  } else if (haveX < needX || needX === 0) {
    const fit = haveX > 0 ? fitDepth(pixelData, rows, cols, bppX, depthHint, signed, slope, intercept) : null;
    if (fit) {
      pixels = { kind: "gray", w: fit.w, h: fit.h, data: fit.data, photometric };
      pixelInfo.problem = "";
      pixelInfo.depthFit = fit.mode;          /* "8bit" | "partial16" | "partial24" */
      pixelInfo.declaredBits = bitsAllocated;
      pixelInfo.declaredNeed = needX;
      pixelInfo.need = fit.w * fit.h;
      pixelInfo.have = fit.data.length;
      pixelInfo.rowsShown = fit.h;
    } else {
      pixelInfo.problem = haveX === 0 ? "empty" : "short";
    }
  } else if (photometric.startsWith("RGB") || num(tags["0028,0002"]) === 3) {
    pixels = { kind: "rgb", w: cols, h: rows, data: new Uint8Array(pixelData), photometric };
  } else if (bitsAllocated === 8) {
    pixels = { kind: "gray", w: cols, h: rows, data: new Uint8Array(pixelData), photometric };
  } else {
    const copy = pixelData.buffer.slice(pixelData.byteOffset, pixelData.byteOffset + needX);
    const raw = signed ? new Int16Array(copy) : new Uint16Array(copy);
    let data = raw;
    if (slope !== 1 || intercept !== 0) {
      data = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) data[i] = raw[i] * slope + intercept;
    }
    pixels = { kind: "gray", w: cols, h: rows, data, photometric };
  }
  if (pixels) {
    pixelInfo.have = pixels.data.length;
    pixels.info = pixelInfo;
    const sp = str(tags["0028,0030"]);
    if (sp) {
      const parts = sp.split("\\").map((x) => parseFloat(x));
      if (parts.length === 2 && parts.every((x) => x > 0)) pixels.spacing = parts;
    }
    pixels.hu = slope !== 1 || intercept !== 0;
    // Volume rendering refuses ambiguous units; no changes to 2D pixel values.
    const sop=str(tags["0008,0016"])||"", rt=String(str(tags["0028,1054"])||"").trim().toUpperCase();
    pixels.volumeUnit=String(str(tags["0008,0060"])||"").trim().toUpperCase()==="CT" && has("0028,1052") && has("0028,1053") && Number.isFinite(num(tags["0028,1052"])) && Number.isFinite(num(tags["0028,1053"])) && num(tags["0028,1053"])!==0 && (rt==="HU"||(!rt&&sop==="1.2.840.10008.5.1.4.1.1.2")) && bitsAllocated===16 && !pixelInfo.depthFit && pixelInfo.frames===1 && photometric==="MONOCHROME2" ? "HU" : "";
  }
  const numList = (tg) => String(str(tg) || "").split("\\").map((x) => parseFloat(x)).filter((x) => !isNaN(x));
  const seq = {
    seriesUid: str(tags["0020,000e"]) || "",
    seriesDescription: str(tags["0008,103E"]) || "",
    seriesNumber: num(tags["0020,0011"]) || 0,
    sequenceName: str(tags["0018,0024"]) || "",
    scanningSequence: str(tags["0018,0020"]) || "",
    sequenceVariant: str(tags["0018,0021"]) || "",
    scanOptions: str(tags["0018,0022"]) || "",
    protocolName: str(tags["0018,1030"]) || "",
    imageType: str(tags["0008,0008"]) || "",
    te: num(tags["0018,0081"]) || 0,
    tr: num(tags["0018,0080"]) || 0,
    ti: num(tags["0018,0082"]) || 0,
    flip: num(tags["0018,1314"]) || 0,
    echo: num(tags["0018,0086"]) || 0,
    bValue: num(tags["0018,9087"]) || 0,
    contrast: str(tags["0018,0010"]) || "",
    sliceLocation: num(tags["0020,1041"]) || 0,
  };
  /* Date tags are frequently empty on exported studies: fall back through the
     acquisition chain so the worklist can still show when the exam was done. */
  const dStudy = str(tags["0008,0020"]) || str(tags["0008,0021"]) || str(tags["0008,0022"]) ||
                 str(tags["0008,0012"]) || str(tags["0008,0023"]) || "";
  const tStudy = str(tags["0008,0030"]) || str(tags["0008,0031"]) || "";
  const gIpp = numList(tags["0020,0032"]);
  const gIop = numList(tags["0020,0037"]);
  const geometry = {
    frameOfReferenceUid: str(tags["0020,0052"]) || "",
    sliceThickness: num(tags["0018,0050"]) || 0,
    spacingBetweenSlices: num(tags["0018,0088"]) || 0,
    ipp: gIpp.length === 3 ? gIpp : null,
    iop: gIop.length === 6 ? gIop : null,
    instanceNumber: num(tags["0020,0013"]) || 0,
  };
  return {
    studyUid: str(tags["0020,000d"]) || "unknown-study",
    seriesUid: str(tags["0020,000e"]) || "",
    patientId: str(tags["0010,0020"]) || "unknown",
    patientName: str(tags["0010,0010"]) || "",
    sex: str(tags["0010,0040"]) || "",
    age: str(tags["0010,1010"]) || "",
    studyDate: dStudy,
    studyTime: tStudy,
    studyDesc: str(tags["0008,1030"]) || "",
    bodyPart: str(tags["0018,0015"]) || "",
    modality: str(tags["0008,0060"]) || "OT",
    description: str(tags["0008,1030"]) || "",
    bodyPart: str(tags["0018,0015"]) || "",
    instanceNumber: num(tags["0020,0013"]) || 0,
    seq,
    geometry,
    photometric,
    rows,
    cols,
    bitsAllocated,
    signed,
    numberOfFrames: num(tags["0028,0008"]) || 1,
    compressed,
    pixels,
    pixelInfo,
  };
}

/** First plausible DICOM date (YYYYMMDD) among the candidates — "" when none. */
export function pickDate() {
  for (const v of arguments) {
    const s = String(v || "").trim();
    if (/^\d{8}$/.test(s)) {
      const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
      if (y >= 1800 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return s;
    }
  }
  return "";
}

function decodeValue(slice, vr) {
  if (vr === "US" && slice.length >= 2) {
    return new DataView(slice.buffer, slice.byteOffset, slice.length).getUint16(0, true);
  }
  if (vr === "UL" && slice.length >= 4) {
    return new DataView(slice.buffer, slice.byteOffset, slice.length).getUint32(0, true);
  }
  return slice;
}

function str(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return String.fromCharCode(...v).replace(/\0/g, "").trim();
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = str(v);
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseMultipartRelated(buf, contentType) {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType || "");
  const bytes = new Uint8Array(buf);
  if (!m) return [bytes];
  const marker = Array.from("--" + m[2]).map((c) => c.charCodeAt(0));
  const idx = [];
  for (let i = 0; i + marker.length <= bytes.length; i++) {
    let ok = true;
    for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker[j]) { ok = false; break; }
    if (ok) idx.push(i);
  }
  const parts = [];
  for (let k = 0; k < idx.length; k++) {
    const start = idx[k];
    const end = k + 1 < idx.length ? idx[k + 1] : bytes.length;
    let body = -1;
    for (let i = start + marker.length; i + 4 <= end; i++) {
      if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) { body = i + 4; break; }
    }
    if (body < 0) continue;
    let e = end;
    while (e > body && (bytes[e - 1] === 13 || bytes[e - 1] === 10)) e--;
    if (e > body) parts.push(bytes.slice(body, e));
  }
  return parts;
}
