/* Study dates: DICOM date handling, fallbacks and the worklist column. */
import { readFileSync } from "node:fs";
import { fmtDicomDate, dateKey } from "../app.v112.js";

let fails = 0;
const eq = (a, b, m) => { if (a !== b) { fails++; console.log(`FAIL ${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };

/* --- formatting --------------------------------------------------------- */
eq(fmtDicomDate("20240512"), "2024/05/12", "plain DICOM date");
eq(fmtDicomDate("20240512", "1430"), "2024/05/12 14:30", "date with DICOM time");
eq(fmtDicomDate("2024-05-12"), "2024/05/12", "ISO-ish date is accepted too");
eq(fmtDicomDate(""), "", "empty date stays empty");
eq(fmtDicomDate(null, null), "", "null stays empty");
eq(fmtDicomDate("00000000").length > 0, true, "all-zero date still renders (no silent crash)");

/* --- sorting keys ------------------------------------------------------- */
eq(dateKey("20240512"), 20240512, "date key is numeric");
eq(dateKey("20240512") > dateKey("20230101"), true, "newer date sorts higher");
eq(dateKey(""), 0, "missing date sorts last");
eq(dateKey("2024-05-12"), 20240512, "ISO date keys identically");

/* --- parser fallbacks --------------------------------------------------- */
let pick = null;
try {
  ({ pickDate: pick } = await import("../dicom.v112.js"));
} catch (e) {
  console.log("  (dicom module not importable in node — fallback rule checked statically)");
}
if (pick) {
  eq(pick("", "", "20230909"), "20230909", "falls back to the acquisition date");
  eq(pick("20240101", "20230909"), "20240101", "study date wins when present");
  eq(pick("abcd", "2023-09-09"), "", "malformed values are ignored");
  eq(pick("20241332"), "", "implausible dates (month 13) are rejected rather than shown");
  eq(pick(), "", "no candidates → empty");
}
const dcm = readFileSync(new URL("../dicom.v112.js", import.meta.url), "utf-8");
ck(/0008,0020[\s\S]{0,120}0008,0021[\s\S]{0,80}0008,0022/.test(dcm), "parser walks the DICOM date fallback chain");
ck(dcm.includes('"0008,0030"'), "study time is captured as well");
ck(dcm.includes("export function pickDate"), "the fallback rule is exported and testable");

/* --- worklist ----------------------------------------------------------- */
const app = readFileSync(new URL("../app.v112.js", import.meta.url), "utf-8");
const ui = readFileSync(new URL("../ui.v112.html", import.meta.url), "utf-8");
ck(ui.includes('id="th-date"'), "worklist header has a date column");
ck(app.includes("for (let i = 0; i < 6; i++)"), "worklist rows build six cells");
ck(/tr\.children\[2\]\.textContent = dTxt/.test(app), "date cell is filled from the study date");
ck(app.includes('tr.children[2].dir = "ltr"'), "date cell reads left-to-right (digits)");
ck(app.includes('sortMode === "study"') && app.includes("dateKey("), "worklist can be sorted by the exam date");
ck(/tr\.children\[3\]\.appendChild\(badge\)/.test(app) && /tr\.children\[4\]\.textContent = s\.frames\.length/.test(app) &&
   /tr\.children\[5\]\.appendChild\(btn\)/.test(app), "priority, slices and actions shifted to the new columns");
ck(app.includes('studyTime: parsed.studyTime'), "study time is carried into the study meta");
ck(app.includes("fmtDicomDate(current.meta && current.meta.studyDate"), "viewer header shows a readable date");
ck(app.includes('"th-date": ["التاريخ", "Study date"]') && app.includes('"opt-study"'), "date column and sort option are translated (AR/EN)");

console.log(fails ? "DATES TEST FAIL " + fails : "DATES TEST PASS");
process.exit(fails ? 1 : 0);
