/* Series awareness: an MR study is several sequences, never one mixed stack. */
import { readFileSync } from "node:fs";
import { groupSeries, seriesSummary, allSeriesRows, orientationFromIop, seriesRows, seriesRowText } from "../app.v144.js";

let fails = 0;
const eq = (a, b, m) => { if (a !== b) { fails++; console.log(`FAIL ${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };

const fr = (i, o) => Object.assign({ w: 256, h: 256, data: new Int16Array(4) }, o);

/* --- grouping ----------------------------------------------------------- */
const frames = [
  fr(0, { seriesUid: "S1", seq: { seriesNumber: 2, seriesDescription: "T2 TSE TRA" } }),
  fr(1, { seriesUid: "S1", seq: { seriesNumber: 2, seriesDescription: "T2 TSE TRA" } }),
  fr(2, { seriesUid: "S2", seq: { seriesNumber: 1, seriesDescription: "T1 SE" } }),
  fr(3, { seriesUid: "S3", seq: { seriesNumber: 3, seriesDescription: "FLAIR" } }),
];
const gs = groupSeries(frames, "MR");
eq(gs.length, 3, "three series recognised");
eq(gs[0].number, 1, "series ordered by series number");
eq(gs[0].indices.join(","), "2", "frame indices stay attached to their series");
eq(gs[1].indices.length, 2, "the T2 series holds both of its slices");
eq(gs[0].label, "T1", "first series labelled from its own description");
eq(gs[2].label, "FLAIR", "third series labelled from its own description");

/* identical frames with no UIDs at all fall back to number + description + matrix */
const plain = [
  fr(0, { seq: { seriesNumber: 1 } }),
  fr(1, { seq: { seriesNumber: 1 } }),
  fr(2, { seq: { seriesNumber: 2, te: 100, tr: 4000 } }),
];
const gp = groupSeries(plain, "MR");
eq(gp.length, 2, "frames without a SeriesInstanceUID still group by number/timings");
eq(gp[1].label, "T2", "the second group is labelled from TR/TE");
eq(gp[1].derived, true, "a timing-derived label is flagged");
eq(groupSeries([], "MR").length, 0, "empty study → no series");
eq(groupSeries([fr(0, {})], "MR").length, 1, "single frame → one series");

/* --- summary ------------------------------------------------------------ */
eq(seriesSummary({ series: gs, frames }), "T1 • T2 • FLAIR", "worklist summary lists the sequences");
eq(seriesSummary({ series: [gs[0]], frames }), "", "no summary for a single-series study");
const many = { series: [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, label: "Se" + n, indices: [n] })) };
eq(seriesSummary(many).endsWith("+2"), true, "long summaries are truncated with a count");

/* --- wiring ------------------------------------------------------------- */
const app = readFileSync(new URL("../app.v144.js", import.meta.url), "utf-8");
const ui = readFileSync(new URL("../ui.v144.html", import.meta.url), "utf-8");
const dcm = readFileSync(new URL("../dicom.v144.js", import.meta.url), "utf-8");
ck(dcm.includes('"0020,000E"'), "parser captures SeriesInstanceUID");
ck(app.includes("px.seriesUid = parsed.seriesUid"), "series identity kept on every frame");
ck(app.includes("study.series = groupSeries(study.frames, study.modality)"), "series computed at ingest");
ck(ui.includes('id="series-bar"'), "viewer has a series picker");
ck(app.includes("function renderSeriesBar") && app.includes("function selectSeries"), "series picker is rendered and selectable");
ck(/function activeFrames\(\)[\s\S]{0,420}indices\.map/.test(app), "the view is scoped to the selected series");
ck(app.includes("mprApi.volumeFromFrames(frames"), "MPR builds its volume inside one series only");
ck(/const key = \[current\.uid \|\| "", currentSeries/.test(app), "the volume cache is per series");
ck(app.includes("mprOn = false;") && app.includes('this series cannot be resliced') && app.includes('display = "block"'), "a series that cannot be resliced falls back to the single view with a reason");
ck(app.includes("seriesSummary(s)"), "worklist shows the sequence breakdown");

/* --- the comprehensive hanging: one row per series (v123) ------------------
   A study is read sequence by sequence — T1, T2, FLAIR — and each sequence in
   the three planes. The hanging is planned from the series, so the plan is
   testable without a DOM: how many rows, and what each row can show. */
const fr2 = (w, h, n, seriesUid, num, desc) => Array.from({ length: n }, () => ({
  w, h, data: new Int16Array(Array.from({ length: w * h }, (_, i) => i % 997)),
  seq: { seriesUid, seriesNumber: num, seriesDescription: desc },
}));
const mixedStudy = {
  uid: "1.2.3.4", modality: "MR",
  frames: [
    ...fr2(32, 32, 4, "1.1", 1, "T1"),      /* a resliceable acquisition */
    ...fr2(32, 32, 1, "1.2", 2, "T2"),      /* one image: nothing to reslice */
    ...fr2(32, 32, 2, "1.3", 3, "FLAIR").concat(fr2(16, 16, 1, "1.3", 3, "FLAIR")), /* sizes differ */
  ],
};
{
  const rows = allSeriesRows(mixedStudy);
  ck(rows.length === 3, "one row per series (was: the whole study as one stack)");
  ck(rows[0].count === 4 && rows[1].count === 1 && rows[2].count === 3, "each row knows how many images it holds");
  ck(rows.every((r) => typeof r.label === "string" && r.label.length > 0), "every row is labelled (T1, T2, FLAIR…)");
  ck(rows.every((r) => r.reslice === false && r.reason === "no-mpr"), "without the MPR module no row claims three planes");
}
{
  const api = { volumeFromFrames: () => ({ ok: true }) };
  const rows = allSeriesRows(mixedStudy, api);
  ck(rows[0].reslice === true && rows[0].reason === "", "a multi-slice series is resliced into the three planes");
  ck(rows[1].reslice === false && rows[1].reason === "one-frame", "a one-image series says so instead of showing two blank panes");
  ck(rows[2].reslice === false && rows[2].reason === "mixed-size", "a series whose slices differ in size is not resliced");
}
ck(app.includes("function allSeriesRows(study, api)"), "the hanging is planned by a pure function");
ck(app.includes("function renderAll()") && app.includes("function allToggle(on)"), "the comprehensive view renders and toggles");
ck(app.includes("if (mprOn && allOn)") && app.includes("if (allOn && mprOn)"), "the two hangings are mutually exclusive");
ck(app.includes("allRowVolume(r)"), "each series keeps its own volume, budget shared between rows");
ck(app.includes("cv.onclick = () => {"), "tapping a pane opens that series");
ck(ui.includes('id="all-toggle"') && ui.includes('id="all-grid"'), "ui: comprehensive button + grid");
ck(ui.includes('id="all-note"'), "ui: a note tells the physician what the hanging shows");

/* --- v125 series navigator: which series is which, before you open it ----- */
eq(orientationFromIop([1, 0, 0, 0, 1, 0]), "axial", "axial: the slice normal points through the body");
eq(orientationFromIop([1, 0, 0, 0, 0, -1]), "coronal", "coronal");
eq(orientationFromIop([0, 1, 0, 0, 0, -1]), "sagittal", "sagittal");
eq(orientationFromIop([1, 0, 0]), "", "a truncated orientation is unknown, not guessed");
eq(orientationFromIop(null), "", "no orientation at all is unknown, not guessed");

const navFrames = [
  fr(0, { seriesUid: "N1", seq: { seriesNumber: 1, seriesDescription: "T1 Sagittal" }, geometry: { iop: [0, 1, 0, 0, 0, -1], sliceThickness: 3 }, spacing: [0.9, 0.9] }),
  fr(1, { seriesUid: "N1", seq: { seriesNumber: 1, seriesDescription: "T1 Sagittal" }, geometry: { iop: [0, 1, 0, 0, 0, -1], sliceThickness: 3 }, spacing: [0.9, 0.9] }),
  fr(2, { seriesUid: "N2", seq: { seriesNumber: 2, seriesDescription: "T2 Axial" }, geometry: { iop: [1, 0, 0, 0, 1, 0], sliceThickness: 5 }, spacing: [0.7, 0.7] }),
  fr(3, { seriesUid: "N3", seq: { seriesNumber: 3, seriesDescription: "STIR Coronal" }, geometry: { iop: [1, 0, 0, 0, 0, -1], sliceThickness: 4 } }),
];
const navStudy = { uid: "NAV1", modality: "MR", frames: navFrames, series: groupSeries(navFrames, "MR") };
const nav = seriesRows(navStudy);
eq(nav.length, 3, "one row per series");
eq(nav[0].orient, "sagittal", "the plane comes from ImageOrientationPatient, not from the name");
eq(nav[1].orient, "axial", "the second series is axial");
eq(nav[2].orient, "coronal", "the third series is coronal");
eq(nav[0].mm, 3, "the slice thickness is read from the file");
eq(nav[1].mm, 5, "a different thickness on a different series");
ck(nav[0].count === 2 && nav[1].count === 1 && nav[2].count === 1, "each row counts its own images");
ck(nav[0].w === 256 && nav[0].h === 256, "each row knows its matrix");
{
  const t = seriesRowText(nav[0], true);
  ck(t.indexOf("Sagittal") >= 0, "the row names the plane: " + t);
  ck(t.indexOf("256") >= 0, "the row shows the matrix: " + t);
  ck(t.indexOf("3 mm") >= 0, "the row shows the slice thickness: " + t);
  ck(/· 2$/.test(t), "the row ends with the image count: " + t);
  ck(t.indexOf("T1 (2)") < 0, "a series is never reduced to a label and a count");
  const chip = seriesRowText(nav[0], true, true);
  ck(chip.indexOf("Sagittal") >= 0 && /\u00b7 2$/.test(chip), "the chip keeps the plane and the count: " + chip);
  ck(chip.indexOf("256") < 0, "the chip stays short: the matrix lives in the sheet, not in the chip");
  ck(seriesRowText(nav[0], false).indexOf("\u0633\u0647\u0645\u064a") >= 0, "the plane is named in Arabic too");
  ck(seriesRowText(nav[2], true).indexOf("Coronal") >= 0, "every plane is named, not only the first");
}
ck(app.includes("export function seriesRows(study)"), "the rows are built by a pure function");
ck(app.includes("function renderSeriesSheet()") && app.includes("function seriesSheetOpen(on)"), "the sheet renders and opens");
ck(app.includes('row.setAttribute("aria-current", "true")'), "the current series is marked for screen readers");
ck(app.includes('\\u2713'), "the current series carries a tick — never colour alone");
ck(app.includes("function seriesThumb(study, i)") && app.includes("seriesThumbs.set(key, url)"), "each series keeps a thumbnail, built once");
ck(app.includes('document.addEventListener("keydown", (e) => { if (e.key === "Escape")'), "Escape closes the sheet");
ck(ui.includes('id="series-sheet"') && ui.includes('id="series-open"') && ui.includes('id="series-list"'),
   "ui: the sheet, the button that opens it and the list inside it");
ck(ui.includes("#series-sheet") && ui.includes("max-height:66vh"), "ui: the sheet is a bottom sheet, not a full screen");

console.log(fails ? "SERIES TEST FAIL " + fails : "SERIES TEST PASS");
process.exit(fails ? 1 : 0);
