/* Radiology report AI — viewer state: one object, one reducer, no DOM.

   Why this file exists. The viewer's state used to live in a dozen module-level
   variables — vk, vx, vy, fitK, viewKey, measureMode, mprOn, allOn,
   currentSeries — each written from a different handler. Two of them could
   disagree and the screen then showed a third thing: that is how the black
   frame and the dead slice bar survived so long. This module keeps the whole
   viewer state in ONE plain object and changes it in exactly ONE place: a pure
   reducer, so it can be tested with `node` and no browser, and no handler can
   move one field without moving the others with it.

   Deliberately NOT here: React, TypeScript, Cornerstone3D, or any dependency.
   This app runs from one file with no network at all; a framework would break
   the offline edition, the byte-exact integrity table and the test harness.
   The model below takes the shape that a desktop viewer would model — series,
   slice, tool, layout, zoom/pan, window/level, cine, hidden identity — and adds
   what a radiology viewer on a phone actually needs: per-series resliceability,
   spacing in millimetres, and the reason a series cannot be reformatted. */

export const TOOLS = ["scroll", "pan", "zoom", "measure"];
export const LAYOUTS = ["single", "mpr", "all", "compare"];
export const PLANES = ["axial", "coronal", "sagittal"];

/* The viewer's own zoom is relative to the fit-to-screen factor, so these are
   the bounds of that relative factor — the same 0.5–8 the wheel and keys used. */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
export const CINE_MS_MIN = 60;
export const CINE_MS_MAX = 2000;
export const CINE_MS_DEFAULT = 400;

export function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
export function clampZoom(k) { return clampNum(k, MIN_ZOOM, MAX_ZOOM); }
/** A slice index is only meaningful against a total: never past the last one. */
export function clampSlice(i, total) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  if (t < 2) return 0;
  return clampNum(Math.floor(Number(i) || 0), 0, t - 1);
}

/* --- how the picture is turned ---------------------------------------------
   The turn is a CSS transform on the wrapper, so a tap on the screen is a point
   in the TURNED picture, not in the pixels the file holds. These three pure
   functions move a point between the two. Every measurement and every pixel
   value goes through them — which is why they are tested: if they disagreed,
   a line drawn on a rotated image would measure a different piece of the
   patient than the one under the physician's finger.

   Continuous coordinates: (0,0) is the corner of the first pixel, (w,h) the far
   corner of the last. Flips are applied in the TURNED (display) space, because
   "flip horizontally" must mean "left becomes right ON SCREEN". */
export function orientSize(w, h, o) {
  const rot = ((Number(o && o.rotate) || 0) % 360 + 360) % 360;
  return (rot === 90 || rot === 270) ? [h, w] : [w, h];
}
/** A point of the image -> the same point of the turned picture. */
export function orientPoint(x, y, w, h, o) {
  const st = o || {};
  const rot = ((Number(st.rotate) || 0) % 360 + 360) % 360;
  const sw = rot === 90 || rot === 270;
  let X = x, Y = y;
  if (rot === 90) { X = h - y; Y = x; }
  else if (rot === 180) { X = w - x; Y = h - y; }
  else if (rot === 270) { X = y; Y = w - x; }
  return [st.flipH ? (sw ? h : w) - X : X, st.flipV ? (sw ? w : h) - Y : Y];
}
/** A point of the turned picture -> the pixel it really is. */
export function unorientPoint(u, v, w, h, o) {
  const st = o || {};
  const rot = ((Number(st.rotate) || 0) % 360 + 360) % 360;
  const sw = rot === 90 || rot === 270;
  const X = st.flipH ? (sw ? h : w) - u : u;
  const Y = st.flipV ? (sw ? w : h) - v : v;
  if (rot === 90) return [Y, h - X];
  if (rot === 180) return [w - X, h - Y];
  if (rot === 270) return [w - Y, X];
  return [X, Y];
}

/** One row of the series list: what it is, and what it can actually show. */
function normSeries(x) {
  if (!x || typeof x !== "object") return null;
  if (x.id == null) return null;
  const sp = x.spacing && typeof x.spacing === "object" ? x.spacing : null;
  return {
    id: String(x.id),
    label: String(x.label || ""),
    modality: x.modality ? String(x.modality) : "",
    count: Math.max(0, Math.floor(Number(x.count) || 0)),
    w: Math.max(0, Math.floor(Number(x.w) || 0)),
    h: Math.max(0, Math.floor(Number(x.h) || 0)),
    /* millimetres per pixel — a measurement without it is a number, not a length */
    spacing: sp ? { x: Number(sp.x) || 0, y: Number(sp.y) || 0 } : null,
    reslice: !!x.reslice,
    reason: x.reason ? String(x.reason) : "",
  };
}

