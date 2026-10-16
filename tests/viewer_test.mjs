import fs from "node:fs";
const build = JSON.parse(fs.readFileSync(new URL("../release.json", import.meta.url), "utf8")).build;
import { drawFrame, paintReadback, filmWindow, filmDragSteps, fitScaleFor } from "../app.v128.js";
let fails = 0, checks = 0;
const ck = (c, n) => { checks++; if (!c) { fails++; console.log("FAIL " + n); } };
const eq = (a, b, m) => { checks++; if (a !== b) { fails++; console.log(`FAIL ${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };
const app = fs.readFileSync(new URL("../app.v128.js", import.meta.url), "utf8");
function fakeCanvas() {
  let w = 0, h = 0, sets = 0;
  const ctx = { createImageData: (W, H) => ({ data: new Uint8ClampedArray(W * H * 4) }), putImageData: () => {} };
  return {
    get width() { return w; }, set width(v) { w = v; sets++; },
    get height() { return h; }, set height(v) { h = v; sets++; },
    getContext: () => ctx, sets: () => sets,
  };
}
const px = { w: 64, h: 64, data: new Uint16Array(64 * 64).map((_, i) => i % 997) };
const c = fakeCanvas();
drawFrame(c, px, "auto", "MR");
ck(c.sets() === 2, "first draw sizes canvas once");
drawFrame(c, px, "auto", "MR");
ck(c.sets() === 2, "second draw must NOT re-clear canvas (flicker guard)");
ck(px.__win && px.__win.k === "auto|MR", "window/level memo stored per frame");
const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../app.v128.js", import.meta.url), "utf-8"));
ck(src.includes("if (viewKey !== vKey)"), "view preserved across slice scroll");
ck(src.includes("Math.round(vx)"), "integer pan (no subpixel shimmer)");
ck(src.includes("requestAnimationFrame(() => { showRaf = 0; show(v); })"), "scroll redraws coalesced via rAF");
ck(!src.includes("sampleMean"), "GPU readback forensic removed from scroll path");
ck(src.includes("pixels.__img"), "ImageData cache for slice revisit");
ck(src.includes("if (ov.width !== f0.w)"), "overlay resize guarded");
ck(!src.includes("vpR.addEventListener"), "conflicting dblclick listener removed");
ck(src.includes("if (vk <= 1.01 && !fsNow()) { vx = 0; vy = 0; }"), "no floating pan below zoom 1 (pan allowed in fullscreen only)");
ck(!src.includes("Math.max(1, Math.min(4,"), "fit allowed below 1x on phones");
ck(src.includes("• ${APP_BUILD}"), "meta line uses APP_BUILD (never a stale literal)");
ck(src.includes("window.innerHeight"), "fit accounts for available height (controls stay on screen)");
ck(src.includes("controllerchange"), "open tabs self-heal when a new SW takes control");
const sws = await import("node:fs").then((fs) => fs.readFileSync(new URL("../sw.v128.js", import.meta.url), "utf-8"));
ck(sws.includes("self.skipWaiting()") && sws.includes("clients.claim()"), "SW activates immediately and claims clients");
ck(sws.includes("app." + build + ".js"), "SW precache list matches current build");
ck(src.includes("function sliceFitFor(f)"), "per-slice fit: every slice fills the viewport");
ck(!src.includes("for (const fr of current.frames) { if (fr.w > maxW)"), "no series-wide scaling (was shrinking mixed-dim slices)");
ck(src.includes("function releaseWatch()"), "stale tabs auto-reload via release watchdog");
ck(src.includes("rrai-rw-"), "auto-reload guarded once per build");
ck(src.includes(": \"ملاءمة=\"}${fitK.toFixed(2)}") && src.includes('"fit="'), "meta line exposes live fit factor for forensics (bilingual)");
ck(src.includes("card.requestFullscreen"), "native fullscreen with graceful fallback");
ck(src.includes("fs-fake"), "pseudo-fullscreen fallback for browsers without API");
ck(src.includes("const fs = fsNow()"), "fit honors fullscreen height");
ck(src.includes("const ch = vp ? (vp.clientHeight || 0) : 0;"), "fullscreen cover measured from real viewport height");
ck(src.includes("const avail = fsAvailHeight(vp, chh);") && src.includes("fitScaleFor(cw, avail, f.w, f.h)") && src.includes("Math.max(0.25, Math.min(4, a))"), "v127: fullscreen CONTAIN — the whole image is fitted to the space above the bars, never cropped");
ck(src.includes("function fsArm()") && !src.includes("fsBarShow(false); }, 3000)"), "fullscreen controls stay visible (no auto-hide)");
ck(src.includes("qwen/qwen3.8-27b"), "groq list uses live Sep-2026 free models (retired llama ids removed)");
ck(src.includes("new AbortController()"), "AI requests time out at 45s instead of hanging");
ck(src.includes("const provName = provider === \"groq\" ? \"Groq\""), "consent dialog names the ACTUAL provider (no stale Gemini wording)");
ck(!src.includes("to Google Gemini for this one request?"), "hardcoded Gemini consent text removed");
ck(src.includes("console.groq.com → API Keys (gsk…)"), "missing-key guidance points to card-free Groq");
ck(src.includes("You are a CONSULTANT RADIOLOGIST assistant"), "prompt demands consultant-grade structured draft");
ck(src.includes("c.toDataURL(\"image/jpeg\", 0.9)"), "renders sent at 768px JPEG (sharper vision input)");
ck(src.includes("technique: String(obj.technique || \"\").trim()"), "AI technique stored with the report");
ck((await import("node:fs").then((fs) => fs.readFileSync(new URL("../docx.v128.js", import.meta.url), "utf-8"))).includes("const compTech = comp && comp.technique"), "Word export uses AI technique when present");
ck(src.includes("fileToJpegB64") && src.includes(".concat(aiExtraImgs).slice(0, 8)"), "physician screenshots join the request (max 8 images)");
ck(src.includes("attached screenshot(s)"), "consent names attached screenshots");
ck(src.includes("EQUAL weight to the slice renders"), "prompt gives attached screenshots primary-evidence weight");
ck(src.includes("rrai-self-heal") && src.includes("location.reload()"), "boot error self-heals once (purge stale caches + unregister + reload)");
ck(sws.includes("rrai-sw-updated"), "SW notifies clients after activate");
ck(src.includes("function clampPan()"), "drag pan clamped so image cannot be lost");
ck(src.includes("vk <= 1.01 && fsNow()"), "vertical swipe scrolls slices inside fullscreen");
ck(src.includes("let pinch0 = 0, k0 = 1, moved = false, swAccum = 0;"), "swipe accumulator reset per gesture");
ck(src.includes("} else if (ptrs.size === 1 && vk > 1.01) {"), "drag pan retained when zoomed");
ck(src.includes("wr.style.height = stH + \"px\""), "fixed stage box (no layout jump on mixed-dim series)");
ck(src.includes("ov.style.inset = \"auto\""), "overlay box tracks canvas inside stage");
ck(src.includes("min-width: 900px"), "height cap only on desktop layouts (phones keep width fit)");
ck((src.match(/const r = \$\("frame"\)\.getBoundingClientRect\(\);/g)||[]).length === 2, "pointer math uses canvas box (stage-safe)");
const ui = await import("node:fs").then((fs) => fs.readFileSync(new URL("../ui.v128.html", import.meta.url), "utf-8"));
const startHtml = (await import("node:fs")).readFileSync(new URL("../start.html", import.meta.url), "utf-8");
ck(startHtml.includes("ev.persisted") && startHtml.includes("rrai-sw-updated"), "bootstrap reloads on bfcache restore and on SW update");
ck(src.includes("if (useImages && !cfg.vision[model] && !cfg.native) continue;"), "images never silently dropped: text-only models skipped while images pending");
ck(src.includes("المسودة من السياق/الملاحظات فقط"), "blind fallback draft is explicitly labeled");
ck(src.includes("function renderBank") && ui.includes("id=\"bank-list\""), "phrase bank rendered per study region");
ck(!ui.includes("data-sent=\"Post-operative changes are noted"), "static spine-only bank removed from UI");
ck(src.includes("or any adequacy comment anywhere including IMPRESSION"), "prompt bans image-adequacy comments");
ck(src.includes("while (totalB64 > 3500000 && images.length > 6)"), "oversized payloads shed extra screenshots before sending");
ck(src.includes("سبب الفشل: "), "blind fallback shows the actual vision failure reason");
ck(src.includes("prefillComposer(current);\n    renderBank(current);"), "phrase bank populated at boot for restored study");
ck(src.includes(") + \" — \" + APP_BUILD;"), "bank header shows region + build marker for field proof");
ck(src.includes("/^(AIza|AQ\\.)/i.test(k)"), "new AQ-format Gemini keys auto-detected");
ck(src.includes("!cfg.vision[model] && !cfg.native"), "Gemini native models treated as vision-capable");
ck(src.includes("Send up to 6 slice renders") && src.includes("while (totalB64 > 3500000 && images.length > 6)"), "six evenly spaced renders, 8-image cap with size shedding");
ck(src.includes("function setupTemplates") && ui.includes("id=\"tpl-list\""), "settings icon with normal/pathology template library");
ck((await import("node:fs").then((fs) => fs.readFileSync(new URL("../docx.v128.js", import.meta.url), "utf-8"))).includes("paraBold(\"• \" + String(bullets[bi2]).replace"), "Word impression bullets bold-parsed and de-duplicated");
ck(src.includes("function techniqueFor"), "deterministic TECHNIQUE generator with sequence catalog");
ck(src.includes('technique: String(obj.technique || "").trim() || techniqueFor(study)'), "AI draft never leaves technique empty");
ck((await import("node:fs").then((fs) => fs.readFileSync(new URL("../docx.v128.js", import.meta.url), "utf-8"))).includes("compTech || techniqueFor(study)"), "Word technique falls back to catalog, not contradictory boilerplate");
ck(ui.includes("id=\"app-logo\"") && ui.includes("./icons/logo.png"), "brand logo rendered in the header");
ck(sws.includes("./icons/logo.png"), "logo precached for offline branding");
ck(src.includes("const lat = /RIGHT|"), "technique names the correct side (right/left) from exam fields");
ck(src.includes("function archiveSave") && src.includes("function archiveExport"), "report archive store + re-export from archive");
ck(src.includes("archiveSave(current, Object.assign({}, comp2"), "every Word export auto-archived");
ck(ui.includes("id=\"archive-list\"") && ui.includes("id=\"archive-save\""), "archive UI (list + manual save + search)");
ck(src.includes("rrai-archive"), "archive persisted on device (localStorage, 300-entry cap)");
ck(src.includes("function purgeOld") && src.includes("rrai-retention-days"), "configurable retention with auto-purge of archive + studies");
ck(src.includes("purgeOnceSoon();"), "purge runs automatically once per session after worklist load");
ck(ui.includes("id=\"retention-days\"") && ui.includes("id=\"purge-now\""), "retention selector + manual purge button in archive UI");
ck(src.includes("(s.meta && s.meta.patientName) || s.patient || \"—\""), "worklist shows the patient NAME from DICOM");
ck(ui.includes("id=\"viewer-name\""), "patient name bar rendered above the viewer image");
ck(src.includes("ARCHIVED PHYSICIAN-APPROVED REPORTS"), "AI draft consults the on-device archive for style/priors");
ck(ui.includes("tbody tr:nth-child(even) { background:#12233a; }"), "worklist restyled: zebra rows, rounded panel, soft palette");
ck(ui.includes("text-overflow:ellipsis;"), "triage note ellipsized for compact mobile rows");
ck(ui.includes("id=\"prior-line\""), "prior-studies banner above viewer");
ck(ui.includes("id=\"export-csv\"") && src.includes("text/csv"), "on-device CSV export of the worklist");
ck(ui.includes(".badge.signed"), "signed badge chip in worklist name cell");
ck((sws.match(/ignoreSearch: true/g) || []).length >= 3, "SW matches cache entries despite ?cb= cache-busters");
const lenKeys = sws.match(/"app\.v\d+\.js": \d+,/g) || [];
ck(lenKeys.length === 1 && lenKeys[0].indexOf("app." + build + ".js") === 1, "SW LEN table holds BYTE counts for the current build only");
ck(startHtml.includes("caches.match(u, { ignoreSearch: true })"), "boot falls back to SW cache when a fetch throws (offline)");
ck(src.includes("const allNow = await allStudies();") && !/const others = studies\.filter/.test(src), "prior-studies banner reads via allStudies() (no out-of-scope studies ref)");
ck(src.includes("const list = await allStudies();"), "CSV export reads via allStudies()");
ck(src.includes("} catch (e) { const plx = $(\"prior-line\"); if (plx) { plx.style.display = \"none\"; } }"), "prior-line block is fail-safe: viewer renders even if banner logic throws");
ck(src.includes("CSV export failed: "), "CSV handler reports errors instead of throwing");
ck(ui.includes("id=\"fu-months\"") && src.includes("d.setMonth(d.getMonth() + e.fuMonths)"), "follow-up plan stored per report + due-date math");
ck(ui.includes("id=\"stats-out\"") && src.includes("async function computeStats()"), "on-device stats dashboard");
ck(ui.includes("id=\"mic-imp\"") && src.includes("window.SpeechRecognition || window.webkitSpeechRecognition"), "voice dictation into impression field");
ck(ui.includes("id=\"a4-prev\"") && src.includes("function a4Html()"), "A4 preview + print window");
ck(ui.includes("id=\"retention-signed-days\"") && src.includes("rrai-retention-signed-days"), "separate retention for signed reports");
ck(src.includes("e.status === \"signed\" ? sdays : days"), "purge applies per-type retention");
ck(ui.includes("id=\"archive-backup\"") && src.includes("rrai-archive-backup"), "archive backup export + restore");
ck(src.includes("setupExtras();"), "extras wired at boot");
ck(ui.includes("id=\"purge-warn\"") && src.includes("async function updatePurgeWarn()"), "7-day pre-deletion warning banner with one-tap backup");
ck(src.includes("indexedDB.open(DB_NAME, 2)") && src.includes("createObjectStore(\"attach\""), "IDB v2 with attach store for screenshot links");
ck(src.includes("function attachPut(") && src.includes("attachPut(e.id, aiExtraImgs.slice(0, 2))"), "attached screenshots linked to archived report on save");
ck(src.includes("attachDel(e.id)") && src.includes("function attachDel("), "attach blobs cleaned on delete/purge");
ck((src.match(/rrai-org/g) || []).length >= 5 && src.includes("orgLine"), "saved letterhead appears on the A4 preview");
ck(src.includes("return { added: stored, skipped, dups, dupKeys, bad, badWhy, skipWhy };"), "duplicate uploads detected and skipped with count (stored frames only)");
ck(src.includes("rrai-urgent-seen"), "new urgent cases toast on worklist refresh");
ck(ui.includes("id=\"stats-csv\"") && src.includes("el.download = \"stats-\""), "stats dashboard exports CSV");
ck(src.includes('"export-csv": ["تصدير القائمة CSV", "Export worklist CSV"]') && src.includes('"compare-btn": ["مقارنة", "Compare"]'), "EN i18n covers worklist/viewer dynamic buttons");
ck(src.includes("const OPTS_L = {") && src.includes("Object.entries(OPTS_L)"), "select options (retention/follow-up) translate on toggle");
ck(src.includes("REASON_EN[r0]"), "triage reason line renders in EN");
ck(src.includes('"slice " + (idx + 1) + " of "'), "viewer meta line translates (slice/fit/size)");
ck(src.includes("Language set to English.") && src.includes("try { refresh(); } catch (e) {}"), "language toggle re-renders dynamic UI (worklist, archive, stats, viewer) and resets status");
ck(src.includes("try { if (current) openStudy(current); } catch (e) {}"), "prior-line + viewer meta re-render on toggle");
ck(ui.includes("id=\"files-btn\"") && ui.includes('<input id="files" type="file" multiple style="display:none;" />'), "native file picker replaced by translated custom button + label");
ck(src.includes("function fileLbl(") && src.includes('fileLbl("files", "files-lbl")'), "file label translates (No file chosen / n file(s) selected)");
ck(src.includes('"ai-provider": { "groq"') && src.includes('"compare-sel": { "seg"'), "provider + measure-mode option lists translate");
ck(src.includes('"empty": ["لا توجد دراسات') && src.includes('"rep-notes": ["مثال:'), "empty-worklist message + notes placeholder translate");
ck(ui.includes("id=\"drawer\"") && ui.includes("id=\"menu-btn\"") && ui.includes("id=\"settings-modal\""), "navigation drawer + settings modal present");
ck(ui.includes("id=\"data-mgmt\"") && src.includes('"data-mgmt-sum"'), "data buttons collapsed into a dropdown to save mobile space");
ck(src.includes("function critOnly(") && src.includes("function critBeep("), "critical-only filter + sound/vibration alert");
ck(src.includes("rrai-pacs-token") && src.includes("function pacsAuth("), "PACS bearer token stored locally and sent when set");
ck(src.includes("rrai-anon") && src.includes("ANON-"), "optional anonymization for exported consult packages");
ck(src.includes("navigator.storage.estimate") && ui.includes('[data-theme="light"]'), "storage usage readout + light theme");
ck(ui.includes("id=\"ai-extra\"") && ui.includes("id=\"ai-extra-count\""), "UI exposes the extra-screenshot input");
ck(ui.includes('id="zoom-reset" class="ghost">\u0645\u0644\u0627\u0621\u0645\u0629</button>'), "fit button labeled clearly (was cryptic 1:1)");
ck(ui.includes('id="zscale"'), "live zoom scale indicator present");
ck(ui.includes('id="fs-toggle"'), "fullscreen button present in viewer controls");
ck(/#viewer-card:fullscreen #viewport \{ position:absolute !important; inset:0 !important; width:100% !important; height:100% !important;[^}]*\}/.test(ui), "fullscreen viewport = whole screen, centered");
ck(ui.includes("#viewer-card:fullscreen.fs-hide .controls { opacity:0; pointer-events:none; }"), "controls auto-hide overlay in fullscreen");
ck(/\.fs-fake #viewport \{[^}]*align-items:center !important; justify-content:center !important;[^}]*\}/.test(ui), "fullscreen image centered both axes (iOS fallback path too)");
ck(src.includes('vst({ type: "setZoom", zoom: 2 })') && src.includes("vk = (vState && vState.zoom) || 2"), "v124: dblclick zoom tempered to x2, through the state");
ck(src.includes("const zs = $(\"zscale\")"), "applyView publishes live scale");
ck(!ui.includes("image-rendering:pixelated"), "nearest-neighbor shimmer removed from viewer");
ck(src.includes("cv.style.width = Math.round(f.w * fitK)"), "explicit fit width (no layout/scale mismatch crop)");
ck(ui.includes("transform-origin:center"), "center-origin user zoom (symmetric crop)");
ck(src.includes("const Ox = r.width / (2 * vk)"), "centroid anchor for center origin");
ck(src.includes("const s = (f0 && r.width / f0.w) || vk"), "measure math uses true display scale");
ck(src.includes('localStorage.getItem("rrai-sort")') && src.includes('sortMode === "date"') && src.includes('sortMode === "name"'), "v96: worklist default sort (urgent/date/name)");
ck(src.includes('localStorage.getItem("rrai-default-win")') && src.includes('$("preset").value = dw2'), "v96: default window/level applied on study open");
ck(src.includes("function applyOverlayPrefs") && src.includes('rrai-ov-name') && src.includes('rrai-ov-meta') && (src.match(/applyOverlayPrefs\(\);/g) || []).length >= 2, "v96: overlay show/hide prefs wired into draw path");
ck(src.includes("function measureColor") && src.includes("ctx.strokeStyle = measureColor()") && !src.includes('ctx.strokeStyle = "#38bdf8"') && src.includes('measureUnit() === "cm"'), "v96: measurement color + mm/cm unit prefs");
ck(src.includes("function perfSmooth") && src.includes("cx2.imageSmoothingEnabled = perfSmooth()"), "v96: image-smoothing performance toggle");
ck(src.includes('localStorage.getItem("rrai-gzip")') && src.includes("CompressionStream") && src.includes('fname + ".gz"') && src.includes("u8[1] === 0x8b") && src.includes("DecompressionStream"), "v96: gzip consult export + magic-byte import");
ck(src.includes('localStorage.getItem("rrai-auto-open")') && src.includes("function applyDefaultExport") && src.includes('rrai-default-export'), "v96: auto-open after upload + default export format swap");
ck(src.includes('localStorage.getItem("rrai-keys")') && src.includes('map.next || "ArrowRight"') && src.includes('el.value = ev.key'), "v96: customizable keyboard shortcuts with key recorder");
ck(["set-pacs","set-store","set-ui","set-view","set-work","set-keys","set-io","set-priv","set-about"].every((id) => ui.includes('id="' + id + '"')) && ["lang-sel","pacs-ae","pacs-port","default-win-sel","ov-name-chk","ov-meta-chk","measure-color","measure-unit","sort-sel","auto-open-chk","ks-next","ks-prev","ks-fit","ks-measure","default-export-sel","gzip-chk","set-retention-days","set-retention-signed","perf-smooth","rebuild-cache","clear-db","about-ver","about-conn","about-disclaimer","about-privacy","about-licenses","about-support"].every((id) => ui.includes('id="' + id + '"')), "v96: ten settings sections + all new controls present in UI");
ck(src.includes('map.zoomIn || "+"') && src.includes('vst({ type: "zoomBy", factor: 1.25 })') && src.includes("vk = (vState && vState.zoom) || vk") && src.includes("centerOn(f0.w / 2, f0.h / 2)"), "v124: zoom-in shortcut goes through the state and re-centres");
ck(src.includes('map.zoomOut || "-"') && src.includes('vst({ type: "zoomBy", factor: 1 / 1.25 })') && src.includes("vk = (vState && vState.zoom) || vk"), "v124: zoom-out shortcut goes through the state, clamped there");
ck(src.includes('map.contrast || "c"') && src.includes("ps.selectedIndex = (ps.selectedIndex + 1) % ps.options.length") && src.includes('["ks-zoom-in", "+"], ["ks-zoom-out", "-"], ["ks-contrast", "c"]') && ui.includes('id="ks-contrast"'), "v97: contrast cycling shortcut + 3 new key recorders");
ck(src.includes("function verNum") && src.includes("best > verNum(APP_BUILD)") && !src.includes("m[1] !== APP_BUILD"), "v98: numeric version gate — never prompts downgrades");
ck(src.includes("async function forceUpdateReload") && src.includes("reg.waiting.postMessage") && src.includes('$("update-banner")'), "v98: force-reload clears caches + wakes waiting SW");
const critBuilds = sws.match(/app\.v\d+\.js/g) || [];
ck(new RegExp("const CRITICAL = \\[[^\\]]*\"\\./app\\." + build + "\\.js\"[^\\]]*\\]").test(sws) && critBuilds.length > 0 && critBuilds.every((x) => x === "app." + build + ".js") && sws.includes('sw\\.js|sw\\.v\\d+\\.js|integrity'), "v98: CRITICAL list current-only + control files network-first");
const sth = await import("node:fs").then((fs) => fs.readFileSync(new URL("../start.html", import.meta.url), "utf-8"));
ck(sth.includes("cands.sort((x, y) => verL(y) - verL(x))") && sth.includes('fetch("./integrity." + b + ".json'), "v104: launcher tries newest build first + integrity-driven validation for unknown builds");
ck(src.includes("raw.githubusercontent.com/apple72214-beep/radiology-report-ai-web/main/release.json") && src.includes("best > verNum(APP_BUILD)") && src.includes("function showUpdateBanner"), "v104: triple-origin update probe takes highest version only");
ck(await import("node:fs").then((fs) => fs.readFileSync(new URL("../../docker/vercel.public.json", import.meta.url), "utf-8")).then((x) => x.includes('"/u9"')), "v104: fresh proxy-busting route /u9 wired in Vercel config");
/* MPR — three linked viewports (axial / coronal / sagittal) */
for (const id of ["mpr-bar", "mpr-toggle", "mpr-note", "mpr-grid", "mpr-c-axial", "mpr-c-coronal", "mpr-c-sagittal", "mpr-lab-axial", "mpr-lab-coronal", "mpr-lab-sagittal"]) {
  ck(ui.includes('id="' + id + '"'), "MPR: " + id + " present in the viewer UI");
}
ck(/\.mpr-grid\s*\{[^}]*grid-template-columns/.test(ui), "MPR: panes lay out on a responsive grid");
for (const fn of ["function mprVolume", "function mprRender", "function mprToggle", "function mprWire", "function mprSetIndex", "function mprSyncFromSlice", "function mprCross"]) {
  ck(src.includes(fn), "MPR viewer: " + fn + "() implemented in the app");
}
/* The MPR module used to be imported as ./mpr.v59.js — a file no build ever
   shipped, so the import 404'd and the panes silently stayed empty (v115). */
const mprPin = (src.match(/\["mpr", "\.\/mpr\.v(\d+)\.js"/) || [])[1] || "";
ck(mprPin === build.slice(1), "MPR is imported from the build this app ships (found v" + (mprPin || "?") + ")");
ck(src.includes('if (name === "mpr") { mprApi = null;'), "MPR module is loaded but never allowed to block the app");
ck(src.includes("mprApi.volumeFromFrames(frames") && src.includes("maxVoxels"), "MPR builds the volume lazily with a memory cap");
ck(!src.includes("volumeFromFrames(current.frames"), "MPR never mixes sequences: the volume comes from the selected series, not the whole study");
ck(src.includes("mprApi.pointToVolume") && src.includes("mprApi.volumeToPlanePixel"), "MPR click↔crosshair mapping is wired");
ck(src.includes('k === (map.next || "ArrowRight")) {\n        if (mprOn)'), "keyboard slice keys drive the focused MPR pane");
ck(sws.includes("./mpr." + build + ".js"), "MPR module is precached by the service worker");
/* self-healing when a stale service worker poisons the update */
ck(sth.includes("function nukeStaleWorker") || sth.includes("const nukeStaleWorker"), "launcher can evict a stale service worker");
ck(sth.includes("rrai-swnuke") && sth.includes("navigator.serviceWorker.controller"), "eviction runs once per session and only when a worker is in control");
ck(sth.includes("errLen.__bad") && sth.includes("healing()"), "a body that fails length validation triggers the eviction + reload");
ck(sws.includes("const trustedHit") && sws.includes("await trustedHit(hit0"), "service worker refuses cached bodies that do not match this build");
ck(sws.includes("if (okLen(pathname, buf.byteLength)) return hit;"), "cached entries are size-checked against the LEN table before use");

/* --- the readback must judge the whole image, not its corner (v122) --------
   A head CT paints air in the top-left corner. Reading only that corner, every
   sampled pixel was the same black, so the viewer announced "the image did not
   reach the screen" while the slice was on screen in front of the physician. */
{
  const W = 64, H = 64;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const x = p % W, y = (p / W) | 0;
    const g = (x > 48 && y > 48) ? 220 : 0;   /* detail only in the far corner */
    data[p * 4] = g; data[p * 4 + 1] = g; data[p * 4 + 2] = g; data[p * 4 + 3] = 255;
  }
  const cv = { width: W, height: H, getContext: () => ({ getImageData: () => ({ data }) }) };
  const rb = paintReadback(cv);
  ck(rb.ok === true, "readback runs on a painted canvas");
  ck(rb.spread >= 2, "readback sees detail outside the top-left corner (was: false 'uniform')");
}
{
  const W = 32, H = 32;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) { data[p * 4] = 7; data[p * 4 + 3] = 255; }
  const cv = { width: W, height: H, getContext: () => ({ getImageData: () => ({ data }) }) };
  const rb = paintReadback(cv);
  ck(rb.note === "uniform" && rb.spread === 0, "a genuinely flat frame is still called uniform");
}

/* --- v126 filmstrip: see the neighbours of the slice on screen ------------ */
{
  const w0 = filmWindow(0, 100, 15);
  eq(w0.from, 0, "at the first slice the window starts at the first slice");
  eq(w0.count, 15, "the window keeps the span it was given");
  const wm = filmWindow(50, 100, 15);
  eq(wm.from, 43, "the window sits around the slice on screen");
  eq(wm.to, 57, "and ends the same distance the other way");
  const wEnd = filmWindow(99, 100, 15);
  eq(wEnd.to, 99, "the last slice is reachable: the window ends there");
  eq(wEnd.from, 85, "the window slides back instead of running past the end");
  const wSmall = filmWindow(5, 3, 15);
  eq(wSmall.count, 3, "a short series shows all of its slices, no more");
  eq(wSmall.from, 0, "and starts at zero");
  eq(filmWindow(0, 1, 15).count, 0, "a single image has no filmstrip at all");
  eq(filmWindow(3, 0, 15).count, 0, "no frames, no filmstrip");
}
eq(filmDragSteps(0, 26), 0, "no drag, no movement");
eq(filmDragSteps(26, 26), 1, "one slice-width of drag advances one slice");
eq(filmDragSteps(51, 26), 1, "a drag shorter than two slices does not skip");
eq(filmDragSteps(52, 26), 2, "two slice-widths advance two slices");
eq(filmDragSteps(-26, 26), -1, "dragging back goes back");
eq(filmDragSteps(NaN, 26), 0, "a broken pointer reading moves nothing");
ck(app.includes("export function filmWindow(current, total, span)"), "the window is a pure function");
ck(app.includes("export function filmDragSteps(dx, pxPerSlice)"), "the drag is a pure function");
ck(app.includes("function renderFilmstrip()") && app.includes("function filmWire()"), "the strip renders and is wired for dragging");
ck(app.includes("filmThumbs.set(k, url)") && app.includes("if (filmThumbs.size > 400) filmThumbs.clear()"),
   "thumbnails are kept, and the cache is capped");
ck(app.includes("function filmFill(from, to)") && app.includes('if (filmThumbs.has(k)) continue;'),
   "only the slices on screen are decoded — never the whole study");
ck(app.includes("setTimeout(() => {"), "the thumbnails are built after the strip is on screen");
ck((app.match(/renderFilmstrip\(\);/g) || []).length >= 3, "the strip follows every frame and both hangings");
ck(ui.includes('id="filmstrip"') && ui.includes('id="film-wrap"'), "ui: the filmstrip");
ck(ui.includes("touch-action:pan-y"), "ui: the strip can be scrubbed sideways without the page scrolling");


/* --- v127 fullscreen: the picture keeps the screen ----------------------- */
eq(fitScaleFor(720, 1544, 512, 512), 720 / 512, "a square image on a tall screen is limited by the width");
eq(fitScaleFor(720, 400, 512, 512), 400 / 512, "a short space limits it by the height instead");
eq(fitScaleFor(720, 1544, 32, 32), 4, "a tiny image is never blown up past x4");
eq(fitScaleFor(36, 36, 512, 512), 0.25, "a huge image is never shrunk past 0.25");
eq(fitScaleFor(720, 400, 512, 1024), 400 / 1024, "a tall image in a short space is limited by the height");
ck(app.includes("function fsAvailHeight(vp, fallback)"), "fullscreen measures the space above the bars");
ck(app.includes("const avail = fsAvailHeight(vp, chh);") && app.includes("fitScaleFor(cw, avail, f.w, f.h)"), "and fits the picture to that space, not to the whole screen");
ck(app.includes('classList.toggle("fs-folded", !!on)'), "the settings rows fold away");
ck(app.includes('localStorage.getItem("rrai-fs-fold") !== "0"'), "folded is the default, so the picture starts with the screen");
ck(app.includes('fc.textContent = (idx + 1) + " / " + frames.length'), "the slim line carries the slice counter");
ck(ui.includes('id="fs-mini"') && ui.includes('id="fs-fold"') && ui.includes('id="fs-count"') && ui.includes('id="fs-exit"'),
   "ui: one line — settings, counter, exit");
ck(ui.includes(".fs-folded .controls"), "ui: folded hides the rows, it does not only dim them");
/* The defect this build fixes: #viewport carries an INLINE style="position:relative",
   which silently beat the ":fullscreen #viewport{position:absolute}" rule. The viewport
   stayed in the flow, the settings rows squeezed it to ~69 px and the fit collapsed to
   0.27 — a 69-pixel picture on a 720-pixel screen. */
ck(/id="viewport" style="[^"]*position:relative/.test(ui), "ui: the viewport still carries an inline position (why the rule below needs !important)");
ck(/#viewer-card:fullscreen #viewport \{ position:absolute !important; inset:0 !important;[^}]*display:flex !important;/.test(ui),
   "the fullscreen viewport rule wins over that inline style — absolute, full screen");
ck(/#viewer-card:fullscreen #viewport \{[^}]*box-sizing:border-box !important;/.test(ui),
   "and reserves the bars' strip as padding, so the picture centres in what is visible");
ck(/\.fs-fake #viewport \{[^}]*box-sizing:border-box !important;/.test(ui),
   "the iOS fallback (fs-fake) gets the same reserve");
ck(app.includes("function fsReserve(vp, avail)"), "the free band is reserved before the picture is centred");
ck(app.includes("fsReserve(vp, avail);") && app.includes("} else if (vp.style.paddingBottom) {"),
   "and the reserve is dropped again outside fullscreen");
ck(app.includes("try { fsReserve($(\"viewport\"), 0); } catch (e) {}"), "leaving fullscreen clears the reserve too");
/* The same inline-style trap, one layer up: the app writes
   $("viewer-name").style.display = "block", which beat the rule that hides the
   chrome in fullscreen — so the patient line sat over the picture. */
ck(app.includes('$("viewer-name").style.display = "block";'), "the app shows the patient line by an inline style");
ck(/#viewer-card:fullscreen h2, #viewer-card:fullscreen p, #viewer-card:fullscreen details \{ display:none !important; \}/.test(ui),
   "fullscreen hides the chrome (patient line included) — !important, so the inline style cannot win");
ck(/\.fs-fake h2, \.fs-fake p, \.fs-fake details \{ display:none !important; \}/.test(ui),
   "the iOS fallback path hides it too");

/* A label in the language table may WRAP a control. applyLang used to set
   textContent on every id in the table, which destroyed the control inside:
   <label id="lbl-win">النافذة: <select id="preset">… lost its select the moment
   the language was applied, so every image stayed on "auto" however the
   physician set the window. Found while building the compare panes. */
const langBlock = (app.match(/if \(el\.children\.length[\s\S]{0,260}/) || [""])[0];
ck(/nodeValue = txt/.test(langBlock) && /else el\.textContent = txt/.test(langBlock),
   "the language setter rewrites a label's text node when the label holds a control");
const winLbl = (ui.match(/<label id="lbl-win">[\s\S]{0,600}?<\/label>/) || [""])[0];
ck(winLbl.includes('id="preset"'), "the window/level select lives inside its label — the shape that used to be destroyed");
ck(app.includes('document.getElementById("preset")') && app.includes('const presetVal = () => val("preset", "auto")'),
   "and the viewer still reads the window it offers");

console.log(fails ? "VIEWER TEST FAIL " + fails : "VIEWER TEST PASS (" + checks + ")");
