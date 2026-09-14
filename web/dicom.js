/* Minimal DICOM parser: Explicit/Implicit VR Little Endian, uncompressed. */

const LONG_VRS = new Set(["OB", "OW", "OF", "SQ", "UC", "UN", "UR", "UT"]);

function tagKey(g, e) {
  return `${g.toString(16).padStart(4, "0")},${e.toString(16).padStart(4, "0")}`;
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
  let pixels = null;
  if (pixelData && rows && cols) {
    if (photometric.startsWith("RGB") || num(tags["0028,0002"]) === 3) {
      pixels = { kind: "rgb", w: cols, h: rows, data: new Uint8Array(pixelData), photometric };
    } else if (bitsAllocated === 8) {
      pixels = { kind: "gray", w: cols, h: rows, data: new Uint8Array(pixelData), photometric };
    } else {
      const copy = pixelData.buffer.slice(pixelData.byteOffset, pixelData.byteOffset + pixelData.length);
      const raw = signed ? new Int16Array(copy) : new Uint16Array(copy);
      let data = raw;
      if (slope !== 1 || intercept !== 0) {
        data = new Float32Array(raw.length);
        for (let i = 0; i < raw.length; i++) data[i] = raw[i] * slope + intercept;
      }
      pixels = { kind: "gray", w: cols, h: rows, data, photometric };
    }
    const sp = str(tags["0028,0030"]);
    if (sp) {
      const parts = sp.split("\\").map((x) => parseFloat(x));
      if (parts.length === 2 && parts.every((x) => x > 0)) pixels.spacing = parts;
    }
  }
  return {
    studyUid: str(tags["0020,000d"]) || "unknown-study",
    patientId: str(tags["0010,0020"]) || "unknown",
    modality: str(tags["0008,0060"]) || "OT",
    description: str(tags["0008,1030"]) || "",
    instanceNumber: num(tags["0020,0013"]) || 0,
    photometric,
    rows,
    cols,
    bitsAllocated,
    signed,
    compressed,
    pixels,
  };
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
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}
