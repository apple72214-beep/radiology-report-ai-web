# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## v115 — ب2.87 — 2026-10-15

- **Root cause of the black screen.** Every build from v59 to v114 imported its modules
  (`dicom`, `mpr`, `report`, `codecs/decode`, …) from `v59`; `mpr.v59.js` was never shipped, so
  the MPR module 404'd silently, and the v59 parser produces no `pixelInfo`, so the reason plate
  and the window rescue could never fire. `tools/roll.py` now rewrites the module pins on every
  roll and `--check` asserts both the pin and the file's existence; the test suite asserts it too
  (`launcher_test` §8, `viewer_test` MPR pin).
- **Automatic black-screen autopsy.** After every draw the viewer audits the canvas from the
  live DOM (size on screen, computed style, `elementFromPoint`, pixel readback) and, if the image
  did not reach the screen, names the cause (`no-size`, `hidden`, `covered:<id>`, `no-frame`,
  `uniform`) in the status line and offers a copyable report — no setting and no screenshot
  needed.
- **Layout self-repair + Redraw.** A canvas with no size, hidden or covered is put back in the
  normal flow and re-measured (reported as `layout=repaired`); a **Redraw** button beside the
  slice slider refits and repaints in one tap.

### Per-pane slice slider and window preset (v114, ب2.86)

The last item left open from the reference MPR layout: every pane carried the shared slice index
and the shared window, so you could not hold a bone window on the sagittal while reading soft
tissue on the axial.

- Each pane gets its own **slice slider** (`mpr-slice-<plane>`) and **window select**
  (`mpr-preset-<plane>`), wired once when MPR opens; the slider drives `mprSetIndex()` for that
  plane only and is re-synced from the crosshair on every render.
- A pane's window is stored in `rrai-mpr-preset-<plane>` and defaults to `auto`, which keeps
  following the shared preset — nothing changes for anyone who does not touch it.
- The pane title now names the window in use with its width (`Bone 1.500`), grouped the way the
  reference viewer shows it.
- Two windows joined `PRESETS`: `soft` [50, 400] and `brain` [40, 80], in both the shared select
  and the per-pane selects (bilingual through `OPTS_L`).

`mpr_test.mjs` asserts the per-pane controls, the persistence, the slider wiring and the new
presets. 18/18 suites green.


### Evidence for a refused import (v113, ب2.85)

Naming the reason (v112) was not enough: the physician still had to describe a phone screen in
a chat message, and screenshots of Arabic UI text are not machine-readable here. The import now
produces its own evidence.

- **`ingestFiles()` records a line per file and per entry**: name, size, first four bytes
  (`magic`), ZIP entry count, and for every entry the outcome — `ok` with matrix/transfer
  syntax/length, `parse-error: <message>` with whether the `DICM` magic is present,
  `decode-error: <message>` with the transfer syntax, `no-pixel-element`, or `pixel-problem`
  with length vs needed. Capped at 80 lines.
- **`importReportText()`** renders it with a timestamp and the build; a **"copy last import
  report"** button copies it (clipboard API, falling back to a hidden textarea +
  `execCommand("copy")` where the clipboard is blocked) and also shows it in a scrollable box,
  so it can be pasted straight into a support message.
- **`openDuplicateIfAny()`**: an import whose entire result is duplicates opens the study that
  is already on the device — the most common "refusal" turned out to be a re-import, not a
  corrupt file.
- `studyKeyOf()` is now module-level and exported, so duplicate detection is testable.

`pixels_test.mjs` section 10 asserts the report, the button and the duplicate hand-off.
18/18 suites green.


### A refusal now names its reason (v112, ب2.84)

Importing a study the device already had — or a folder whose files were not DICOM, or a
compressed series whose decoder could not be fetched — produced the same sentence:
"the files are corrupt or in a format we cannot decode, check the console log". On a phone
there is no console, and none of those failures is corruption.

