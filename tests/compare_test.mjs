import fs from "node:fs";
import { frameStats, normalize01, diffStats, frameGrayFlat } from "../compare.v132.js";
import { cmpCandidates, cmpRatio, cmpIndex, cmpPartner, cmpNameKey, cmpSamePatient, cmpOthers, cmpCrossPatient } from "../app.v132.js";
let fails = 0;
let checks = 0;
const ok = (n, c) => { checks++; if (c) console.log("PASS " + n); else { fails++; console.log("FAIL " + n); } };
const a = new Float32Array([0, 50, 100, 150]);
const st = frameStats(a);
ok("stats", st.min === 0 && st.max === 150 && Math.abs(st.mean - 75) < 1e-9);
const n1 = normalize01(a, 0, 150);
ok("normalize", Math.abs(n1[2] - 100 / 150) < 1e-6 && n1[0] === 0 && n1[3] === 1);
const d0 = diffStats(n1, n1, 0.25);
ok("identical-zero", d0.meanAbs === 0 && d0.pctHot === 0);
const b = new Float32Array([1, 0, 0, 0]);
const d1 = diffStats(n1, b, 0.25);
ok("diff-positive", d1.meanAbs > 0 && d1.pctHot > 0 && d1.pctHot <= 100);
ok("mask", d1.mask[0] === 1 || d1.mask[3] === 1);
const f = { kind: "gray", w: 2, h: 2, data: new Float32Array([1, 2, 3, 4]) };
const g = frameGrayFlat(f);
ok("flat", g[3] === 4);
const fr = { kind: "rgb", w: 1, h: 1, data: new Uint8Array([10, 20, 30]) };
ok("rgb-flat", Math.abs(frameGrayFlat(fr)[0] - (0.299 * 10 + 0.587 * 20 + 0.114 * 30)) < 1e-6);
/* --- v128: side by side ------------------------------------------------- */
const mk = (uid, name, date, frames) => ({ uid, patient: name, meta: { studyDate: date }, frames: frames || [] });
const me = mk("S9", "Ala Fahmi Bazl", "20260901");
const older = mk("S1", "Ala Fahmi Bazl", "20250901");
const oldest = mk("S4", "AL A  FAHMI BAZL ", "20240101");   /* spacing + case */
const caret = mk("S6", "Ala^Fahmi^Bazl", "20230301");          /* DICOM caret form */
const glued = mk("S7", "AlaFahmiBazl", "20220201");            /* no separators at all */
const newest = mk("S2", "ala fahmi bazl", "20260601");       /* case only */
const stranger = mk("S3", "Thafran Jamil", "20260501");

const cand = cmpCandidates([older, newest, stranger, oldest, caret, glued, me], me);
ok("same patient, newest first", cand.length === 5 && cand[0].uid === "S2" && cand[1].uid === "S1" && cand[2].uid === "S4" && cand[3].uid === "S6" && cand[4].uid === "S7");
ok("one patient however the name is spelled (^ / spaces / none)", cand.filter((s) => s.uid === "S6" || s.uid === "S7").length === 2);
ok("another patient is never offered as the same patient", cand.every((s) => s.uid !== "S3"));
ok("the study on screen is not its own partner", cand.every((s) => s.uid !== "S9"));
ok("a study with no patient name offers nothing", cmpCandidates([mk("S5", "", "20260101")], mk("S9", "", "20260101")).length === 0);
ok("no other study -> empty list", cmpCandidates([me], me).length === 0);

/* the link is by DEPTH, because two studies of the same region rarely hold the
   same number of images */