export function initialViewerState() {
  return {
    studyId: null,
    series: [],
    seriesId: null,
    sliceIndex: 0,
    totalSlices: 0,
    tool: "scroll",           // exactly one tool is live — never two at once
    layout: "single",         // single | mpr | all | compare
    zoom: 1,                  // relative to fit-to-screen
    panX: 0,
    panY: 0,
    cine: false,
    cineMs: CINE_MS_DEFAULT,
    /* null = automatic window (percentile): the default that makes MR readable */
    windowLevel: { window: null, level: null },
    identityHidden: false,
    /* v139 — how the picture is turned on screen. Display only: the pixels, the
       pixel value and every measurement stay in the acquisition's own frame. */
    invert: false,
    rotate: 0,                 // 0 | 90 | 180 | 270 — quarter turns, clockwise
    flipH: false,
    flipV: false,
    loading: false,
    error: null,
  };
}

export function seriesOf(state, id) {
  const list = state && state.series;
  if (!list || !list.length || id == null) return null;
  const want = String(id);
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === want) return list[i];
  return null;
}

/* The same djb2 hash the consult export uses, so a masked name on screen and a
   masked name in an exported package match for the same patient. */
export function identityName(name, hidden) {
  const s = String(name == null ? "" : name);
  if (!hidden || !s) return s;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "ANON-" + (h >>> 0).toString(16).slice(0, 8).toUpperCase();
}

/**
 * Pure: the same state and action always give the same next state, and the
 * state you passed in is never modified. Unknown actions and unknown values are
 * ignored rather than guessed — a viewer that silently snaps to a different
 * tool or layout is worse than one that does nothing.
 */
