/* Series awareness: an MR study is several sequences, never one mixed stack. */
import { readFileSync } from "node:fs";
import { groupSeries, seriesSummary, allSeriesRows } from "../app.v124.js";

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
const app = readFileSync(new URL("../app.v124.js", import.meta.url), "utf-8");
const ui = readFileSync(new URL("../ui.v124.html", import.meta.url), "utf-8");
const dcm = readFileSync(new URL("../dicom.v124.js", import.meta.url), "utf-8");
ck(dcm.includes('"0020,000E"'), "parser captures SeriesInstanceUID");
ck(app.includes("px.seriesUid = parsed.seriesUid"), "series identity kept on every frame");
ck(app.includes("study.series = groupSeries(study.frames, study.modality)"), "series computed at ingest");
ck(ui.includes('id="series-bar"'), "viewer has a series picker");
ck(app.includes("function renderSeriesBar") && app.includes("function selectSeries"), "series picker is rendered and selectable");
ck(/function activeFrames\(\)[\s\S]{0,420}indices\.map/.test(app), "the view is scoped to the selected series");
ck(app.includes("mprApi.volumeFromFrames(frames"), "MPR builds its volume inside one series only");
ck(/const key = \[current\.uid \|\| "", currentSeries/.test(app), "the volume cache is per series");
ck(app.includes("mprOn = false;") && app.includes('this series cannot be resliced') && app.includes('display = "block"'), "a series that cannot be resliced falls back to the single view with a reason");
ck(app.includes("seriesSummary(ensureSeries(s))"), "worklist shows the sequence breakdown");

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
console.log(fails ? "SERIES TEST FAIL " + fails : "SERIES TEST PASS");
process.exit(fails ? 1 : 0);