ok("first slice is depth 0", cmpRatio(0, 19) === 0);
ok("last slice is depth 1", cmpRatio(18, 19) === 1);
ok("middle slice is depth 0.5", Math.abs(cmpRatio(9, 19) - 0.5) < 1e-12);
ok("a one-image stack has no depth", cmpRatio(5, 1) === 0);
ok("an out-of-range slice is clamped, not wrapped", cmpRatio(100, 19) === 1);
ok("depth 0 of any stack is its first slice", cmpIndex(0, 19) === 0 && cmpIndex(0, 7) === 0);
ok("depth 1 of any stack is its last slice", cmpIndex(1, 19) === 18 && cmpIndex(1, 4) === 3);
ok("depth 0.5 of 19 is slice 9", cmpIndex(0.5, 19) === 9);
ok("depth is clamped, never past the stack", cmpIndex(2, 5) === 4);
ok("a one-image stack stays at 0", cmpIndex(0.5, 1) === 0);
ok("the same depth in a shorter stack", cmpPartner(18, 19, 4) === 3);
ok("the same depth in a longer stack", cmpPartner(9, 19, 10) === 5);
ok("matching equal stacks is the identical slice", cmpPartner(7, 19, 19) === 7);
{
  let inside = true;
  for (let i = 0; i < 19; i++) { const j = cmpPartner(i, 19, 5); if (j < 0 || j > 4) inside = false; }
  ok("every slice of the long stack maps inside the short one", inside);
}

/* the device this was built for held one study per patient: the picker must
   not dead-end there */
ok("the name is read without its separators", cmpNameKey(mk("S1", "Ala^Fahmi^Bazl", "")) === cmpNameKey(mk("S2", "AlaFahmiBazl", "")));
ok("two spellings, one patient", cmpSamePatient(mk("S1", "Ala^Fahmi^Bazl", ""), mk("S2", "Ala Fahmi Bazl", "")) === true);
ok("two different people are not one patient", cmpSamePatient(mk("S1", "Ala Fahmi Bazl", ""), mk("S3", "Thafran Jamil", "")) === false);
ok("an unnamed study matches nobody", cmpSamePatient(mk("S1", "", ""), mk("S2", "", "")) === false);
{
  const others = cmpOthers([older, newest, stranger, oldest, caret, glued, me], me);
  ok("every other study is offered, same patient or not", others.length === 6);
  ok("the study on screen is never offered as its own partner", others.every((s) => s.uid !== "S9"));
  ok("newest first", others[0].uid === "S2");
  ok("cross-patient is flagged", cmpCrossPatient(me, stranger) === true);
  ok("same patient is not flagged", cmpCrossPatient(me, newest) === false);
  ok("no partner at all is not flagged", cmpCrossPatient(me, null) === false);
}

const appSrc = fs.readFileSync(new URL("../app.v132.js", import.meta.url), "utf8");
const uiSrc = fs.readFileSync(new URL("../ui.v132.html", import.meta.url), "utf8");
ok("the picker is filled from the same-patient list", appSrc.includes("cmpCandidates(await allStudies(), current)") || appSrc.includes("cmpCandidates(all, current)"));
ok("the panes are linked by depth, never by index", appSrc.includes("cmpPartner(i, n, cmpCount(other))"));
ok("slice, zoom and window can each be unlinked", appSrc.includes('for (const kind of ["slice", "zoom", "win"])') && appSrc.includes("cmpSyncSet(kind, box.checked)"));
ok("the choice is remembered on the device", appSrc.includes('localStorage.setItem("rrai-cmp-sync-" + kind'));
ok("each pane keeps its own slice slider", uiSrc.includes('id="cmp-slice-a"') && uiSrc.includes('id="cmp-slice-b"'));
ok("the second pane keeps its own window", uiSrc.includes('id="cmp-win-b"') && appSrc.includes("cmpPresetFor(which)"));
ok("the sheet is a dialog a screen reader can name", uiSrc.includes('id="cmp-sheet"') && uiSrc.includes('aria-labelledby="cmp-title"'));
ok("the study can be opened from the pane that shows it", appSrc.includes("cmpSheetOpen(false); try { await openStudy(cmpB)"));
ok("the picker offers the other studies when this patient has none", appSrc.includes("cmpOthers(all, current).filter((s) => !same.has(s.uid))"));
ok("a partner from another patient is named on the pane", appSrc.includes("cmpLabel(cmpB, cross)"));
ok("and warned about, in words — not by colour alone", appSrc.includes("\u26a0"));

console.log(fails ? "COMPARE TEST FAIL " + fails : "COMPARE TEST PASS (" + checks + ")");
process.exit(fails ? 1 : 0);
