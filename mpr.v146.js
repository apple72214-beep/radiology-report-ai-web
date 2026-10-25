/* Radiology report AI — multi-planar reconstruction (MPR).
   Pure, dependency-free maths: build an isotropic-ish volume out of a stack of
   axial slices, then reslice it into axial / coronal / sagittal planes.
   No external libraries, no DOM, nothing leaves the device. */

const PLANE = { axial: "axial", coronal: "coronal", sagittal: "sagittal" };

const med = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function spacingOf(frame) {
  // DICOM PixelSpacing is [row spacing (y), column spacing (x)] in mm.
  const sp = frame && frame.spacing;
  if (Array.isArray(sp) && sp.length >= 2 && sp[0] > 0 && sp[1] > 0) return { sy: sp[0], sx: sp[1] };
  return { sy: 1, sx: 1 };
}

function normalFrom(iop) {
  if (!iop || iop.length < 6) return null;
  const a = [iop[0], iop[1], iop[2]];
  const b = [iop[3], iop[4], iop[5]];
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!len) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Integer storage when the values allow it — halves the memory of a big volume. */
function storageFor(min, max, allInt, n) {
  if (allInt && min >= -32768 && max <= 32767) return new Int16Array(n);
  if (allInt && min >= 0 && max <= 65535) return new Uint16Array(n);
  return new Float32Array(n);
}

/**
 * Build a volume from a stack of frames.
 * @param {Array} frames  frame objects ({w,h,data,kind,spacing,geometry})
 * @param {Object} opts   { maxVoxels, flipZ }
 * @returns {{ok:boolean, reason?:string, nx:number, ny:number, nz:number,
 *            sx:number, sy:number, sz:number, data:*, min:number, max:number,
 *            downsample:number, ordered:boolean, flipZ:boolean}}
 */
export function volumeFromFrames(frames, opts) {
  opts = opts || {};
  const maxVoxels = opts.maxVoxels || 40e6;
  if (!Array.isArray(frames) || frames.length < 2) return { ok: false, reason: "need at least 2 slices" };
  const f0 = frames[0];
  if (!f0 || !f0.data || !f0.w || !f0.h) return { ok: false, reason: "frames carry no pixel data" };
  if (f0.kind === "rgb") return { ok: false, reason: "colour volumes are not resliced" };
  const w = f0.w, h = f0.h;
  for (const f of frames) {
    if (!f || f.w !== w || f.h !== h || !f.data) return { ok: false, reason: "slices differ in size" };
  }

  /* --- order the stack along the slice normal ---------------------------- */
  const n = normalFrom(frames[0].geometry && frames[0].geometry.iop);
  let order = frames.map((f, i) => i);
  let zs = null;
  if (n && frames.every((f) => f.geometry && f.geometry.ipp && f.geometry.ipp.length === 3)) {
    zs = frames.map((f) => {
      const p = f.geometry.ipp;
      return p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    });
    order = order.slice().sort((a, b) => zs[a] - zs[b]);
  } else if (frames.every((f) => f.geometry && typeof f.geometry.instanceNumber === "number" && f.geometry.instanceNumber > 0)) {
    order = order.slice().sort((a, b) => frames[a].geometry.instanceNumber - frames[b].geometry.instanceNumber);
  }

  /* --- in-plane + through-plane spacing --------------------------------- */
  const sp = spacingOf(f0);
  let sz = 0;
  if (zs) {
    const diffs = [];
    for (let i = 1; i < order.length; i++) {
      const d = Math.abs(zs[order[i]] - zs[order[i - 1]]);
      if (d > 1e-4) diffs.push(d);
    }
    if (diffs.length) sz = med(diffs);
  }
  if (!sz) {
    for (const i of order) {
      const g = frames[i].geometry || {};
      if (g.spacingBetweenSlices > 0) { sz = g.spacingBetweenSlices; break; }
      if (g.sliceThickness > 0) { sz = g.sliceThickness; break; }
    }
  }
  if (!sz || !(sz > 0)) sz = Math.max(sp.sx, sp.sy);

  /* --- downsample if the volume would not fit comfortably ---------------- */
  let nx0 = w, ny0 = h, nz = order.length;
  let ds = 1;
  while (nx0 * ny0 * nz > maxVoxels && ds < 4) {
    ds += 1;
    nx0 = Math.max(1, Math.floor(w / ds));
    ny0 = Math.max(1, Math.floor(h / ds));
  }

  const sx = sp.sx * ds, sy = sp.sy * ds;
  const nx = nx0, ny = ny0;
  const total = nx * ny * nz;

  let min = Infinity, max = -Infinity;
  for (const idx of order) {
    const d = frames[idx].data;
    const step = Math.max(1, Math.floor(d.length / 20000));
    for (let i = 0; i < d.length; i += step) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
  }
  const allInt = frames.every((f) => f.data instanceof Int16Array || f.data instanceof Uint16Array ||
                                     f.data instanceof Int8Array || f.data instanceof Uint8Array);
  const out = storageFor(min, max, allInt, total);

  for (let z = 0; z < nz; z++) {
    const src = frames[order[z]].data;
    const base = z * nx * ny;
    for (let y = 0; y < ny; y++) {
      const sy0 = y * ds, ro = sy0 * w, ro2 = base + y * nx;
      for (let x = 0; x < nx; x++) out[ro2 + x] = src[ro + x * ds];
    }
  }
  return {
    ok: true, nx, ny, nz, sx, sy, sz, data: out, min, max,
    downsample: ds, ordered: !!zs, flipZ: opts.flipZ !== false,
  };
}

