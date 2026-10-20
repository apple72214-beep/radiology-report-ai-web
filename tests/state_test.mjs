/* Viewer state: one object, one reducer, no DOM.
   Everything the viewer decides — which series, which slice, which tool, which
   hanging, whether the loop runs, whether the patient's name is shown — is one
   field in one object that only one function may change. These tests are the
   reason that claim can be trusted. */
import { readFileSync } from "node:fs";
import {
  TOOLS, LAYOUTS, MIN_ZOOM, MAX_ZOOM, CINE_MS_DEFAULT,
  initialViewerState, viewerReducer, seriesOf, identityName, clampZoom, clampSlice,
  orientSize, orientPoint, unorientPoint,
} from "../viewer-state.v140.js";

let fails = 0;
const eq = (a, b, m) => { if (a !== b) { fails++; console.log(`FAIL ${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };

const app = readFileSync(new URL("../app.v140.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../ui.v140.html", import.meta.url), "utf8");

const study = [
  { id: "0", label: "T1", count: 4, reslice: true },
  { id: "1", label: "T2", count: 19, reslice: true },
  { id: "2", label: "FLAIR", count: 1, reslice: false, reason: "one-frame" },
];
const loaded = viewerReducer(initialViewerState(), { type: "studyLoaded", studyId: "U1", series: study });

/* --- the study opens on the series that carries the images ---------------- */
eq(loaded.studyId, "U1", "the state knows which study is open");
eq(loaded.series.length, 3, "every series of the study is a row in the state");
eq(loaded.seriesId, "1", "the series with the most frames opens — never a one-image scout");
eq(loaded.totalSlices, 19, "the slice count comes from the chosen series, not the whole study");
eq(loaded.sliceIndex, 0, "a study opens at its first slice");
eq(viewerReducer(loaded, { type: "studyLoaded", studyId: "U1", series: study, seriesId: "0" }).seriesId, "0",
   "a caller may name the series to open");

/* --- purity: the state you passed in is never touched --------------------- */
{
  const before = JSON.stringify(loaded);
  viewerReducer(loaded, { type: "setSlice", index: 7 });
  viewerReducer(loaded, { type: "setTool", tool: "measure" });
  viewerReducer(loaded, { type: "toggleCine" });
  eq(JSON.stringify(loaded), before, "the reducer is pure: the previous state is never modified");
  eq(viewerReducer(loaded, { type: "nonsense" }), loaded, "an unknown action changes nothing at all");
}

/* --- a slice index is only meaningful against a total --------------------- */
eq(viewerReducer(loaded, { type: "setSlice", index: 7 }).sliceIndex, 7, "a slice can be set");
eq(viewerReducer(loaded, { type: "setSlice", index: 999 }).sliceIndex, 18, "a slice past the end clamps to the last one");
eq(viewerReducer(loaded, { type: "setSlice", index: -5 }).sliceIndex, 0, "a slice before the start clamps to zero");
eq(viewerReducer(loaded, { type: "stepSlice", delta: 1 }).sliceIndex, 1, "stepping forward moves one slice");
eq(viewerReducer(loaded, { type: "stepSlice", delta: -1 }).sliceIndex, 0, "stepping back stops at the first slice, it does not wrap");
eq(viewerReducer(loaded, { type: "setSlice", index: 3, total: 2 }).sliceIndex, 1, "a smaller total clamps the index with it");
eq(clampSlice(0, 1), 0, "one image has exactly one slice, index zero");
eq(viewerReducer(initialViewerState(), { type: "setSlice", index: 4 }).sliceIndex, 0, "with no study there is no slice to move to");

/* --- one tool at a time, and only a tool that exists ---------------------- */
eq(viewerReducer(loaded, { type: "setTool", tool: "measure" }).tool, "measure", "a tool can be selected");
eq(viewerReducer(loaded, { type: "setTool", tool: "scribble" }).tool, "scroll", "an unknown tool never silently switches the viewer");
ck(TOOLS.every((t) => viewerReducer(loaded, { type: "setTool", tool: t }).tool === t), "every declared tool is selectable");

/* --- the hanging is one field --------------------------------------------- */
eq(viewerReducer(loaded, { type: "setLayout", layout: "mpr" }).layout, "mpr", "the three-plane hanging");
eq(viewerReducer(loaded, { type: "setLayout", layout: "all" }).layout, "all", "the comprehensive hanging");
eq(viewerReducer(loaded, { type: "setLayout", layout: "sideways" }).layout, "single", "an unknown hanging never changes the screen");
ck(LAYOUTS.length === 4 && LAYOUTS.indexOf("compare") >= 0, "a layout exists for comparing two studies");

/* --- zoom and pan ---------------------------------------------------------- */
eq(viewerReducer(loaded, { type: "zoomBy", factor: 1.25 }).zoom, 1.25, "zooming in");
eq(viewerReducer(loaded, { type: "zoomBy", factor: 100 }).zoom, MAX_ZOOM, "zoom stops at the ceiling");
eq(viewerReducer(loaded, { type: "zoomBy", factor: 0.0001 }).zoom, MIN_ZOOM, "zoom stops at the floor");
eq(viewerReducer(loaded, { type: "setZoom", zoom: 99 }).zoom, MAX_ZOOM, "an absurd zoom is clamped, not applied");
eq(clampZoom(3), 3, "an ordinary zoom passes through untouched");
{
  const moved = viewerReducer(loaded, { type: "panBy", dx: 12, dy: -4 });
  eq(moved.panX, 12, "panning right");
  eq(moved.panY, -4, "panning up");
  const reset = viewerReducer(moved, { type: "resetView" });
  eq(reset.zoom, 1, "reset returns the zoom to fit");
  eq(reset.panX, 0, "reset returns the pan to centre");
  eq(reset.panY, 0, "reset returns the pan to centre vertically");
}

/* --- selecting a series carries the slice with it ------------------------- */
{
  const onFirst = viewerReducer(loaded, { type: "selectSeries", seriesId: "2" });
  eq(onFirst.seriesId, "2", "a series can be selected");
  eq(onFirst.totalSlices, 1, "the slice count follows the series, not the study");
  eq(onFirst.sliceIndex, 0, "selecting a series starts at its first slice");
  eq(viewerReducer(onFirst, { type: "selectSeries", seriesId: "9" }), onFirst, "an unknown series id is refused, not guessed");
  ck(seriesOf(loaded, "1").label === "T2", "a row can be found by its id");
}

/* --- cine: the loop, and the refusal to loop over one image --------------- */
{
  const running = viewerReducer(loaded, { type: "toggleCine", on: true });
  eq(running.cine, true, "the loop can start on a multi-slice series");
  eq(running.cineMs, CINE_MS_DEFAULT, "the loop has a default frame interval");
  const ticked = viewerReducer(running, { type: "cineTick" });
  eq(ticked.sliceIndex, 1, "a tick advances one slice");
  eq(viewerReducer(viewerReducer(running, { type: "setSlice", index: 18, keepCine: true }), { type: "cineTick" }).sliceIndex, 0,
     "the loop wraps back to the first slice");
  eq(viewerReducer(viewerReducer(loaded, { type: "setSlice", index: 5 }), { type: "cineTick" }).sliceIndex, 5,
     "a tick without the loop running moves nothing");
  eq(viewerReducer(running, { type: "setSlice", index: 4 }).cine, false, "moving the slice by hand stops the loop");
  eq(viewerReducer(running, { type: "setSlice", index: 4, keepCine: true }).cine, true, "the loop's own tick keeps it running");
  eq(viewerReducer(running, { type: "setLayout", layout: "mpr" }).cine, false, "changing the hanging stops the loop");
  {
    const one = viewerReducer(loaded, { type: "selectSeries", seriesId: "2" });
    eq(viewerReducer(one, { type: "toggleCine", on: true }).cine, false,
       "a one-image series refuses to loop instead of spinning on nothing");
  }
  eq(viewerReducer(loaded, { type: "setCineMs", ms: 5 }).cineMs, 60, "a frame interval too fast to watch is clamped");
  eq(viewerReducer(loaded, { type: "setCineMs", ms: 50000 }).cineMs, 2000, "a frame interval too slow to follow is clamped");
}

/* --- window / level -------------------------------------------------------- */
{
  const wl = viewerReducer(loaded, { type: "setWindowLevel", window: 80, level: 40 });
  eq(wl.windowLevel.window, 80, "a window width can be set");
  eq(wl.windowLevel.level, 40, "a window centre can be set");
  const auto = viewerReducer(wl, { type: "setWindowLevel", window: null, level: null });
  eq(auto.windowLevel.window, null, "null means automatic window — the default that makes MR readable");
  eq(initialViewerState().windowLevel.level, null, "the viewer starts on the automatic window");
}

/* --- identity on screen ---------------------------------------------------- */
eq(identityName("Ala Fahmi Bazl", false), "Ala Fahmi Bazl", "the name is shown while identity is not hidden");
ck(/^ANON-[0-9A-F]{8}$/.test(identityName("Ala Fahmi Bazl", true)), "hidden, the name becomes a stable anonymous code");
eq(identityName("Ala Fahmi Bazl", true), identityName("Ala Fahmi Bazl", true), "the same patient always masks to the same code");
ck(identityName("Ala Fahmi Bazl", true) !== identityName("Thafran Jamil", true), "two different patients never share a code");
eq(identityName("", true), "", "an empty name stays empty");
{
  const hid = viewerReducer(loaded, { type: "toggleIdentity" });
  eq(hid.identityHidden, true, "identity can be hidden");
  eq(viewerReducer(hid, { type: "toggleIdentity" }).identityHidden, false, "and shown again");
  eq(viewerReducer(hid, { type: "toggleIdentity", on: false }).identityHidden, false, "or set explicitly");
}

/* --- loading and errors ---------------------------------------------------- */
eq(viewerReducer(loaded, { type: "setError", error: "boom" }).error, "boom", "an error is recorded");
eq(viewerReducer(viewerReducer(loaded, { type: "setError", error: "boom" }), { type: "setError", error: null }).error, null,
   "and cleared");
eq(viewerReducer(loaded, { type: "setLoading", loading: true }).loading, true, "loading is part of the state, not a stray flag");
eq(viewerReducer(loaded, { type: "studyLoaded", studyId: "U2", series: [] }).error, null, "opening a study clears the last error");

/* --- the app really routes its state through this module ------------------- */
ck(app.includes('["viewer-state", "./viewer-state.v'), "the app loads the state module with the rest");
ck(app.includes("function vst(a) {"), "one funnel: every change goes through the reducer");
ck((app.match(/vst\(\{ type: "/g) || []).length >= 10, "the handlers dispatch actions, they do not poke the state");
ck(app.includes('vst({ type: "setSlice", index: idx, total: frames.length, keepCine: !!cineT })'),
   "every painted frame tells the state which slice it drew");
ck(app.includes('vst({ type: "setLayout", layout: mprOn ? "mpr" : "single" })') &&
   app.includes('vst({ type: "setLayout", layout: allOn ? "all" : "single" })'),
   "the two hangings report themselves to the state");
ck(app.includes('vst({ type: "setZoom", zoom: (k0 * d) / pinch0 })') && app.includes('vst({ type: "zoomBy", factor: 1.25 })'),
   "pinch and keyboard zoom go through the same clamp");
ck(app.includes("function shownName(nm)") && app.includes("const pnShow = shownName("), "the header name is masked by the state");
ck(app.includes('ovPref("rrai-ov-name", false) ? shownName('), "the corner label on the image is masked too");
ck(app.includes("function cineTick()") && app.includes("function cineStop()") && app.includes("function cineStart()"),
   "the cine loop is driven by the state, not by a stray timer");
ck(app.includes('document.addEventListener("visibilitychange"'), "the loop stops when the tab is hidden");
ck(ui.includes('id="id-toggle"') && ui.includes('id="cine-toggle"'), "ui: hide-identity and cine buttons");
ck(app.includes('"id-toggle": [') && app.includes('"cine-toggle": ['), "both buttons are labelled in Arabic and English");

/* --- v129: how the picture is turned --------------------------------------
   Invert, rotate, flip H, flip V, and back to the way it was acquired. The turn
   is DISPLAY ONLY — it never touches the pixels, the pixel value or a
   measurement — but a tap on a turned picture is a point in the turned picture,
   so the mapping between the two has to be exact, and it lives here where it can
   be tested without a browser. If it were wrong, a line drawn on a rotated film
   would measure a different piece of the patient than the one under the finger. */
{
  const flat = { rotate: 0, flipH: false, flipV: false };
  eq(orientSize(512, 256, flat).join("x"), "512x256", "an upright picture is its own size on screen");
  eq(orientSize(512, 256, { rotate: 90 }).join("x"), "256x512", "a quarter turn swaps the sides of the box");
  eq(orientSize(512, 256, { rotate: 180 }).join("x"), "512x256", "a half turn does not");
  eq(orientSize(512, 256, { rotate: 270 }).join("x"), "256x512", "three quarter turns swap them back");
  eq(orientSize(512, 256, { rotate: 450 }).join("x"), "256x512", "450° is the quarter turn it really is");
  eq(orientSize(512, 256, { rotate: -90 }).join("x"), "256x512", "and a turn the other way is the same shape");

  /* the top-left corner of a film stood on its end: the left edge becomes the
     top of the picture, the top edge becomes the right. */
  const tl = orientPoint(0, 0, 512, 256, { rotate: 90 });
  eq(tl[0], 256, "a quarter turn stands the film on its end: the left edge runs along the top");
  eq(tl[1], 0, "and what was the top edge is now down the right-hand side");
  eq(orientPoint(0, 0, 512, 256, { rotate: 90, flipH: true })[0], 0,
     "a flip is a mirror of what is ON SCREEN, not of the film under it");

  /* every turn × every flip × every corner: the mapping must be exact */
  let worst = 0, out = 0;
  for (const rot of [0, 90, 180, 270]) {
    for (const fh of [false, true]) {
      for (const fv of [false, true]) {
        const o = { rotate: rot, flipH: fh, flipV: fv };
        const [dw, dh] = orientSize(512, 256, o);
        for (const [x, y] of [[0, 0], [511, 0], [0, 255], [511, 255], [137, 88], [256, 128]]) {
          const p = orientPoint(x, y, 512, 256, o);
          if (!(p[0] >= -1e-9 && p[0] <= dw + 1e-9 && p[1] >= -1e-9 && p[1] <= dh + 1e-9)) out++;
          const b = unorientPoint(p[0], p[1], 512, 256, o);
          worst = Math.max(worst, Math.abs(b[0] - x), Math.abs(b[1] - y));
        }
      }
    }
  }
  eq(out, 0, "no point of a picture is ever mapped outside the picture, however it is turned");
  ck(worst < 1e-9, "the mapping is exact: a tap returns the pixel it came from, however the film is held");
  {
    const o = { rotate: 270, flipH: true, flipV: true };
    const p = orientPoint(511, 255, 512, 256, o);
    const b = unorientPoint(p[0], p[1], 512, 256, o);
    ck(Math.abs(b[0] - 511) < 1e-9 && Math.abs(b[1] - 255) < 1e-9,
       "the far corner of a wide film comes back to itself through a turn and both flips");
  }
}

/* --- the turn is one field in the state, changed in one place -------------- */
{
  const s0 = initialViewerState();
  eq(s0.invert, false, "a viewer opens the way the film was acquired: not inverted");
  eq(s0.rotate, 0, "…upright");
  eq(s0.flipH, false, "…and not mirrored");
  const inv = viewerReducer(s0, { type: "toggleInvert" });
  eq(inv.invert, true, "invert switches on");
  eq(viewerReducer(inv, { type: "toggleInvert" }).invert, false, "and off again");
  eq(viewerReducer(s0, { type: "rotate90" }).rotate, 90, "one press is one quarter turn");
  eq(viewerReducer(viewerReducer(s0, { type: "rotate90" }), { type: "rotate90" }).rotate, 180, "two presses is a half turn");
  eq(viewerReducer(viewerReducer(viewerReducer(viewerReducer(s0, { type: "rotate90" }), { type: "rotate90" }), { type: "rotate90" }), { type: "rotate90" }).rotate,
     0, "four quarter turns is the picture you started from");
  eq(viewerReducer(s0, { type: "rotate90", step: -1 }).rotate, 270, "the other way round is a turn too");
  eq(viewerReducer(viewerReducer(s0, { type: "rotate90", step: -1 }), { type: "rotate90", step: -1 }).rotate, 180, "and it carries on round");
  eq(viewerReducer(s0, { type: "rotate90", step: 7 }).rotate, 90, "an unknown step is one turn forward, never a jump");
  {
    const fh = viewerReducer(s0, { type: "toggleFlip", axis: "h" });
    ck(fh.flipH === true && fh.flipV === false, "the horizontal flip is the horizontal one");
    const fv = viewerReducer(s0, { type: "toggleFlip", axis: "v" });
    ck(fv.flipV === true && fv.flipH === false, "and the vertical one is vertical");
    ck(viewerReducer(s0, { type: "toggleFlip", axis: "diagonal" }) === s0,
       "an axis a picture does not have is ignored, not guessed");
    ck(viewerReducer(s0, { type: "toggleFlip" }) === s0, "so is no axis at all");
    ck(viewerReducer(fh, { type: "toggleFlip", axis: "h" }).flipH === false, "a flip switches back");
  }
  {
    let all = viewerReducer(s0, { type: "toggleInvert" });
    all = viewerReducer(all, { type: "rotate90" });
    all = viewerReducer(all, { type: "toggleFlip", axis: "h" });
    all = viewerReducer(all, { type: "toggleFlip", axis: "v" });
    const back = viewerReducer(all, { type: "resetOrientation" });
    ck(back.invert === false && back.rotate === 0 && back.flipH === false && back.flipV === false,
       "one button puts the film back the way it was acquired");
    ck(back.zoom === all.zoom && back.sliceIndex === all.sliceIndex && back.seriesId === all.seriesId,
       "putting the picture straight does not throw away the slice or the zoom");
    ck(viewerReducer(s0, { type: "resetOrientation" }) === s0,
       "pressed on an upright picture it changes nothing at all");
    const before = JSON.stringify(all);
    viewerReducer(all, { type: "resetOrientation" });
    eq(JSON.stringify(all), before, "the reducer is pure: turning the picture never alters the state you passed in");
  }
  /* the turn belongs to the PICTURE, and a new study is a new picture */
  const turned = viewerReducer(viewerReducer(loaded, { type: "rotate90" }), { type: "toggleInvert" });
  eq(turned.rotate, 90, "a turned picture stays turned while you scroll it");
  eq(viewerReducer(turned, { type: "setSlice", index: 4 }).rotate, 90, "scrolling does not straighten it");
  eq(viewerReducer(turned, { type: "selectSeries", seriesId: "0" }).rotate, 90, "and neither does changing series");
  const reopened = viewerReducer(turned, { type: "studyLoaded", studyId: "U2", series: study });
  eq(reopened.rotate, 0, "a new study opens upright: the previous turn belonged to another patient's film");
  eq(reopened.invert, false, "and not inverted with the last one's settings");
}

/* --- the app turns the picture through the reducer, not through a style ---- */
ck(ui.includes('id="orient-bar"') && ui.includes('id="orient-invert"') && ui.includes('id="orient-rotate"') &&
   ui.includes('id="orient-fliph"') && ui.includes('id="orient-flipv"') && ui.includes('id="orient-reset"'),
   "ui: invert, rotate, flip H, flip V, and back to the original");
ck(app.includes('vst({ type: "toggleInvert" })') && app.includes('vst({ type: "rotate90" })') &&
   app.includes('vst({ type: "toggleFlip", axis: "h" })') && app.includes('vst({ type: "toggleFlip", axis: "v" })') &&
   app.includes('vst({ type: "resetOrientation" })'),
   "every turn goes through the reducer, like the slice and the zoom before it");
ck(app.includes("function orientNow()") && app.includes("const o = orientNow();"),
   "there is ONE place that says how the picture is turned, and the handlers read it");
ck(app.includes("unPoint(u, v, f0.w, f0.h, o)") && app.includes("oPoint(ix, iy, f0.w, f0.h, o)"),
   "a tap is mapped back through the turn, and a zoom back forward through it");
ck(app.includes('cv.style.filter = o.invert ? "invert(1)" : "none"'),
   "invert is a filter on the picture, never on the numbers");
ck(app.includes('"orient-invert": ["قلب اللون", "Invert"]') && app.includes('"orient-reset": ["الوضع الأصلي", "Reset view"]'),
   "the new buttons are named in Arabic and English");

console.log(fails ? "STATE TEST FAIL " + fails : "STATE TEST PASS");
process.exit(fails ? 1 : 0);
