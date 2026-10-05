/* Sequence naming + on-image annotation layer. */
import { readFileSync } from "node:fs";
import { seqLabelOf, studyTypeLabel } from "../app.v107.js";

let fails = 0;
const eq = (a, b, m) => { if (a !== b) { fails++; console.log(`FAIL ${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };

/* --- what the file states ---------------------------------------------- */
eq(seqLabelOf({ seriesDescription: "T2 TSE TRA" }, "MR").label, "T2", "series description yields T2");
eq(seqLabelOf({ seriesDescription: "t1 fl2d tra" }, "MR").label, "T1", "series description yields T1");
eq(seqLabelOf({ seriesDescription: "AX FLAIR" }, "MR").label, "FLAIR", "FLAIR recognised");
eq(seqLabelOf({ seriesDescription: "ep2d_diff" }, "MR").label, "DWI", "diffusion series recognised");
eq(seqLabelOf({ seriesDescription: "T1 VIBE FS POST GAD" }, "MR").label, "T1+C", "post-contrast T1 flagged");
eq(seqLabelOf({ seriesDescription: "T2 TSE", contrast: "Gadobutrol" }, "MR").label, "T2+C", "contrast agent appended");
eq(seqLabelOf({ seriesDescription: "T2 TSE", contrast: "no" }, "MR").label, "T2", "'no contrast' is not appended");
eq(seqLabelOf({ seriesDescription: "sag t2" }, "MR").derived, false, "tag-derived labels are not marked as inferred");
eq(seqLabelOf({ seriesDescription: "T2 TSE", te: 96, tr: 4500 }).detail, "TE 96 / TR 4500", "TE/TR exposed for the overlay");

/* --- inference, always flagged ----------------------------------------- */
eq(seqLabelOf({ seriesDescription: "", tr: 4200, te: 100 }, "MR").label, "T2", "long TR/TE infers T2");
eq(seqLabelOf({ seriesDescription: "", tr: 4200, te: 100 }, "MR").derived, true, "inferred T2 is flagged");
eq(seqLabelOf({ seriesDescription: "", tr: 550, te: 12 }, "MR").label, "T1", "short TR/TE infers T1");
eq(seqLabelOf({ bValue: 800 }, "MR").label, "DWI", "b-value infers DWI");
eq(seqLabelOf({ scanningSequence: "IR", ti: 2200 }, "MR").label, "FLAIR", "IR + long TI infers FLAIR");
eq(seqLabelOf({ tr: 4200, te: 100 }, "CT").label, "", "no guessing outside MR");
eq(seqLabelOf({}, "MR").label, "", "nothing to go on → no label, never invented");
eq(seqLabelOf(null, "MR").label, "", "missing block is safe");

/* --- study-level label -------------------------------------------------- */
eq(studyTypeLabel({ description: "MRI Brain", frames: [{ seq: { seriesDescription: "T1" } }] }), "MRI Brain", "study description wins");
eq(studyTypeLabel({ frames: [{ seq: { seriesDescription: "T2 TSE TRA" } }], modality: "MR" }), "T2 TSE TRA", "series description used next");
eq(studyTypeLabel({ frames: [{ seq: { protocolName: "Routine Brain" } }], modality: "MR" }), "Routine Brain", "protocol name used next");
eq(studyTypeLabel({ frames: [{ seq: { tr: 4200, te: 100 } }], modality: "MR" }), "~T2", "inferred study type carries the ~ mark");
eq(studyTypeLabel({ bodyPart: "BRAIN", frames: [{}], modality: "MR" }), "BRAIN", "body part is the last resort");
eq(studyTypeLabel(null), "", "no study → empty");

/* --- wiring ------------------------------------------------------------- */
const app = readFileSync(new URL("../app.v107.js", import.meta.url), "utf-8");
const ui = readFileSync(new URL("../ui.v107.html", import.meta.url), "utf-8");
const dcm = readFileSync(new URL("../dicom.v107.js", import.meta.url), "utf-8");
for (const tag of ["0008,103E", "0018,0024", "0018,1030", "0018,0081", "0018,0080", "0018,9087", "0018,0010", "0020,0011", "0020,1041"]) {
  ck(dcm.includes('"' + tag + '"'), "parser captures DICOM tag " + tag);
}
ck(dcm.includes("seq,"), "sequence block returned by the parser");
ck(app.includes("px.seq = parsed.seq"), "sequence block kept on every ingested frame");
ck(ui.includes('id="annot"'), "viewer has a dedicated annotation canvas");
ck(app.includes("function drawAnnot") && app.includes("drawAnnot();"), "annotation layer is drawn with every slice");
ck(app.includes('ovPref("rrai-ov-seq"') && app.includes('ovPref("rrai-ov-tech"'), "annotation respects the info-layer preferences");
ck(ui.includes("ov-seq-chk") && ui.includes("ov-tech-chk"), "settings expose the two annotation toggles");
ck(app.includes('"lbl-ov-seq"') && app.includes('"lbl-ov-tech"'), "annotation toggles are translated (AR/EN)");
ck(app.includes("seqLabelOf(f && f.seq, current.modality)") && app.includes("mprCross("), "MPR panes annotate the sequence too");
ck(app.includes('lb.derived ? lb.label + " ~" : lb.label'), "inferred labels are visually marked with ~");
/* the draw error from the field: unguarded element.value reads */
const unguarded = (app.match(/\$\("(?:preset|slice)"\)\.value/g) || []).length;
ck(app.includes("const presetVal =") && app.includes("const sliceIdx ="), "safe helpers exist for preset/slice reads");
ck(unguarded <= 2, "preset/slice reads routed through guarded helpers (direct reads left: " + unguarded + ", all behind null checks)");
ck(/const sl0 = \$\("slice"\); if \(sl0\)/.test(app) || /const sl = \$\("slice"\); if \(sl\)/.test(app), "slice reset no longer assumes the control exists");
console.log(fails ? "SEQ TEST FAIL " + fails : "SEQ TEST PASS");
process.exit(fails ? 1 : 0);