- `ingestFiles()` now records **why** every file was refused: `notdicom`, `nopixels`,
  `emptyzip`, `decode:<transfer-syntax>` (the failing syntax is named), alongside the existing
  `bad`/`badWhy` pixel counters, and returns them as `skipWhy`.
- `ingestRefusal()` turns those counters into one bilingual sentence. When nothing is added the
  app says which of the causes it was, with counts — and an all-duplicates import is told to
  open the study from the worklist instead of being accused of corruption.
- Both import paths (the upload button and the folder picker) use it: the folder path used to
  report "added 0 studies" with no explanation at all.
- The old Arabic-only, untranslated message (which leaked a stale "v0.4 decoders" string and
  broke the EN-mode rule) is gone.

`pixels_test.mjs` gained a section 9 asserting the counters, the bilingual message, and that the
old accusation is no longer in the source. 18/18 suites green.


### The launcher is a control file (v111, ب2.83)

v110 fixed the verification table, but a device can still be handed a **stale launcher**: the
service worker served `start.html` out of its cache, and that copy carried an older release's
hashes — so it rejected every build it was offered. On a network that injects content into some
responses (the user's LTE connection serves `cdn.connecttag.app` payloads), the launcher's
release probes fail too, leaving only its own stale table to guide it.

- **Navigations are network-first and `no-store`**, so neither the HTTP cache nor a proxy can
  hand back an old launcher.
- **`start.html` and `index.html` joined the SW's `LEN` byte table**: a launcher body whose
  length does not match the current build is retried once with a cache-busted URL, and only
  then trusted. A stale launcher can no longer be served.
- **Offline fallback prefers `./standalone.html`** — the self-contained edition boots on its own
  without verifying anything, so a device that cannot reach the network still opens the app.
- **The launcher's handover is now visible and faster**: the failure panel announces
  "opening the single-file edition…" and redirects in 1.2 s instead of 2.5 s.

`len_block()` in `tools/roll.py` grew the two launcher entries; `launcher_test.mjs` asserts the
SW invariants and that the recorded lengths match the files on disk. 18/18 suites green.


### The update loop is over (v110, ب2.82)

A device that could not take an update kept reloading instead: every reload landed on an old
build, that build saw a newer `release.json`, and reloaded again. The cause was in the launcher,
not in the app.

- **Root cause**: `tools/roll.py` maintained `start.html`'s `known` list and `EXPECT` table by
  string-replacing the old version token with the new one. That renamed every historical build
  key to the current build, and in a JS object literal the **last** duplicate key wins — so
  `EXPECT["v109"]` held hashes from a build many releases back. The launcher therefore rejected
  the real v109 files on every mirror (`len 40895≠38403`), fell through to an older build whose
  integrity manifest it could still fetch, booted that, and the cycle restarted. Devices had been
  stuck on v107 since v108 shipped.
- **The tables are generated now, never edited in place**: `fix_launcher()` rebuilds `known`
  (descending, de-duplicated, current build first, from the integrity manifests on disk) and
  `EXPECT` (exactly one entry — the current build, hashed from the files on disk). Every other
  build is validated against its own `integrity.<build>.json` from the same origin, so the table
  can no longer drift. `start.html` shrank from 80 KB to 18 KB.
- **`roll.py --check` audits it**: duplicate build keys, a `known` list that is not headed by the
  current build, and an `EXPECT` that disagrees with `integrity.<b>.json` are all reported (and
  repaired by `--fix`).
- **The update reload is capped**: at most two force-reloads per version, then the banner offers
  *open the launcher* instead of looping; the retry counters are cleared once the device is
  current. The banner no longer implies it will reload forever.
- **`releaseWatch()` called itself** instead of `checkUpdate()` (infinite recursion, so the
  watchdog never registered a single interval). It now polls every 5 minutes and on tab focus.

New suite: `web/tests/launcher_test.mjs` asserts the two tables, the reload cap and the tooling
invariants. 18/18 suites green.


### Data or paint? The app can now tell (v109, ب2.81)

A probe report proved a study's pixel data, its histogram and its computed window were all
healthy (`window lo=155.6 hi=3770.4`, `greySpread=255`, `modeShare=0.076`) while the frame on
screen was still black — so the failure had to be either study-specific or in the paint path,
not in the numbers. Three tools settle it from inside the app:

- **Canvas readback** (`paintReadback`): after every draw, when the diagnostics layer is on, the
  viewer reads the canvas back and reports `paint=ok/255` or `paint=uniform`. That single word
  separates "the frame has nothing to show" from "the pixels never reached the screen".
- **One-tap series scan** (`فحص السلسلة`): renders a sample of the active series off-screen and
  reports how many frames have no pixel data and how many of the sampled ones come out blank —
  no screenshot needed to describe a whole study.
- **Worklist pixel-health badge**: studies holding frames with no drawable pixels are marked
  `⚠ N بلا بكسل` in the slice column. Counted at import, and computed lazily for studies that
  were imported by older builds (which is where today's blank frames come from).


### On-image diagnostics, MPR maximise, diagnosis notice (v108, ب2.80)

- **A diagnostics layer you can switch on** (Settings → Viewer preferences → *On-image
  diagnostics*): the build, series and slice, matrix size, buffer length vs needed, pixel range,
  bit depth, transfer syntax, the window actually applied, the resulting grey spread and the
  dominant-value share are drawn on the image. One screenshot is then enough to debug a frame.
  Off by default; unset preference keys now have a real default instead of reading as "on".
- **The reason plate carries the same numbers**, so a frame that cannot be rendered always
  explains itself with evidence attached.
- **MPR panes can be maximised**: tap a pane title (or double-tap the pane) to enlarge it to the
  full grid width and tap again to restore.
- **"Not certified for diagnosis" notice** under the viewer, dismissible with *Confirm and hide*
  (remembered on the device), bilingual, and restored only if the acknowledgement is cleared.
- The viewer records the render outcome (grey spread + dominant share) on the frame, and the
  `$()` helper no longer throws outside a browser, so the modules stay testable in Node.


### Diagnostics that cannot lie (v107, ب2.79)

- **The probe now prints its own build** (`Radiology report AI v107 — DICOM probe`), so a report
  pasted into a chat can no longer be a stale copy of an older page — which is exactly what
  happened: a cached `probe.html` served the pre-v106 report and hid the new fields.
- **The service worker never caches `/probe.html` or `/diag.html`** (bypass before any cache
  lookup). `start.html` / `index.html` stay cached on purpose: they are the offline escape hatches.
- **Host configuration added to the deployed repo** (`web/vercel.json`): `Cache-Control: no-store`
  for `release.json`, service workers, `app.vNNN.js`, `dicom.vNNN.js`, `ui.vNNN.html`, integrity
  manifests, `standalone.html`, `probe.html`, `diag.html`, `start.html`, `index.html` — plus `/p`
  as a short link to the probe. The deployed repository had no configuration at all until now.


### Series-index fixes & collapse-proof windowing (v106, ب2.78)

- **Series scoping is now complete.** `sliceIdx()` is an index inside the selected series, but
  three call sites still indexed the whole study: `resetView` (canvas size/fit came from another
  series' matrix), the annotation layer (wrong sequence/TE/TR) and the comparison pane. All
  three now use `curFrame()`.
- **A collapsed window can also paint a flat WHITE frame**, not only a black one: when one value
  dominates, `lo == hi` and everything clips to an extreme. The viewer now measures both the
  spread and the clipped share, and treats "flat, or less than 0.5% of the frame carries any
  information" as a failed render — then re-windows outside the dominant band, then over the
  full value range, and only then draws the reason plate.
- **A physician-chosen CT preset is never second-guessed** — only the automatic window is rescued.
- **The probe page reports the window itself**: `lo/hi`, the resulting grey spread (with a
  `BLANK RENDER` marker), the dominant-value share, a 16-bucket histogram, and the outcome of
  both rescues — so a single file identifies the failure mode without a screenshot.


### Background-aware windowing & blank-render guard (v105, ب2.77)

- **The "black image" root cause is fixed.** When one value fills most of the frame — air,
  padding, or a flat band — the 2–98% percentile window collapses to `lo == hi`, and every
  pixel then mapped to the same grey: the data was fine, the render was blank. `drawFrame`
  now measures what it actually painted; if the result is uniform it re-windows **outside the
  dominant band** (`windowOutsideMode`) and repaints, so the anatomy comes back.
- **A blank cache is never replayed.** `pixels.__img` from an older build could hold an
  all-black ImageData and short-circuit every later draw; the cached image is now checked for
  contrast before it is trusted.
- **Still no silent black rectangle**: if even the rescue cannot produce contrast, the canvas
  paints the reason plate (`blank`) with the numbers, the viewer note appears, and the
  diagnostics report can be copied.
- **The build is visible in the viewer header** (`… • MR • v105`), so any screenshot identifies
  the running version — the device was previously stuck on a cached build while a fix was live.
- The DICOM probe page (`/probe.html`) is now kept on the current parser by `tools/roll.py`.


### No silent black frames (v104, ب2.76)

- **A frame with unreadable pixel data is no longer stored.** The parser now checks the pixel
  data length against `rows × cols × bytes-per-pixel` and refuses empty, truncated or
  size-less frames (`problem` = `empty` / `short` / `nosize` / `flat`). Previously an empty
  buffer passed the truthiness check, reached the renderer and came out as a **black
  rectangle with no explanation** — the "no images in the viewer" report.
- **The canvas states the reason.** `drawFrame` paints a captioned plate (Arabic/English)
  instead of black: what is missing, the byte counts, the bit depth and the transfer syntax.
- **Viewer note + one-tap report**: a box under the image spells out the reason and a
  *Copy diagnostics* button produces a paste-ready report (study, series, w/h, len/need,
  bits, photometric, transfer syntax, min/max) so a support request needs no screenshots.
- **MPR refuses blank frames** too — three black panes are never presented as a result.
- **Import tells you**: `"تحذير: N ملفًا لا تحمل بيانات بكسل قابلة للعرض ولم تُخزّن."`
- **DICOM probe page** `/probe.html`: drop one file, get its transfer syntax, matrix, bit
  depth, pixel-bytes vs needed, min/max/mean, a maximum-contrast thumbnail and a copy button.
- Parser hardening: an odd trailing byte on 16-bit pixel data no longer throws and loses the
  whole file; the buffer is trimmed to the frame.
- New test suite `web/tests/pixels_test.mjs` — 17 suites green.


### Series awareness (v103, ب2.75)

- **A study is now split into its DICOM series** (by SeriesInstanceUID, else series number +
  description + matrix + TE/TR). Each series keeps its frame indices, matrix size and sequence
  label, and the breakdown is summarised under the patient name in the worklist
  (e.g. `T1 • T2 • FLAIR`).
- **Series picker** above the viewer whenever a study has more than one series; the slice
  slider, the viewer, the annotation layer and the MPR volume all follow the selected series.
- **MPR is per series — never across sequences.** Reformatting a mixed stack is diagnostically
  wrong, and it was also why the panes stayed blank: frames of differing matrix sizes made the
  volume build fail. The volume is now built inside one series and cached per series.
- **No more blank panes**: if a series genuinely cannot be resliced (single slice, colour,
  inconsistent geometry) the app drops back to the single view automatically and states the
  reason instead of leaving three empty rectangles.
- New test suite `web/tests/series_test.mjs` — 16 suites green.

### On-image information layer & sequence naming (v102, ب2.74)

- **Corner annotation layer** on the image: patient (optional), date + modality, and — the
  point of this release — **series number + sequence label (T1 / T2 / FLAIR / DWI / ADC /
  T2*/SWI / STIR / MRA-TOF / TSE-FSE …)** with slice index and TE/TR. The MPR panes carry the
  same label, so the sequence is visible in every viewport.
- **Labels are never invented silently**: the sequence name comes from the file's
  SeriesDescription / SequenceName / ProtocolName / ImageType / ScanOptions; only when those
  are empty does the app infer a sequence from MR timings (TR/TE/TI) or the b-value, and every
  inferred label is **marked with `~`** so the reader knows it is derived, not stated.
- **Fixed a field-reported draw error** (`Cannot read properties of null (reading 'value')`):
  all reads of the preset/slice controls now go through null-safe helpers, so a missing or
  not-yet-rendered control can no longer abort rendering.
- The report composer's exam name now prefers the study's own description instead of printing
  “نوع الفحص غير محدد” when the file has one.
- New test suite `web/tests/seq_test.mjs` — 15 suites green.

### Study dates in the worklist (v101, ب2.73)

- **New “date” column** in the worklist showing each exam's study date (and time when the file
  carries it), rendered `YYYY/MM/DD` left-to-right.
- **Tag fallbacks**: many exported studies leave `StudyDate` empty, so the parser now walks
  StudyDate → SeriesDate → AcquisitionDate → InstanceCreationDate → ContentDate, and captures
  StudyTime as well. Implausible dates (e.g. month 13) are rejected rather than displayed.
- **Sort by exam date** (newest first) added to the worklist sort options, next to
  urgent-first / newest-uploaded / alphabetical.
- The viewer header shows the same readable date instead of the raw DICOM string.
- New test suite `web/tests/dates_test.mjs` — 14 suites green.

### The single-file edition becomes the front door (v100, ب2.72)

- **`index.html` now hands the default URL straight to `standalone.html`** (instant redirect,
  with manual links kept). One request, one file, everything embedded — there is no longer a
  chain of module fetches that a caching proxy or a stale service worker can poison.
- **`standalone.html` is a full PWA again**: it registers the current build's worker with
  `updateViaCache: "none"`, unregisters any older registration, and reloads once when a newer
  build is installed — so offline use and automatic updates both keep working. It never
  attempts a worker from `file://` or other opaque origins.
- `start.html` stays as the resilient multi-origin launcher (shards, mirrors, integrity
  manifests) for anyone who needs it, reachable from the hand-over page.

### Update self-healing (v100, ب2.72 — hot-fix on the launcher)

- **Stale-worker eviction**: when a response fails length/SHA validation *and* an old service
  worker controls the page (exactly the situation that kept a device on v99 with a
  `len 39575≠238403` error), the launcher unregisters every worker, deletes every cache and
  reloads once per session — the next boot talks to the network directly.
- **Poisoned cache entries are refused**: the service worker now size-checks a cached body
  against the build's `LEN` table before serving it (`trustedHit`); a mismatch falls through
  to the network instead of being replayed forever.
- **Range-unaware proxies**: shards that come back larger than requested mark ranged fetching
  as broken for the rest of the session, so no garbage is ever concatenated.
- **Fall forward, not back**: if the newest build cannot be verified but an older one boots,
  the app says so and hands over to `standalone.html` (single file, no ranged fetching)
  instead of silently staying on the old build.

### Multi-planar viewer — MPR (v100, ب2.72)

- **Three linked viewports**: axial, coronal and sagittal, rebuilt on the device from the
  slice stack (`web/mpr.v100.js`) — no external libraries.
- **Synchronised crosshair**: click (or tap) anywhere in a pane and the other two jump to
  that exact voxel; drag or wheel inside a pane scrolls that plane only.
- **Geometry-aware**: the stack is ordered along the slice normal from
  `ImagePositionPatient`/`ImageOrientationPatient` (falling back to instance numbers), and
  slice spacing comes from position deltas → `SpacingBetweenSlices` → `SliceThickness`.
  Each pane keeps its true aspect ratio (coronal/sagittal rows use the through-plane
  spacing), and thick-slice stacks are flagged as approximate in the UI.
- **Memory guard**: volumes above 40M voxels are downsampled automatically, with the factor
  shown to the user; MPR is lazy (built on first use, cached per study) and optional — if
  the module fails to load the rest of the app is untouched.
- Keyboard: ←/→ move the focused pane while MPR is on; the window preset applies to all three.
- New test suite `web/tests/mpr_test.mjs` (volume ordering, plane geometry, reslicing,
  crosshair round-trips, guards) — 13 suites now green, viewer suite at 177 assertions.

### Verified in the field (v99.1, ب2.71)

- The single-file edition was confirmed working on a device opened **as a local file**
  (`content://media`, Chrome for Android) — no server, no connection — with Arabic UI,
  demo generation, PACS and worklist all functional, and no spurious update banner.
- Documented in the user guides (AR/EN) as a travel/offline option, with a note to keep
  periodic backups because file-level storage is separate from the site's storage.

### Release tooling (v99.1, ب2.71)

- **`tools/roll.py`** is now the single source of truth for cutting a build: it copies the
  modules (regenerating `codecs/decode.vNN.js` from its pristine ancestor if it vanishes),
  rebuilds the service worker's `CRITICAL` list *current-build-only*, regenerates `LEN`,
  keeps `sw.js` a relay, pills the previous build's worker, updates the launcher's
  `EXPECT`/`known`/markers/pinned fallback origin, writes `release.json` + the integrity
  manifest and rebuilds `standalone.html`.
- **`python3 tools/roll.py --check [--fix]`** audits (and repairs) drift of exactly the kind
  that broke updates: stale `sw.js`, stale `CRITICAL`, stale `LEN`, missing `decode`,
  unpilled retired workers, launcher/manifest disagreement, single-file edition out of sync.
  It runs inside `web/tests/roll_test.mjs`, so CI catches it.
- The pinned fallback origin (`PIN`) is refreshed every roll instead of pointing at a
  build-80-era commit.

### Update-path hardening & single-file edition (v98–v99.1, ب2.70–ب2.71)

- **v99.1** — *single-file edition* `standalone.html`: the whole app (UI + all 9 modules)
  is embedded in one HTML file and wired through blob URLs, so it needs **zero network
  requests** after the page loads. Immune to blocking/caching proxies, to the service
  worker, and to CORS. Also served from an immutable jsDelivr URL pinned to a commit.
- **v99.1** — 88 retired service-worker scripts (`sw.v11.js` … `sw.v98.js`) replaced by a
  *self-destruct pill*: on first update check they wipe every cache, unregister themselves
  and reload the page, so a device frozen on an old build escapes automatically.
- **v99.1** — `sw.js` is now a permanent relay (`importScripts("./sw.v99.js")`) instead of a
  stale v95-labelled copy with an outdated precache list; registration uses
  `updateViaCache: "none"`.
- **v99.1** — the launcher never dead-ends: any boot failure offers (and auto-opens once per
  session) the single-file edition and points at `diag.html`.
- **v99.1** — `diag.html` probes all six origins the launcher can use and reports which ones
  are blocked or 404.
- **v99** — newest build first in the launcher, integrity manifests fetched for locally-unknown
  builds, triple-origin update probe (GitHub + jsDelivr + mirror) taking the highest version,
  fresh route `/u9`.
- **v98** — numeric update gate (`verNum`) so a stale response can never prompt a *downgrade*;
  control files (`sw.js`, `sw.vNN.js`, `integrity.vNN.json`) are network-first and never cached;
  CRITICAL precache rebuilt current-only; force-reload clears caches and wakes the waiting worker.

### Settings & UX arc (v95–v97, ب2.67–ب2.69)

- v95: ☰ side drawer (status, worklist, critical-only filter with live count, archive, collapsed data-management group, AI, settings, install PWA, help); ⚙ settings modal (PACS URL+Bearer token+test+auto-fetch with confirm-before-import; critical sound+vibration alert; storage estimate+free-images+anonymize; dark/light theme); bottom data buttons collapsed into `<details>`.
- v96: ten-section expanded settings — language+theme; PACS AE Title/Port fields (documented as legacy-only); viewer default window, overlay show/hide, measurement color+mm/cm unit; auto-open first study after upload; worklist default sort (urgent/date/name); customizable keyboard shortcuts (slice nav, fit, measure) with key recorder; privacy retention selects inside settings; default export format (Word/PDF button swap) + gzip consult packages (magic-byte import detection); image-smoothing performance toggle; rebuild-cache + clear-local-DB; About section (version, live connection status, medical disclaimer, privacy policy, licenses, support).
- v97: complete keyboard shortcuts — zoom in/out (+/−, ×0.5–×8 clamped, image re-centered via centerOn) and contrast cycling (c) through window presets; three new customizable key recorders; viewer tests 144→156.

### Web viewer reliability & fullscreen arc (v52–v68)

- v52–v56: flicker-free redraw (no per-slice canvas clear), pixel cache, integer pan, pinch centroid anchor, explicit canvas px width with center-origin zoom (no layout crop).
- v57: build-tagged module filenames so every roll is boot-assembleable on devices (ended the silent v52 fallback era).
- v58: truthful build reporting (APP_BUILD in meta line), honest update banner, origins rebuilt (raw.githubusercontent first, vercel-alt SSO-trap hostname removed).
- v59: series-wide fit scale from largest frame + refit on window resize / fullscreenchange (stale-scale fix on PC).
- v60: height-aware fit on desktop (controls never pushed off-screen), SW skipWaiting+clientsClaim, open-tab self-heal (controllerchange auto-reload + periodic update), current SW precache list.
- v61: fixed series stage box (mixed-dim slices keep constant scale and constant layout, centered), overlay + pointer math stage-safe, height cap desktop-only.
- v62: fit button relabeled «ملاءمة», live ×zoom indicator, dblclick zoom tempered to ×2 with undo hint.
- v63: per-slice fit restored (every slice fills the viewport; mixed-dim no longer shrinks to 0.6×), SW-internal rejections silenced, legacy /r1 /r2 /r3 paths redirect to canonical.
- v64: release watchdog auto-reloads stale tabs without needing ServiceWorker; meta line exposes live fit factor for forensics.
- v65: fullscreen button (native + pseudo-fullscreen fallback).
- v66: fullscreen flex viewport with definite height, fit measured from real viewport height, clamped drag-pan.
- v67: fullscreen controls become auto-hiding bottom overlay (tap to reveal, 3s hide).
- v68 (current): fullscreen CONTAIN geometry (whole image visible at max size, zero crop), vertical swipe scrolls slices, drag-pan when zoomed, auto-hide controls. viewer_test 52 asserts.
- Deployment facts: public mirror apple72214-beep/radiology-report-ai-web → Vercel auto-deploy; two-stage PIN refresh per roll; boot-assembly check (sha256+chars on live/raw/pin) mandatory per roll; bundle = docker/build-bundle.sh from repo root.

- v0.2: heuristic CPU triage with urgent-first worklist, SSE live events, and installable offline PWA shell.
- v0.1: DICOM study intake, worklist API, and built-in offline-friendly web viewer.
- Add market research & competitive analysis (docs/market-research.md).
- Rename project to Radiology report AI.

- Harden analysis run ownership and quarantine handling.
- Add shared analysis SSE event history.
- Support cross-worker analysis idempotency.
- Add safe ZIP and RAR study archive uploads.