export function viewerReducer(state, action) {
  const s = state || initialViewerState();
  const a = action || {};
  switch (a.type) {
    case "studyLoaded": {
      const list = (Array.isArray(a.series) ? a.series : []).map(normSeries).filter(Boolean);
      let pick = list.length ? list[0] : null;
      if (list.length) {
        const asked = seriesOf({ series: list }, a.seriesId == null ? null : String(a.seriesId));
        /* Most frames wins: a one-image scout sorting first used to open an
           apparently empty study with a dead slice bar. */
        pick = asked || list.reduce((b, x) => (x.count > b.count ? x : b), list[0]);
      }
      return Object.assign({}, s, {
        studyId: a.studyId == null ? null : String(a.studyId),
        series: list,
        seriesId: pick ? pick.id : null,
        sliceIndex: 0,
        totalSlices: pick ? pick.count : 0,
        /* a new study opens the way it was acquired: the previous turn
           belonged to another patient's picture */
        invert: false, rotate: 0, flipH: false, flipV: false,
        zoom: 1, panX: 0, panY: 0,
        cine: false,
        loading: false,
        error: null,
      });
    }
    case "selectSeries": {
      const it = seriesOf(s, a.seriesId == null ? null : String(a.seriesId));
      if (!it) return s;                       // unknown series: do not guess
      return Object.assign({}, s, {
        seriesId: it.id, sliceIndex: 0, totalSlices: it.count,
        zoom: 1, panX: 0, panY: 0, cine: false, error: null,
      });
    }
    case "setSlice": {
      const total = a.total === undefined ? s.totalSlices : Math.max(0, Math.floor(Number(a.total) || 0));
      const i = clampSlice(a.index, total);
      /* A manual move ends the loop; the loop's own tick keeps it running. */
      const cine = a.keepCine ? s.cine : false;
      if (i === s.sliceIndex && total === s.totalSlices && cine === s.cine) return s;
      return Object.assign({}, s, { sliceIndex: i, totalSlices: total, cine });
    }
    case "stepSlice": {
      const i = clampSlice(s.sliceIndex + (Number(a.delta) || 0), s.totalSlices);
      if (i === s.sliceIndex) return s;
      return Object.assign({}, s, { sliceIndex: i, cine: false });
    }
    case "cineTick": {
      if (!s.cine || s.totalSlices < 2) return s;
      return Object.assign({}, s, { sliceIndex: (s.sliceIndex + 1) % s.totalSlices });
    }
    case "setTool": {
      if (TOOLS.indexOf(a.tool) < 0) return s;
      if (a.tool === s.tool) return s;
      return Object.assign({}, s, { tool: a.tool });
    }
    case "setLayout": {
      if (LAYOUTS.indexOf(a.layout) < 0) return s;
      if (a.layout === s.layout) return s;
      /* Changing the hanging stops the loop: the panes are different images. */
      return Object.assign({}, s, { layout: a.layout, cine: false });
    }
    case "setZoom": {
      const z = clampZoom(a.zoom);
      if (z === s.zoom) return s;
      return Object.assign({}, s, { zoom: z });
    }
    case "zoomBy": {
      const f = Number(a.factor) || 1;
      const z = clampZoom(s.zoom * f);
      if (z === s.zoom) return s;
      return Object.assign({}, s, { zoom: z });
    }
    case "panBy": {
      const dx = Number(a.dx) || 0, dy = Number(a.dy) || 0;
      if (!dx && !dy) return s;
      return Object.assign({}, s, { panX: s.panX + dx, panY: s.panY + dy });
    }
    case "resetView": {
      if (s.zoom === 1 && !s.panX && !s.panY) return s;
      return Object.assign({}, s, { zoom: 1, panX: 0, panY: 0 });
    }
    case "toggleCine": {
      const on = a.on === undefined ? !s.cine : !!a.on;
      /* One image has nothing to loop over — say so by refusing, not by spinning. */
      const cine = on ? s.totalSlices > 1 : false;
      if (cine === s.cine) return s;
      return Object.assign({}, s, { cine });
    }
    case "setCineMs": {
      const ms = clampNum(a.ms, CINE_MS_MIN, CINE_MS_MAX);
      if (ms === s.cineMs) return s;
      return Object.assign({}, s, { cineMs: ms });
    }
    case "setWindowLevel": {
      const w = a.window === undefined || a.window === null ? null : Number(a.window);
      const l = a.level === undefined || a.level === null ? null : Number(a.level);
      const wl = {
        window: w !== null && isFinite(w) ? w : null,
        level: l !== null && isFinite(l) ? l : null,
      };
      if (wl.window === s.windowLevel.window && wl.level === s.windowLevel.level) return s;
      return Object.assign({}, s, { windowLevel: wl });
    }
    case "toggleIdentity": {
      const hid = a.on === undefined ? !s.identityHidden : !!a.on;
      if (hid === s.identityHidden) return s;
      return Object.assign({}, s, { identityHidden: hid });
    }
    case "toggleInvert": {
      const on = a.on === undefined ? !s.invert : !!a.on;
      if (on === s.invert) return s;
      return Object.assign({}, s, { invert: on });
    }
    case "rotate90": {
      /* Only the four quarter turns exist: four of them is the picture you
         started from, and anything else would leave the anatomy at an angle no
         one asked for. */
      const step = Number(a.step) === -1 ? -1 : 1;
      const rot = ((((s.rotate | 0) + step * 90) % 360) + 360) % 360;
      if (rot === s.rotate) return s;
      return Object.assign({}, s, { rotate: rot });
    }
    case "toggleFlip": {
      /* h and v are the only axes a picture has; an unknown axis is ignored
         rather than guessed. */
      if (a.axis !== "h" && a.axis !== "v") return s;
      const key = a.axis === "h" ? "flipH" : "flipV";
      const on = a.on === undefined ? !s[key] : !!a.on;
      return on === s[key] ? s : Object.assign({}, s, { [key]: on });
    }
    case "resetOrientation": {
      if (!s.invert && !s.rotate && !s.flipH && !s.flipV) return s;
      return Object.assign({}, s, { invert: false, rotate: 0, flipH: false, flipV: false });
    }
    case "setLoading": {
      const ld = !!a.loading;
      if (ld === s.loading) return s;
      return Object.assign({}, s, { loading: ld });
    }
    case "setError": {
      const e = a.error == null ? null : String(a.error);
      if (e === s.error) return s;
      return Object.assign({}, s, { error: e });
    }
    default:
      return s;
  }
}
