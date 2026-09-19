# Radiology report AI — Browser Edition: User Guide

A fully in-browser radiology reporting workbench: no server, no data leaves your device. After the first successful boot the app is cached on-device and works offline.

## 1) First open
1. Open `https://radiology-report-ai-web.vercel.app/x` (or any fresh route you are given: `/y`, `/z`, `/r1/start.html`).
2. Wait for the full UI (on weak networks a progress line counts seconds — let it continue).
3. After the first success a Service Worker is registered: from then on the normal `.../start.html` works even with no network.
4. Recommended: browser menu → **Add to Home screen** to run it like an app.

## 2) Getting studies in
- **Your DICOM files**: “اختيار الملفات / Choose files” → pick `.dcm` or `.zip` → “رفع وتحليل / Upload & analyze”. Studies are auto-triaged (urgent / consult / routine) into the worklist.
- **Quick trial without files**: “توليد ديمو / Generate demo” → two ready studies (DEMO-0001 urgent, DEMO-0002 routine).
- Badges: red = urgent (lung-field asymmetry), blue = consult, green = routine.

## 3) Viewer
- “عرض / View” next to any study opens the viewer.
- **Slice slider** steps through frames (synced across all compare panels).
- **قطع / Window** preset list (lung / mediastinum / bone…) changes contrast.
- **1:1** native zoom; drag to pan.
- **قياس / Measure**: distance in mm (pixel-spacing aware), angle, and ROI with mean HU; “مسح القياسات / Clear measurements” resets.

## 4) Compare with a prior study (v1.1 door 1)
1. Open the current study in the viewer.
2. Press “مقارنة / Compare” and pick the other study from the adjacent selector.
3. Three panels appear: **Current / Prior-Other / Diff map (red = hot)** plus the stats line: “mean difference … and hot spots …% (threshold 0.25 after normalization)”.
4. The result is stored with the study and flows automatically into the report draft.

## 5) Report, sign, export
1. “توليد مسودة التقرير (ع/EN) / Draft report (AR/EN)”: Arabic + English draft (impression, automated triage score, context, compare line) — **decision support, not a diagnosis**.
   The same click also auto-downloads an English Word file `rrai-report-EN-<patient>.docx` in the clinical template (MEDICAL RADIOLOGY REPORT layout: navy centered title, demographics block, blue TECHNIQUE/FINDINGS/IMPRESSION headings, shaded impression bullets, right-aligned Reported-by block, SHA-256 footer). A separate button “تصدير Word (قالب EN) / Word (EN template)” next to the classic Word export regenerates it after edits.
2. Review and hand-edit the text as needed.
3. Enter your name and license/syndicate number (optional, but it appears in the signature block and is saved with the study).
4. “توقيع وتصدير PDF / Sign & export PDF” or “... Word”: a SHA-256 document hash is computed and embedded with the signature; open in Xodo (PDF) or WPS Office Lite (Word).
5. Letterhead: “إعدادات ترويسة المؤسسة / Organization letterhead” → set AR/EN names → “حفظ الترويسة / Save” — it then appears on every report.

## 6) Teleradiology consult loop
- Need a colleague’s read? “تصدير حزمة استشارة / Export consult package” (text + snapshot + metadata) → copy or send the file.
- Colleague: “استيراد حزمة استشارة / Import consult package”, “استيراد من الحافظة / Import from clipboard”, or “استيراد آخر حزمة مصدّرة / Import last exported package” → the case enters their worklist with snapshot and context; they draft their own report.
- Closed validation: any tampered package is rejected with a clear message.

## 7) Privacy & cleanup
- All processing happens inside your browser; nothing is uploaded anywhere.
- “تفريغ القائمة من الجهاز / Empty worklist from device” deletes studies from device storage permanently.
- Full erase: Chrome settings → Site settings → Clear site data (last resort; local storage is lost).

## 8) If boot ever stalls on a restricted network
1. Diagnostics page `.../d` shows the last boot stage, last error, and SW state, with rescue buttons.
2. Try fresh routes in order: `/x`, `/y`, `/z`, `/r1/start.html`.
3. Switch Wi-Fi ↔ mobile data and reopen.
4. Clearing site data only as a last resort.

## Clinical reminder
The platform is a **decision-support system**: every draft carries the disclaimer; final clinical responsibility rests with the signing physician.
