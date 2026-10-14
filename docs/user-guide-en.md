# Radiology report AI — Browser Edition: User Guide

A fully in-browser radiology reporting workbench: no server, no data leaves your device. After the first successful boot the app is cached on-device and works offline.

## 1) First open
1. Open `https://radiology-report-ai-web.vercel.app/x` (or any fresh route you are given: `/y`, `/z`, `/r1/start.html`).
2. Wait for the full UI (on weak networks a progress line counts seconds — let it continue).
3. After the first success a Service Worker is registered: from then on the normal `.../start.html` works even with no network.
4. Recommended: browser menu → **Add to Home screen** to run it like an app.

## 2) Getting studies in
- **Your DICOM files**: “اختيار الملفات / Choose files” → pick `.dcm` or `.zip` → “رفع وتحليل / Upload & analyze”. Studies are auto-triaged (urgent / consult / routine) into the worklist.
- **Since v43**: the “Pick a whole DICOM folder” button opens your device's folder picker (path like patient → S00004 → SER00001) and ingests **every file inside it in one go**, even extension-less (BIN) DICOM; non-DICOM files are skipped automatically with a count. Equivalent alternative: compress the folder to `.zip` with any file manager and pick the single ZIP.
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

## 9) Connecting a hospital PACS / a DICOM viewer app (Orthanc bridge)
The classic DICOM dialog (AE title, host, port 11112, C-GET/C-MOVE) is raw DICOM-over-TCP; browsers cannot speak it. The bridge is **Orthanc**, bundled in the edge package:
1. On a LAN machine run the edge bundle: `docker compose -f docker/docker-compose.yml up -d` — it starts the workbench (port 8080) **plus Orthanc** (DICOM port 4242, DICOMweb at `/dicom-web/` behind the bundled nginx with CORS).
2. Edit `docker/orthanc.json`: set `DicomModalities.hospital_pacs` to your PACS AE title/host/port (the same values you would type in any viewer's "New server" dialog), restart the stack, then pull studies into Orthanc from its REST API or let the PACS C-MOVE to AET `RRAI`.
3. In Radiology report AI open "Pull from PACS (DICOMweb)" and enter `http://<edge-ip>:8080/dicom-web` — same-origin, no relay needed; private-address targets are called directly, public internet DICOMweb endpoints go through the `/api/dicomweb` CORS relay.
4. Your mobile DICOM viewer app connects to the *same* Orthanc as its "New server": Name any, AE title `RRAI`, Host = edge IP, Port `4242`, Retrieve C-GET. Both apps now read the identical case pool.
5. Since v42 the "Pull from download link (WeTransfer/ZIP/DICOM)" button has its own dedicated field named "Download link" in the same panel: paste a WeTransfer, ZIP or direct `.dcm` link and press the button. Left empty, the button opens a native paste window, and the link is extracted even when pasted inside a sentence or without `https://`. WeTransfer links are resolved server-side; if WeTransfer demands human verification from the server a clear message appears and the fallbacks are manual upload or a direct ZIP link.
Zero-server alternative: export/share the `.dcm` files from the viewer app and upload them in the workbench ("اختيار الملفات") — no server at all.

## 10) AI-assisted drafting (optional — no credit card anywhere)
In the viewer → "Compose the diagnostic report": pick a provider and paste an API key (stored on your device only):
1. **Groq (default, card-free)**: console.groq.com → sign up with email/Google → verify email → sidebar "API Keys" → Create API Key → copy immediately (shown once) → paste in the platform.
2. **OpenRouter (card-free)**: openrouter.ai/keys → sign up with email/GitHub → Create Key → paste; only `:free` models are used.
3. **Google Gemini**: only if your Google account does not hit a regional billing/card wall — if it asks for a card, ignore it and use Groq.
Pressing "AI-assisted draft" shows a per-request consent dialog: only 3 downscaled slice renders (≤512px) + numeric stats are sent — never raw DICOM — and a JSON draft (exam/indication/findings/impression) fills the composer fields for you to edit before export and sign-off. Without a key or offline, the composer, phrase bank and exports all keep working locally.

## 11) Side menu & settings modal (since v95–v96)
The **☰** header button opens a touch-friendly drawer: status (online/offline + study count), worklist, "Critical only" with a live count, archive, "Data management ▾" (collapsed button group), AI composing, **⚙ Settings**, install app (PWA), and help.

The **⚙ Settings** modal has ten collapsible sections:
1. **🏥 Network & PACS**: DICOMweb URL, Bearer token (stored locally), "Test connection", auto-fetch (off/5/15/30 min — imports always **ask for your confirmation**, never silent), plus AE Title and Port fields to document legacy system settings (the actual connection is HTTP).
2. **🤖 AI & alerts**: audible+vibration alert (880Hz tone) for new critical studies.
3. **💾 Storage & data**: storage estimate, free images of archived studies, anonymize patient in exported consult packages, image smoothing (disable for speed on heavy studies), rebuild offline cache, and empty the local study database (with confirmation — archived reports stay).
4. **🎨 Display & language**: interface language (Arabic/English) and theme (medical dark/light).
5. **🖥 Viewer preferences**: default window/level on study open (auto/lung/mediastinum/bone), show or hide the patient name overlay and slice info line, measurement tools color (color picker) and unit (mm/cm).
6. **📋 Worklist**: default sorting (urgent first / newest / by name) and auto-open the first study after a folder upload.
7. **⌨ Keyboard shortcuts**: see section 12.
8. **📤 Import & export**: default export format (Word or PDF — highlights the primary button automatically) and gzip compression for consult packages (import detects `.json.gz` by magic bytes and decompresses automatically; plain `.json` still works).
9. **🔒 Privacy & security**: auto-delete period for drafts/studies (30–365 days or off) and for signed reports (90 days–2 years or off).
10. **ℹ About**: version, live connection status, medical disclaimer, privacy policy, licenses (fully original implementation, zero external libraries), and support channel.

## 12) Keyboard shortcuts (v96–v97)
| Action | Default key |
|---|---|
| Next slice | `→` ArrowRight |
| Previous slice | `←` ArrowLeft |
| Fit view | `f` |
| Measure mode | `m` |
| Zoom in (×1.25 up to ×8, re-centers) | `+` |
| Zoom out (down to ×0.5) | `-` |
| Cycle contrast (viewer windows) | `c` |

All shortcuts are **customizable**: open ⚙ → section ⌨ → click a field and press the desired key. Keystrokes are ignored while typing in any input field so they never clash with text entry.

## 13. When updates fail (a network that blocks our CDNs)

1. Open **`standalone.html`** — the *single-file edition*: UI and all modules are embedded in
   one page, so it needs **no external request** after load and is immune to a stale service
   worker or a caching proxy.
2. Open **`diag.html`** to see exactly which external origins (GitHub, jsDelivr, githack,
   AllOrigins) are blocked or return 404 on your connection.
3. From inside the app: ☰ → About → “single-file edition / diagnostics”.
4. Last resort: browser settings → site data → clear, then reopen.

### Downloading the single-file edition

You can download `standalone.html` and open it from your device's file manager: it runs
**with no server and no connection** (verified on Chrome for Android). Daily use stays on the
installed PWA; the local file is handy when travelling or on a device with no internet.
Export a backup periodically, since file-level storage is separate from the site's storage.

## 15. Study date

- The worklist now has a **date** column for every case (with the time when the file carries it).
- If the date tag is missing — common in exported studies — the app walks StudyDate → SeriesDate
  → AcquisitionDate → InstanceCreationDate → ContentDate.
- You can **sort by exam date** (newest first) from the worklist settings.

## 16. On-image information layer (exam type & sequence)

- The image corners now show: patient (optional), date + modality, and **series number +
  sequence label** (T1 / T2 / FLAIR / DWI / ADC / T2* / STIR / MRA-TOF …), plus slice index
  and TE/TR. MPR panes carry the same label.
- **Tags first**: the name is read from SeriesDescription / SequenceName / ProtocolName /
  ImageType / ScanOptions. Only when those are empty does the app infer from MR timings
  (TR/TE/TI) or the b-value — and every inferred label is **marked with `~`**.
- Settings → Viewer preferences: toggle the information layer, and toggle TE/TR inside it.

## 17. When no image appears (black-frame diagnostics)

- **No silent black screens.** If a file carries no drawable pixel data it is refused at
  import and reported: "Warning: N file(s) carry no readable pixel data and were not stored."
- For a study already on the device, the viewer paints a **reason plate** instead of a black
  rectangle, with a box under the image giving the numbers (bytes present/needed, bit depth,
  transfer syntax). **MPR** will not show three black panes — it falls back to the single
  view and states why.
- The **Copy diagnostics** button below the image copies a paste-ready report (study, series,
  matrix, len/need, bits, photometric, transfer syntax, min/max). Paste it when asking for help.
- The **DICOM probe** page at `/probe.html`: drop one file from the study and it prints the
  transfer syntax (compressed or not), matrix, bit depth, pixel bytes vs needed, range, and a
  maximum-contrast thumbnail — all inside your browser.

### 18. Smart windowing (v105)

- If a single value (air, padding, a flat band) fills most of the frame, the 2–98% percentile
  window collapses and every pixel maps to the same grey: **the image looked black although the
  data was fine**. The viewer now measures what it painted and, when the result is uniform,
  re-windows **outside the dominant band** and repaints.
- A black image cached on the frame by an older build is no longer replayed.
- If nothing helps, the **reason plate** is drawn with the numbers instead of a black rectangle.
- **The build number is shown in the viewer header** (e.g. `MR • v105`) so you — and support —
  can tell which version is actually running.

### 19. On-image diagnostics layer (v108)

- **Settings → Viewer preferences → "On-image diagnostics"** draws a diagnostics block over the
  image: build, series and slice, matrix size, buffer length vs needed, pixel range, bit depth,
  transfer syntax, the window actually applied, and the resulting grey spread and dominant-value
  share. **A single screenshot is then enough** to explain any blank frame. Off by default.
- **The reason plate carries the same numbers**, so a frame that cannot be rendered always comes
  with its own evidence.
- **MPR panes can be maximised**: tap a pane title (or double-tap the pane) to enlarge it across
  the grid, and tap again to restore.
- **A "not certified for diagnosis" notice** sits under the viewer with a *Confirm and hide*
  button that is remembered on the device.

### 20. Data or paint? (v109)

- **Canvas readback**: with the diagnostics layer on, the viewer reads the canvas back after
  every draw and prints `paint=ok/255` or `paint=uniform`. One word separates "this frame has
  nothing to show" from "the pixels never reached the screen".
- **Series scan button**: renders a sample of the active series off-screen and reports how many
  frames carry no pixel data and how many of the sampled ones come out blank — one tap, no
  screenshots.
- **Worklist pixel-health badge**: studies holding frames with no drawable pixels are marked
  `⚠ N blank` in the slice column. Counted at import and computed lazily for studies imported
  by older builds.

### 21. The update loop is over (v110)

The launcher (`start.html`) keeps a verification table — the size and SHA-256 of every file of a
build. It used to be maintained by string-replacing the version token, which renamed **every**
historical build key to the current one. In a JavaScript object literal the **last** duplicate key
wins, so the launcher validated the new build's files against the hashes of a build many releases
back. Every mirror "failed", the launcher fell back to an old build, that old build saw a newer
`release.json` and force-reloaded — endlessly.

- **The table is now built from the files themselves**: the launcher carries hashes for the
  current build only, computed from `integrity.v110.json`; every other build is validated against
  its own integrity manifest fetched from the same origin.
- **The fallback list is generated**, descending and de-duplicated (v110 … v35), newest first.
- **A cap on reloading**: when an update exists the app reloads **at most twice per version**,
  then shows an *open the launcher* link instead of looping. Once the device reaches the newest
  build the counters are cleared.
- **The release watchdog called itself** instead of checking for updates (which disabled it
  completely). It now polls: every 5 minutes and whenever you return to the tab.

> If you ever see "update available … loading it now" more than once, open `start.html` — it
> re-verifies every file against its hash and boots the newest build.

### 22. The launcher is a control file (v111)

When the launcher cannot verify any build it shows its error panel and then **opens the
single-file edition by itself** (after 1.2 s, and it says so on screen). So a glimpse of that
panel followed by a working app is the fallback path doing its job.

- **The launcher used to be cacheable**: `start.html` was served from the service worker's
  cache, so a device could keep a stale copy carrying an older release's hashes — which then
  rejected every newer build and sent the device back to an old one. It is now always fetched
  from the network (`no-store`), length-checked against this build's byte table, and retried
  with a cache-busted URL when it is stale or tampered with.
- **Offline**, the self-contained single-file edition is preferred over a launcher that can no
  longer verify anything.
- Some responses on your network arrive with injected content (`cdn.connecttag.app`). The hash
  check rejects them — proof the integrity layer is doing its job, not a fault.

### 23. When the app refuses an import (v112)

The old message always said "the files are corrupt or in a format we cannot decode — check the
console", even when nothing was corrupt. **The message now names the real reason, with counts:**

| Cause | What you see |
|---|---|
| Study already on the device | "3 duplicate studies are already on this device — open it from the worklist" |
| Files that are not DICOM | "12 file(s) are not readable DICOM" |
| Compressed files that would not decode | "4 compressed file(s) the decoder could not unpack (1.2.840.10008.1.2.4.50) — their decoder is fetched once, while online, then cached for offline use" |
| No pixel element / empty archive | "5 file(s) carry no pixel data element" — "2 archive(s) held no DICOM file" |
| Empty, truncated or uniform pixels | "7 file(s) whose pixels are empty, truncated or uniform" |

> Re-importing the same study **stores nothing new** — duplicates are skipped, and the message
> now says so instead of blaming your files.

### 24. A copyable import report (v113)

When an import is refused you no longer need screenshots: a **"copy last import report"**
button appears under the import panel. Tapping it copies (and shows) a plain-text report of
exactly what the device saw, file by file:

```
Import report — 06/10/2026, 00:41 — build v113
file IMG001 bytes=527384 magic=4449434d single
  IMG001 ok 512x512 ts=1.2.840.10008.1.2.1 len=524288
file study.zip bytes=44123904 magic=504b0304 zip entries=219
  IMG002 parse-error: no DICM magic
duplicate of a study already on this device: ALI ABDULLAH|20261004|MR|24
```

- `magic` reveals what the file really is (`4449434d` DICOM, `504b0304` ZIP, `89504e47` PNG).
- Every file states its own outcome: `ok`, `parse-error`, `decode-error` with the transfer
  syntax, `no-pixel-element`, or `pixel-problem` with length vs needed.
- **A duplicate is opened for you**: when the entire refusal is "this study is already here",
  the app opens the copy from the worklist instead of reporting an empty result.

### 25. Per-pane slice slider and window (v114)

- **A slice slider under every pane** (axial / coronal / sagittal): moves that plane only, and
  stays in step with the crosshair when you click or drag on another pane.
- **A window (W/L) select per pane**: `Auto` (follows the shared window), `Soft tissue`,
  `Mediastinum`, `Bone`, `Lung`, `Brain`. The choice is remembered on the device, so bone stays
  on the sagittal and soft tissue on the axial every time you reopen the study.
- **The pane title names the window in use**, e.g. `Bone 1.500` (name then window width in HU),
  the way the reference viewer does.
- **Soft tissue** and **Brain** windows were added to the shared window select as well.

### 26. Black screen: automatic autopsy and modules restored to their build (v115)

**The main fix in this release:** the app was importing its modules (the DICOM parser, MPR,
the report writer, the codecs …) from **v59** — so every build from v59 to v114 ran the old
parser, and `mpr.v59.js` was **never shipped at all**, so the MPR module failed to load (404)
in silence. The old parser produces no `pixelInfo`, so neither the reason plate nor the window
rescue could ever fire: **a black image with no explanation**.

- **Every module is imported from the build that ships it.** `tools/roll.py` rewrites those
  pins on every roll, and `--check` rejects any build that imports a module from another build
  — or a file that does not exist.
- **An automatic autopsy after every draw.** The viewer measures the canvas the way the screen
  sees it: its size on screen, its computed `display/visibility/opacity/position`, the element
  actually on top of it (`elementFromPoint`), and a pixel readback after the paint. If the image
  did not reach the screen it names the cause in the status line and offers a **copyable
  report** — one tap, no setting, no screenshot.
- **Self-repair for layout.** A canvas left with no size (the layout settled after the draw),
  hidden, or covered is put back in the normal flow and re-measured; `layout=repaired` is
  reported when that happens.
- **A "Redraw" button** beside the slice slider clears the cached measurement and refits and
  repaints the frame in one tap.

Black-screen causes are now distinct and named: `no-size`, `hidden`, `covered:<id>`, `no-frame`
and `uniform` (every pixel the same value).