/** {w,h,n,sx,sy} of a plane: pixel size + how many slices it has. */
export function planeDims(vol, plane) {
  if (!vol || !vol.ok) return { w: 0, h: 0, n: 0, sx: 1, sy: 1 };
  if (plane === PLANE.coronal) return { w: vol.nx, h: vol.nz, n: vol.ny, sx: vol.sx, sy: vol.sz };
  if (plane === PLANE.sagittal) return { w: vol.ny, h: vol.nz, n: vol.nx, sx: vol.sy, sy: vol.sz };
  return { w: vol.nx, h: vol.ny, n: vol.nz, sx: vol.sx, sy: vol.sy };
}

const zToRow = (vol, z) => (vol.flipZ ? vol.nz - 1 - z : z);
const rowToZ = (vol, r) => (vol.flipZ ? vol.nz - 1 - r : r);

/** Extract one plane as a frame-shaped object ({w,h,data,kind,spacing}). */
export function planeImage(vol, plane, index) {
  const d = planeDims(vol, plane);
  if (!d.n) return null;
  const i = Math.max(0, Math.min(d.n - 1, index | 0));
  const out = new (vol.data instanceof Float32Array ? Float32Array : Int32Array)(d.w * d.h);
  const V = vol.data;
  if (plane === PLANE.coronal) {
    for (let r = 0; r < d.h; r++) {
      const z = rowToZ(vol, r), base = z * vol.nx * vol.ny + i * vol.nx, ro = r * d.w;
      for (let x = 0; x < d.w; x++) out[ro + x] = V[base + x];
    }
  } else if (plane === PLANE.sagittal) {
    for (let r = 0; r < d.h; r++) {
      const z = rowToZ(vol, r), base = z * vol.nx * vol.ny, ro = r * d.w;
      for (let y = 0; y < d.w; y++) out[ro + y] = V[base + y * vol.nx + i];
    }
  } else {
    const base = i * vol.nx * vol.ny;
    for (let k = 0; k < d.w * d.h; k++) out[k] = V[base + k];
  }
  return { w: d.w, h: d.h, data: out, kind: "gray", photometric: "MONOCHROME2", spacing: [d.sy, d.sx] };
}

/** Which slice of this plane shows volume coordinate c = {x,y,z}. */
export function planeIndexFor(vol, plane, c) {
  if (plane === PLANE.coronal) return c.y | 0;
  if (plane === PLANE.sagittal) return c.x | 0;
  return c.z | 0;
}

/** Click at pixel (px,py) on a plane → volume coordinate {x,y,z}. */
export function pointToVolume(vol, plane, index, px, py) {
  const d = planeDims(vol, plane);
  const x0 = Math.max(0, Math.min(d.w - 1, px | 0));
  const y0 = Math.max(0, Math.min(d.h - 1, py | 0));
  if (plane === PLANE.coronal) return { x: x0, y: index | 0, z: rowToZ(vol, y0) };
  if (plane === PLANE.sagittal) return { x: index | 0, y: x0, z: rowToZ(vol, y0) };
  return { x: x0, y: y0, z: index | 0 };
}

/** Volume coordinate → pixel inside a plane (for the crosshair). */
export function volumeToPlanePixel(vol, plane, c) {
  if (plane === PLANE.coronal) return { px: c.x, py: zToRow(vol, c.z) };
  if (plane === PLANE.sagittal) return { px: c.y, py: zToRow(vol, c.z) };
  return { px: c.x, py: c.y };
}

/** True when through-plane spacing is far coarser than in-plane (reformats are approximate). */
export function isAnisotropic(vol) {
  if (!vol || !vol.ok) return false;
  const inPlane = Math.min(vol.sx, vol.sy) || 1;
  return vol.sz / inPlane > 2.5;
}

export { PLANE };
