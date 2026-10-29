/* Radiology report AI — browser-only worklist, triage and viewer. */
/* v34: dynamic module loading with per-module retry — flaky-network proof. */
let parseDicom, parseMultipartRelated, draftReport, buildSignedDocument, signedDocHash, decodeCompressed, triageCtx;
let buildPackage, validatePackage, downloadJson, buildDocxReport, buildDocxReportEn;
let mprApi = null;
let vstate = null;
let orientSize = null, orientPoint = null, unorientPoint = null;
let segMm, angleDeg, ellipseStats, rectStats, grayAt, cmpFrameStats, normalize01, diffStats, frameGrayFlat;
const MODULES = [
  ["dicom", "./dicom.v147.js", (m) => { parseDicom = m.parseDicom; parseMultipartRelated = m.parseMultipartRelated; }],
  ["report", "./report.v147.js", (m) => { draftReport = m.draftReport; buildSignedDocument = m.buildSignedDocument; signedDocHash = m.signedDocHash; }],
  ["decode", "./codecs/decode.v147.js", (m) => { decodeCompressed = m.decodeCompressed; }],
  ["triage", "./triage.v147.js", (m) => { triageCtx = m.triage; }],
  ["consult", "./consult.v147.js", (m) => { buildPackage = m.buildPackage; validatePackage = m.validatePackage; downloadJson = m.downloadJson; }],
  ["docx", "./docx.v147.js", (m) => { buildDocxReport = m.buildDocxReport; buildDocxReportEn = m.buildDocxReportEn; }],
  ["measure", "./measure.v147.js", (m) => { segMm = m.segMm; angleDeg = m.angleDeg; ellipseStats = m.ellipseStats; rectStats = m.rectStats; grayAt = m.grayAt; }],
  ["compare", "./compare.v147.js", (m) => { cmpFrameStats = m.frameStats; normalize01 = m.normalize01; diffStats = m.diffStats; frameGrayFlat = m.frameGrayFlat; }],
  ["mpr", "./mpr.v147.js", (m) => { mprApi = m; }],
  ["viewer-state", "./viewer-state.v147.js", (m) => { vstate = m; orientSize = m.orientSize; orientPoint = m.orientPoint; unorientPoint = m.unorientPoint; }],
];
async function loadMod(u) {
  let last = null;
  for (let i = 0; i < 4; i++) {
    try { return await import(u); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 500 + i * 500)); }
  }
  throw last || new Error("import failed: " + u);
}
async function loadAllModules() {
  for (const [name, url, assign] of MODULES) {
    stage("module:" + name);
    try {
      assign(await loadMod(url));
    } catch (e) {
      // MPR is a bonus: never let it block the rest of the app.
      if (name === "mpr") { mprApi = null; try { localStorage.setItem("rrai-mpr-unavailable", "1"); } catch (e2) {} }
      else throw e;
    }
  }
  stage("modules-done");
  vStateInit();
}

const APP_BUILD = "v147";

function verNum(v) { const n = parseInt(String(v).replace(/\D/g, ""), 10); return isNaN(n) ? 0 : n; }
async function forceUpdateReload() {
  try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (e) {}
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage("skipWaiting"); }
  } catch (e) {}
  location.reload();
}
function showUpdateBanner(rv) {
  /* Moving a device to the newest build is normally one reload. It broke once:
     the launcher held stale hashes for the current build, so every mirror
     "failed", the page fell back to an old build, that build saw a newer
     release.json and reloaded — forever. Cap the attempts per version, then
     hand over to the launcher, which re-verifies against integrity.<b>.json. */
  const b = $("update-banner");
  if (!b) return;
  let tries = 0;
  try { tries = parseInt(localStorage.getItem("rrai-rw-try-" + rv) || "0", 10) || 0; } catch (e) {}
  b.style.display = "block";
  /* v147 — the launcher is fetched from the network and verifies the build it is
     handed, so it is the one door a stale cache cannot hold shut. Offer it as a
     button from the first attempt, not only after the reloads have been given
     up on, and make the last attempt a deliberate hand-over. */
  const launchUrl = "./start.html?u=" + encodeURIComponent(rv);
  const launch = '<a href="' + launchUrl + '" style="color:var(--accent)">' + (LANG === "en" ? "open the launcher" : "افتح المُطلِق") + "</a>";
  if (tries >= 2) {
    b.innerHTML = (LANG === "en"
      ? "Still running " + APP_BUILD + " — the update to " + rv + " did not apply after " + tries + " reloads. "
      : "ما زلت تعمل على " + APP_BUILD + " — لم يُطبَّق التحديث إلى " + rv + " بعد " + tries + " إعادة تحميل. ") + launch + ".";
    /* a plain reload has failed twice: hand the device to the launcher once */
    setTimeout(() => { try { location.replace(launchUrl); } catch (e) {} }, 1500);
    return;
  }
  try { localStorage.setItem("rrai-rw-try-" + rv, String(tries + 1)); } catch (e) {}
  b.innerHTML = (LANG === "en"
    ? "Running " + APP_BUILD + " — update available (" + rv + "): loading it now… "
    : "تعمل الآن على " + APP_BUILD + " — تحديث متاح (" + rv + "): جارٍ تحميله الآن… ") + launch + ".";
  setTimeout(() => forceUpdateReload(), 800);
}
function checkUpdate() {
  const cb = "?cb=" + Date.now();
  const probes = [
    "https://raw.githubusercontent.com/apple72214-beep/radiology-report-ai-web/main/release.json" + cb,
    "https://cdn.jsdelivr.net/gh/apple72214-beep/radiology-report-ai-web@main/release.json" + cb,
    "./release.json" + cb
  ];
  Promise.allSettled(probes.map((u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))))
    .then((rs) => {
      let best = 0, bv = "";
      for (const r of rs) {
        if (r.status === "fulfilled" && r.value && r.value.build) {
          const n = verNum(r.value.build);
          if (n > best) { best = n; bv = r.value.build; }
        }
      }
      if (bv && best > verNum(APP_BUILD)) showUpdateBanner(bv);
      else { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf("rrai-rw-try-") === 0) localStorage.removeItem(k); } } catch (e) {} }
    })
    .catch(() => {});
}
function releaseWatch() {
  checkUpdate();
  setInterval(checkUpdate, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(); });
}

const DB_NAME = "rrai";
const STORE = "studies";
let db = null;
let current = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) {
      reject(new Error("IndexedDB غير متاح (وضع خاص أو تخزين محجوب)"));
      return;
    }
    let req;
    try { req = indexedDB.open(DB_NAME, 2); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "uid" });
      if (!d.objectStoreNames.contains("attach")) d.createObjectStore("attach", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let memStudies = new Map();
function tx(mode, fn) {
  if (!db) throw new Error("DB_NOT_READY");
  const t = db.transaction(STORE, mode);
  return fn(t.objectStore(STORE));
}

const ATTACH = "attach";
function attachPut(id, thumbs) {
  return new Promise((res) => {
    try {
      if (!db) { res(false); return; }
      const t = db.transaction(ATTACH, "readwrite");
      t.objectStore(ATTACH).put({ id, thumbs });
      t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false);
    } catch (e) { res(false); }
  });
}
function attachGet(id) {
  return new Promise((res) => {
    try {
      if (!db) { res([]); return; }
      const t = db.transaction(ATTACH, "readonly");
      const rq = t.objectStore(ATTACH).get(id);
      rq.onsuccess = () => res((rq.result && rq.result.thumbs) || []);
      rq.onerror = () => res([]);
    } catch (e) { res([]); }
  });
}
function attachDel(id) {
  return new Promise((res) => {
    try {
      if (!db) { res(false); return; }
      const t = db.transaction(ATTACH, "readwrite");
      t.objectStore(ATTACH).delete(id);
      t.oncomplete = () => res(true); t.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
function allStudies() {
  if (!db) return Promise.resolve([...memStudies.values()]);
  return new Promise((resolve) => {
    try {
      const req = tx("readonly", (s) => s.getAll());
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([...memStudies.values()]);
    } catch (e) { resolve([...memStudies.values()]); }
  });
}

function putStudy(study) {
  if (!db) { memStudies.set(study.uid, study); return Promise.resolve(); }
  return new Promise((resolve) => {
    try {
      const req = tx("readwrite", (s) => s.put(study));
      req.onsuccess = resolve;
      req.onerror = resolve;
    } catch (e) { memStudies.set(study.uid, study); resolve(); }
  });
}

/* ---- triage (same heuristic as backend/triage.py) ---- */
function normalize(pixels) {
  const d = pixels.data;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < d.length; i++) {
    if (d[i] < min) min = d[i];
    if (d[i] > max) max = d[i];
  }
  const out = new Float64Array(d.length);
  const span = max - min || 1;
  for (let i = 0; i < d.length; i++) out[i] = (d[i] - min) / span;
  return { arr: out, w: pixels.w, h: pixels.h };
}

export function triage(pixels) {
  if (!pixels || pixels.kind !== "gray") return { score: 0, priority: "routine", engine: "heuristic-v1-js" };
  const { arr, w, h } = normalize(pixels);
  const r0 = Math.floor(h * 0.25), r1 = Math.floor(h * 0.8);
  const l0 = Math.floor(w * 0.18), l1 = Math.floor(w * 0.45);
  const g0 = Math.floor(w * 0.55), g1 = Math.floor(w * 0.82);
  let sl = 0, nl = 0, sr = 0, nr = 0, sm = 0, nm = 0;
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < w; x++) {
      const v = arr[y * w + x];
      sm += v; nm++;
      if (x >= l0 && x < l1) { sl += v; nl++; }
      if (x >= g0 && x < g1) { sr += v; nr++; }
    }
  }
  const mL = sl / (nl || 1), mR = sr / (nr || 1), mean = sm / (nm || 1);
  const score = Math.abs(mL - mR) / (mean + 1e-9);
  return {
    score: Math.round(score * 10000) / 10000,
    priority: score >= 0.015 ? "urgent" : "routine",
    engine: "heuristic-v1-js",
  };
}

/* ---- synthetic demo (mirrors backend/dicom_utils.py) ---- */
function synthFrame(index, lesion) {
  const w = 256, h = 256;
  const data = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1800 - 900 * (((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2);
      v -= 600 * Math.exp(-(((x - w * 0.35) ** 2) / 1800 + ((y - h / 2) ** 2) / 3200));
      v -= 600 * Math.exp(-(((x - w * 0.65) ** 2) / 1800 + ((y - h / 2) ** 2) / 3200));
      if (lesion) {
        v += 350 * Math.exp(-(((x - w * 0.62) ** 2) / 260 + ((y - h * 0.42) ** 2) / 260));
      }
      v += (Math.random() - 0.5) * 48;
      data[y * w + x] = Math.max(0, Math.min(4095, v));
    }
  }
  return { kind: "gray", w, h, data };
}

export async function seedDemo() {
  const mk = async (uid, patient, lesion, count) => {
    const frames = [];
    for (let i = 0; i < count; i++) frames.push(synthFrame(i, lesion));
    const study = {
      uid, patient, modality: "CR",
      description: "Synthetic chest demo",
      frames, triage: triageCtx(frames[0], { bodyPart: "CHEST", description: "Synthetic chest demo" }), created: Date.now(),
    };
    await putStudy(study);
  };
  await mk("demo-urgent-" + Date.now(), "DEMO-0001", true, 6);
  await mk("demo-routine-" + Date.now(), "DEMO-0002", false, 4);
  await refresh();
}

function txDel(uid) {
  return new Promise((resolve) => {
    const req = tx("readwrite", (s) => s.delete(uid));
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

function txClear() {
  return new Promise((resolve) => {
    const req = tx("readwrite", (s) => s.clear());
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

/* ---- zip containers: extract DICOM members inside the browser ---- */
function hasDicmMagic(bytes) {
  return bytes.byteLength > 132 && bytes[128] === 0x44 && bytes[129] === 0x49 &&
    bytes[130] === 0x43 && bytes[131] === 0x4d;
}

async function inflateRaw(raw) {
  if (typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).arrayBuffer();
}

export async function unzipDicom(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 65558; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = Math.min(dv.getUint16(eocd + 10, true), 300);
  let ptr = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.byteLength || dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const csize = dv.getUint32(ptr + 20, true);
    const loff = dv.getUint32(ptr + 42, true);
    const nlen = dv.getUint16(ptr + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, ptr + 46, nlen));
    ptr += 46 + nlen + dv.getUint16(ptr + 30, true) + dv.getUint16(ptr + 32, true);
    const byName = /\.(dcm|dicom)$/i.test(name);
    const lnlen = dv.getUint16(loff + 26, true);
    const lextra = dv.getUint16(loff + 28, true);
    const start = loff + 30 + lnlen + lextra;
    if (start + csize > buf.byteLength) continue;
    const raw = new Uint8Array(buf, start, csize);
    let bytes = null;
    if (method === 0) {
      if (!byName && !hasDicmMagic(raw)) continue;
      bytes = raw.slice().buffer;
    } else if (method === 8) {
      bytes = await inflateRaw(raw);
      if (!bytes) continue;
    } else continue;
    const u8 = new Uint8Array(bytes);
    if (!byName && !hasDicmMagic(u8)) continue;
    out.push({ name, bytes });
  }
  return out;
}

async function buffersFromFile(file) {
  const buf = await file.arrayBuffer();
  const mg = new Uint8Array(buf.slice(0, 4));
  const isZip = (file.name || "").toLowerCase().endsWith(".zip") || (mg[0] === 0x50 && mg[1] === 0x4b && mg[2] === 0x03 && mg[3] === 0x04);
  if (isZip) return { entries: await unzipDicom(buf), isZip: true };
  return { entries: [{ name: file.name, bytes: buf }], isZip: false };
}

/* ---- ingest uploaded files ---- */
/** Two studies are the same import when patient, date, modality and frame count match. */
export function studyKeyOf(st) {
  return [((st && st.meta ? st.meta : {}) || {}).patientName || "", ((st && st.meta ? st.meta : {}) || {}).studyDate || "",
    (st && st.modality) || "", ((st && st.frames) || []).length].join("|");
}
/* Last import, kept as plain text: a physician can paste it into a message and we
   can read it — no screenshot, no console, no guessing. */
let lastImport = null;
export function importReportText() {
  if (!lastImport || !lastImport.lines.length) {
    return LANG === "en" ? "No import attempt has been recorded on this device yet." : "لم يُسجَّل أي استيراد على هذا الجهاز بعد.";
  }
  const head = (LANG === "en" ? "Import report — " : "تقرير الاستيراد — ")
    + new Date(lastImport.at).toLocaleString() + (LANG === "en" ? " — build " : " — الإصدار ") + APP_BUILD + "\n";
  return head + lastImport.lines.join("\n");
}
export function hasImportReport() { return !!(lastImport && lastImport.lines.length); }
const hex4 = (u8) => { let o = ""; for (let i = 0; i < Math.min(4, u8.length); i++) o += ("0" + u8[i].toString(16)).slice(-2); return o; };

export async function ingestFiles(fileList) {
  const groups = new Map();
  let skipped = 0, bad = 0;
  const badWhy = {};
  /* A refusal must name its reason: "corrupt files" sent a physician looking for
     corruption when the study was simply already on the device. */
  const skipWhy = {};
  const bumpSkip = (k) => { skipWhy[k] = (skipWhy[k] || 0) + 1; };
  const lines = [];
  const say = (t) => { if (lines.length < 80) lines.push(t); };
  for (const file of fileList) {
    let bz = null;
    try {
      bz = await buffersFromFile(file);
    } catch (e) {
      skipped++; bumpSkip("unreadable");
      say("file " + (file.name || "?") + " read-error: " + ((e && e.message) || e));
      continue;
    }
    const entries = bz.entries;
    let mg = "";
    try { const ab = await file.arrayBuffer(); mg = hex4(new Uint8Array(ab.slice(0, 4))); } catch (e) {}
    say("file " + (file.name || "?") + " bytes=" + (file.size || 0) + " magic=" + (mg || "?") +
      (bz.isZip ? " zip entries=" + entries.length : " single"));
    if (bz.isZip && entries.length === 0) { skipped++; bumpSkip("emptyzip"); say("  -> empty archive"); continue; }
    for (const entry of entries) {
      let parsed;
      try {
        parsed = parseDicom(entry.bytes);
      } catch (e) {
        console.warn("skip", entry.name, e);
        skipped++;
        bumpSkip("notdicom");
        say("  " + entry.name + " bytes=" + ((entry.bytes && (entry.bytes.byteLength || entry.bytes.length)) || 0) +
          " dicm=" + (hasDicmMagic(new Uint8Array(entry.bytes || new ArrayBuffer(0))) ? "yes" : "no") +
          " parse-error: " + ((e && e.message) || e));
        continue;
      }
      let px = parsed.pixels;
      if (!px && parsed.compressed) {
        try {
          px = await decodeCompressed(parsed.compressed, parsed);
          if (px && px.data && px.data.buffer) { try { px.data = px.data.slice(); } catch (e) {} }
        } catch (e) {
          console.warn("decode fail", entry.name, e);
          skipped++;
          bumpSkip("decode:" + String((parsed.compressed && parsed.compressed.tsuid) || "?"));
          say("  " + entry.name + " ts=" + String((parsed.compressed && parsed.compressed.tsuid) || "?") +
            " decode-error: " + ((e && e.message) || e));
          continue;
        }
      }
      if (!px) { skipped++; bumpSkip("nopixels"); say("  " + entry.name + " no-pixel-element"); continue; }
      if (pixelProblem(px)) {
        bad++; badWhy[pixelProblem(px)] = (badWhy[pixelProblem(px)] || 0) + 1;
        say("  " + entry.name + " pixel-problem=" + pixelProblem(px) + " len=" + ((px.data && px.data.length) || 0) +
          " need=" + (((px.info && px.info.need) || (px.w * px.h)) || 0));
        continue;
      }
      say("  " + entry.name + " ok " + px.w + "x" + px.h + " ts=" + ((px.info && px.info.tsuid) || "?") +
        " len=" + ((px.data && px.data.length) || 0) +
        " bytes=" + ((px.info && px.info.haveBytes) || "?") + "/" + ((px.info && px.info.bytes) || "?") +
        ((px.info && px.info.depthFit)
          ? " depth-fit=" + px.info.depthFit + " declared=" + px.info.declaredBits + "bit"
          : ""));
      try {
        px.spacing = (parsed.pixels && parsed.pixels.spacing) || px.spacing || null;
        px.geometry = parsed.geometry || null;
        px.seq = parsed.seq || null;
        px.seriesUid = parsed.seriesUid || (parsed.seq && parsed.seq.seriesUid) || "";
      } catch (e) {}
      if (!groups.has(parsed.studyUid)) {
        groups.set(parsed.studyUid, {
          uid: parsed.studyUid,
          patient: parsed.patientId,
          modality: parsed.modality,
          description: parsed.description,
          bodyPart: parsed.bodyPart || "",
          meta: {
            patientName: parsed.patientName || "", sex: parsed.sex || "", age: parsed.age || "",
            studyDate: parsed.studyDate || "", studyTime: parsed.studyTime || "", studyDesc: parsed.studyDesc || "", bodyPart: parsed.bodyPart || "",
          },
          frames: [],
          created: Date.now(),
          compressedSrc: parsed.compressed || null,
        });
      }
      groups.get(parsed.studyUid).frames.push(px);
    }
  }
  let stored = 0;
  let seenKeys = new Set();
  try { seenKeys = new Set((await allStudies()).map(studyKeyOf)); } catch (e2) {}
  let dups = 0;
  const dupKeys = [];
  for (const study of groups.values()) {
    const k = studyKeyOf(study);
    if (seenKeys.has(k)) { dups++; dupKeys.push(k); say("duplicate of a study already on this device: " + k); continue; }
    seenKeys.add(k);
    let badFrames = 0;
    for (const fr of study.frames || []) if (pixelProblem(fr)) badFrames++;
    study.pixelBad = badFrames;   /* files that carried no drawable pixels */
    study.frames = (study.frames || []).filter((f) => !pixelProblem(f));
    if (!study.frames.length) { bad++; say("study " + k + " -> no drawable frame"); continue; }
    say("study " + k + " -> stored, frames=" + study.frames.length);
    study.triage = triageCtx(study.frames[0], study);
    study.series = groupSeries(study.frames, study.modality);
    await putStudy(study);
    stored++;
  }
  await refresh();
  lastImport = { lines: lines, at: Date.now() };
  return { added: stored, skipped, dups, dupKeys, bad, badWhy, skipWhy };
}

/* After a refused import the physician needs evidence we can read: one tap copies
   (and shows) exactly what the device saw, file by file. */
function showImportReport() {
  const btn = $("import-report-btn");
  if (btn) {
    btn.style.display = "inline-block";
    if (!btn.__wired) {
      btn.__wired = 1;
      btn.addEventListener("click", () => {
        const t = importReportText();
        const pre = $("import-report");
        if (pre) { pre.style.display = "block"; pre.textContent = t; }
        let copied = false;
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); copied = true; } } catch (e) {}
        if (!copied) {
          try {
            const ta = document.createElement("textarea");
            ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select(); copied = document.execCommand("copy"); ta.remove();
          } catch (e2) {}
        }
        setStatus(copied
          ? (LANG === "en" ? "Import report copied — paste it into your message." : "نُسخ تقرير الاستيراد — الصقه في رسالتك.")
          : (LANG === "en" ? "Import report shown below — long-press it to copy." : "تقرير الاستيراد معروض أسفله — اضغط مطولًا لنسخه."), false);
      });
    }
  }
}
/** An all-duplicates import is not a failure: open the study that is already here. */
async function openDuplicateIfAny(r) {
  if (!r || !r.dups || r.added) return null;
  try {
    const all2 = await allStudies();
    const keys = r.dupKeys || [];
    const match = all2.find((st) => keys.indexOf(studyKeyOf(st)) >= 0) || null;
    /* v147 — openStudy() needs the study itself, not its UID. Handing it the
       string threw "Cannot create property 'series' on string '<uid>'" inside
       ensureSeries(): the import reported success and the viewer stayed empty,
       every time a study already on the device was imported again. */
    if (match) { await openStudy(match); return match; }
  } catch (e) {}
  return null;
}

/* Why nothing was stored, named in words — never the old bare "corrupt files". */
export function ingestRefusal(r, lang) {
  const en = lang === "en";
  const w = (r && r.skipWhy) || {};
  const out = [];
  if (r && r.dups) out.push(en ? r.dups + (r.dups === 1 ? " duplicate study is" : " duplicate studies are") + " already on this device"
                               : r.dups + (r.dups === 1 ? " دراسة مكررة موجودة" : " دراسة مكررة موجودة") + " مسبقًا على هذا الجهاز");
  if (w.notdicom) out.push(en ? w.notdicom + " file(s) are not readable DICOM" : w.notdicom + " ملفًا غير مقروءة كملفات DICOM");
  if (w.emptyzip) out.push(en ? w.emptyzip + " archive(s) held no DICOM file" : w.emptyzip + " أرشيفًا بلا أي ملف DICOM بداخله");
  if (w.nopixels) out.push(en ? w.nopixels + " file(s) carry no pixel data element" : w.nopixels + " ملفًا بلا عنصر بيانات بكسل");
  const dec = Object.keys(w).filter((k) => k.indexOf("decode:") === 0);
  if (dec.length) {
    const n = dec.reduce((a, k) => a + w[k], 0);
    out.push((en ? n + " compressed file(s) the decoder could not unpack (" : n + " ملفًا مضغوطًا تعذّر فكّه (")
      + dec.map((k) => k.slice(7)).join(", ") + ")");
  }
  for (const k of Object.keys(w)) {
    if (k === "notdicom" || k === "nopixels" || k === "emptyzip" || k.indexOf("decode:") === 0) continue;
    out.push(w[k] + " " + k);
  }
  if (r && r.bad) out.push(en ? r.bad + " file(s) whose pixels are empty, truncated or uniform"
                              : r.bad + " ملفًا بيانات بكسلها فارغة أو ناقصة أو متطابقة");
  return out;
}

/* ---- safe DOM reads: a missing control must never break rendering ---- */
const val = (id, fallback) => { const el = $(id); return el && el.value !== undefined ? el.value : fallback; };
const presetVal = () => dualOn && dualActive===2 ? primaryPreset : val("preset", "auto");
const sliceIdx = () => { const n = Number(val("slice", 0)); return isFinite(n) ? n : 0; };

/* ---- series grouping: an MRI study is several sequences, never one stack ---- */
export function groupSeries(frames, modality) {
  const out = new Map();
  (frames || []).forEach((f, i) => {
    if (!f) return;
    const sq = f.seq || {};
    const uid = String(f.seriesUid || sq.seriesUid || "").trim();
    const num = sq.seriesNumber || 0;
    const desc = String(sq.seriesDescription || "").trim();
    const key = uid ? "u:" + uid
      : "n:" + num + "|" + desc + "|" + (f.w || 0) + "x" + (f.h || 0) + "|" + String(sq.te || 0) + "/" + String(sq.tr || 0);
    if (!out.has(key)) out.set(key, { key, uid, number: num, description: desc, indices: [], w: f.w || 0, h: f.h || 0, seq: sq });
    out.get(key).indices.push(i);
  });
  const list = Array.from(out.values());
  for (const s of list) {
    const l = seqLabelOf(s.seq, modality);
    s.label = l.label || "";
    s.derived = !!l.derived;
  }
  list.sort((a, b) => (a.number || 9999) - (b.number || 9999) || a.indices[0] - b.indices[0]);
  return list;
}
export function seriesSummary(study, max) {
  const ss = (study && study.series) || groupSeries(study && study.frames, study && study.modality);
  if (!ss || ss.length < 2) return "";
  const names = [];
  for (const s of ss) {
    const nm = s.label ? (s.derived ? s.label + " ~" : s.label) : (s.description || ("Se " + (s.number || "?")));
    if (names.indexOf(nm) < 0) names.push(nm);
  }
  const cap = max || 4;
  return names.length > cap ? names.slice(0, cap).join(" • ") + " +" + (names.length - cap) : names.join(" • ");
}
function ensureSeries(study) {
  /* v147 — a UID string once reached this function and threw while building the
     worklist row, taking the whole render with it. Refuse quietly instead. */
  if (!study || typeof study !== "object") return [];
  if (!study.series || !study.series.length) {
    study.series = groupSeries(study.frames, study.modality);
    try { putStudy(study); } catch (e) {}
  }
  return study.series;
}
let currentSeries = 0;
/* Studies imported before this build kept a frame whose pixel data was short:
   enough bytes for one byte per pixel, read as 16-bit, which left the second
   half of the image undefined — the silent black rectangle. The bytes were
   never lost, only misread, so re-read them at the depth they really have. */
export function fixStoredDepth(px) {
  if (!px || !px.data || !px.w || !px.h) return null;
  const need = px.w * px.h;
  const d = px.data;
  if (d.length >= need) return null;
  const isShort = d instanceof Uint16Array || d instanceof Int16Array;
  if (!isShort) return null;                    /* floats: the bytes are gone */
  if (d.length * 2 < need) return null;         /* not even one byte per pixel */
  const u8 = new Uint8Array(d.buffer, d.byteOffset, need);
  const info = px.info || {};
  let data = new Uint8Array(u8);
  if (info.slope != null && (info.slope !== 1 || info.intercept !== 0)) {
    const f = new Float32Array(need);
    for (let i = 0; i < need; i++) f[i] = u8[i] * info.slope + info.intercept;
    data = f;
  }
  return Object.assign({}, px, {
    data: data,
    info: Object.assign({}, info, {
      depthFit: "8bit", declaredBits: info.bitsAllocated || 16,
      have: need, need: need, rowsShown: px.h, recovered: true,
    }),
  });
}
/* Repair a whole study in place; returns how many frames were recovered. */
function coerceFrames(study) {
  let n = 0;
  if (!study || !study.frames) return 0;
  for (let i = 0; i < study.frames.length; i++) {
    const fx = fixStoredDepth(study.frames[i]);
    if (fx) { study.frames[i] = fx; n++; }
  }
  return n;
}
function activeFrames() {
  if (!current) return [];
  const ss = ensureSeries(current);
  if (!ss.length) return current.frames;
  if (ss.length === 1) return current.frames;
  const s = ss[Math.min(currentSeries, ss.length - 1)] || ss[0];
  return s.indices.map((i) => current.frames[i]).filter(Boolean);
}
/* ---- filmstrip (v147) ----------------------------------------------------
   Scrolling a stack by dragging a slider is blind: you cannot see where you
   are going. The filmstrip shows the slices either side of the current one and
   can be scrubbed with a finger. It never builds a thumbnail for the whole
   study — only for the few slices on screen — so a thousand-slice CT costs the
   same as a twenty-slice MR. The two functions below are pure so the window
   and the drag can be tested without a browser. */

/** Which slices to show: a window around the current one, clamped at both ends. */
export function filmWindow(current, total, span) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  if (t < 2) return { from: 0, to: 0, count: 0 };
  const n = Math.max(3, Math.min(t, Math.floor(Number(span) || 15)));
  const half = Math.floor((n - 1) / 2);
  const from = Math.max(0, Math.min(t - n, Math.floor(Number(current) || 0) - half));
  return { from: from, to: from + n - 1, count: n };
}

/** How many slices a horizontal drag of `dx` pixels is worth. */
export function filmDragSteps(dx, pxPerSlice) {
  const per = Number(pxPerSlice) || 26;
  const d = Number(dx) || 0;
  if (!isFinite(d)) return 0;
  return Math.trunc(d / per);
}

const filmThumbs = new Map();
function filmKeyOf(i) {
  const st = current || {};
  const ss = ensureSeries(st);
  const cnt = ss.length ? ((ss[Math.min(currentSeries, ss.length - 1)] || {}).indices || []).length : (st.frames || []).length;
  return [(st.uid || ""), currentSeries, cnt, i].join("|");
}
function filmThumbAt(i) {
  const frames = activeFrames();
  const f = frames[i];
  if (!f || !f.w || !f.h || !current) return "";
  const k = filmKeyOf(i);
  if (filmThumbs.has(k)) return filmThumbs.get(k);
  let url = "";
  try {
    const tmp = document.createElement("canvas");
    drawFrame(tmp, f, presetVal(), current.modality);
    const T = 64;
    const out = document.createElement("canvas");
    out.width = T; out.height = T;
    const cx = out.getContext("2d");
    cx.fillStyle = "#000";
    cx.fillRect(0, 0, T, T);
    const k2 = Math.max(T / (f.w || 1), T / (f.h || 1));
    const dw = (f.w || 1) * k2, dh = (f.h || 1) * k2;
    cx.drawImage(tmp, (T - dw) / 2, (T - dh) / 2, dw, dh);
    url = out.toDataURL("image/jpeg", 0.7);
  } catch (e) { url = ""; }
  if (filmThumbs.size > 400) filmThumbs.clear();
  filmThumbs.set(k, url);
  return url;
}
/** The thumbnails are built after the strip is on screen, one at a time. */
function filmFill(from, to) {
  const strip = $("filmstrip");
  if (!strip) return;
  for (let i = from; i <= to; i++) {
    const k = filmKeyOf(i);
    if (filmThumbs.has(k)) continue;
    const cell = strip.children[i - from];
    if (!cell) continue;
    setTimeout(() => {
      const u = filmThumbAt(i);
      const img = cell.querySelector("img");
      if (u && img && !img.getAttribute("src")) img.src = u;
    }, 0);
  }
}
function filmSpan() {
  const w = window.innerWidth || 720;
  return Math.max(7, Math.min(21, Math.round(w / 62) + 4));
}
function renderFilmstrip() {
  const wrap = $("film-wrap"), strip = $("filmstrip");
  if (!wrap || !strip || !current) return;
  const frames = activeFrames();
  const single = $("viewport") && $("viewport").style.display !== "none";
  if (frames.length < 2 || mprOn || allOn || !single) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  const idx = Math.max(0, Math.min(frames.length - 1, sliceIdx()));
  const w = filmWindow(idx, frames.length, filmSpan());
  if (!w.count) { wrap.style.display = "none"; return; }
  const key = [w.from, w.to, idx, filmKeyOf(0)].join("|");
  if (strip.__key === key) return;
  strip.__key = key;
  strip.innerHTML = "";
  for (let i = w.from; i <= w.to; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "film-cell" + (i === idx ? " on" : "");
    if (i === idx) cell.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.className = "film-img";
    img.alt = "";
    const known = filmThumbs.get(filmKeyOf(i));
    if (known) img.src = known;
    const num = document.createElement("span");
    num.className = "film-num";
    num.textContent = String(i + 1);
    cell.appendChild(img);
    cell.appendChild(num);
    cell.onclick = () => { const sl = $("slice"); if (sl) sl.value = String(i); show(i); };
    strip.appendChild(cell);
  }
  const onCell = strip.children[idx - w.from];
  if (onCell && strip.scrollWidth > strip.clientWidth + 4) {
    const target = onCell.offsetLeft - (strip.clientWidth - onCell.offsetWidth) / 2;
    strip.scrollLeft = Math.max(0, target);
  }
  filmFill(w.from, w.to);
}
function filmWire() {
  const strip = $("filmstrip");
  if (!strip || strip.__fw) return;
  strip.__fw = 1;
  let dragging = false, x0 = 0, i0 = 0, acc = 0;
  strip.addEventListener("pointerdown", (e) => {
    dragging = true; x0 = e.clientX; i0 = sliceIdx(); acc = 0;
    try { strip.setPointerCapture(e.pointerId); } catch (e2) {}
  });
  strip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const steps = filmDragSteps(e.clientX - x0, 26);
    if (steps === acc) return;
    acc = steps;
    const t = activeFrames().length;
    const i = Math.max(0, Math.min(t - 1, i0 + steps));
    const sl = $("slice");
    if (sl) sl.value = String(i);
    show(i);
  });
  const end = () => { dragging = false; acc = 0; };
  strip.addEventListener("pointerup", end);
  strip.addEventListener("pointercancel", end);
  strip.addEventListener("pointerleave", end);
}

/* ---- series navigator (v147) ---------------------------------------------
   A study is several sequences and the physician has to know which is which
   before opening one. "T1 (3)" is not enough: it does not say the plane, the
   slice thickness or the matrix, so a scout and an acquisition look alike in
   the list. These functions build that description, and the sheet below shows
   it with a picture of each series. */
const ORIENT = { axial: ["\u0645\u062d\u0648\u0631\u064a", "Axial"], coronal: ["\u0625\u0643\u0644\u064a\u0644\u064a", "Coronal"], sagittal: ["\u0633\u0647\u0645\u064a", "Sagittal"] };

/** The plane a slice was acquired in, from ImageOrientationPatient. Pure. */
export function orientationFromIop(iop) {
  if (!iop || iop.length < 6) return "";
  const a = [Number(iop[0]) || 0, Number(iop[1]) || 0, Number(iop[2]) || 0];
  const b = [Number(iop[3]) || 0, Number(iop[4]) || 0, Number(iop[5]) || 0];
  const n = [
    Math.abs(a[1] * b[2] - a[2] * b[1]),
    Math.abs(a[2] * b[0] - a[0] * b[2]),
    Math.abs(a[0] * b[1] - a[1] * b[0]),
  ];
  const m = Math.max(n[0], n[1], n[2]);
  if (!m) return "";
  if (n[2] === m) return "axial";
  if (n[1] === m) return "coronal";
  return "sagittal";
}

/** One row per series with everything the list must be able to say. */
export function seriesRows(study) {
  const ss = ensureSeries(study);
  if (!ss || !ss.length) return [];
  const frames = (study && study.frames) || [];
  return ss.map((s, i) => {
    const list = s.indices || [];
    const at = list[Math.floor((list.length - 1) / 2)];
    const f = frames[at] || null;
    const geo = (f && f.geometry) || {};
    const sp = (f && f.spacing) || null;
    const orient = orientationFromIop(geo.iop);
    const mm = Math.round(((geo.sliceThickness || geo.spacingBetweenSlices || 0) || 0) * 100) / 100;
    return {
      index: i,
      label: s.label || "",
      derived: !!s.derived,
      description: s.description || "",
      number: s.number || 0,
      orient: orient,
      mm: mm,
      w: (f && f.w) || s.w || 0,
      h: (f && f.h) || s.h || 0,
      px: sp ? (Math.round((Number(sp[0]) || 0) * 100) / 100) : 0,
      count: list.length,
    };
  });
}

/** "T1 Sagittal · 256×256 · 3 mm · 19" — never just "T1 (3)". */
export function seriesRowText(r, en, chip) {
  const ro = r || {};
  const name = [ro.label ? (ro.derived ? ro.label + " ~" : ro.label) : (ro.description || "Se " + (ro.number || (ro.index || 0) + 1)),
                (ORIENT[ro.orient] || null) ? ORIENT[ro.orient][en ? 1 : 0] : ""].filter(Boolean).join(" ");
  const parts = [name];
  if (!chip && ro.w && ro.h) parts.push(ro.w + "\u00d7" + ro.h);
  if (ro.mm) parts.push(ro.mm + " mm");
  parts.push(String(ro.count || 0));
  return parts.join(" \u00b7 ");
}

/* Thumbnails are made once per series and kept as small JPEGs: rebuilding them
   on every tap costs a full decode of the middle slice each time. */
const seriesThumbs = new Map();
function seriesThumb(study, i) {
  const ss = ensureSeries(study);
  const sRow = ss[i];
  if (!sRow) return "";
  const list = sRow.indices || [];
  if (!list.length) return "";
  const key = [(study && study.uid) || "", sRow.key || i, list.length].join("|");
  if (seriesThumbs.has(key)) return seriesThumbs.get(key);
  let url = "";
  try {
    const at = list[Math.floor((list.length - 1) / 2)];
    const f = ((study && study.frames) || [])[at];
    if (f && f.w && f.h) {
      const tmp = document.createElement("canvas");
      drawFrame(tmp, f, presetVal(), study.modality);
      const T = 72;
      const out = document.createElement("canvas");
      out.width = T; out.height = T;
      const cx = out.getContext("2d");
      cx.fillStyle = "#000";
      cx.fillRect(0, 0, T, T);
      const k = Math.max(T / (f.w || 1), T / (f.h || 1));
      const dw = (f.w || 1) * k, dh = (f.h || 1) * k;
      cx.drawImage(tmp, (T - dw) / 2, (T - dh) / 2, dw, dh);
      url = out.toDataURL("image/jpeg", 0.72);
    }
  } catch (e) { url = ""; }
  if (seriesThumbs.size > 60) seriesThumbs.clear();
  seriesThumbs.set(key, url);
  return url;
}

function renderSeriesSheet() {
  const list = $("series-list");
  if (!list || !current) return;
  const rows = seriesRows(current);
  list.innerHTML = "";
  rows.forEach((r) => {
    const on = r.index === currentSeries;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sheet-row" + (on ? " on" : "");
    if (on) row.setAttribute("aria-current", "true");
    const th = document.createElement("img");
    th.className = "sheet-thumb";
    th.alt = "";
    const u = seriesThumb(current, r.index);
    if (u) th.src = u;
    const txt = document.createElement("span");
    txt.className = "sheet-txt";
    txt.textContent = seriesRowText(r, LANG === "en");
    const meta = document.createElement("span");
    meta.className = "sheet-meta";
    meta.textContent = r.px ? (Math.round(r.px * 100) / 100) + " mm/px" : "";
    /* The current series is marked with a tick, not with colour alone. */
    const mark = document.createElement("span");
    mark.className = "sheet-mark";
    mark.textContent = on ? "\u2713" : "";
    mark.setAttribute("aria-hidden", "true");
    row.appendChild(th);
    row.appendChild(txt);
    row.appendChild(meta);
    row.appendChild(mark);
    row.onclick = () => { selectSeries(r.index); seriesSheetOpen(false); };
    list.appendChild(row);
  });
}

function seriesSheetOpen(on) {
  const sh = $("series-sheet"), sc = $("series-scrim");
  if (!sh) return;
  const show = on === undefined ? sh.style.display === "none" : !!on;
  if (show) renderSeriesSheet();
  sh.style.display = show ? "block" : "none";
  if (sc) sc.style.display = show ? "block" : "none";
  try { sh.setAttribute("aria-hidden", show ? "false" : "true"); } catch (e) {}
}

function seriesWire() {
  const ob = $("series-open");
  if (ob && !ob.__sn) { ob.__sn = 1; ob.onclick = () => seriesSheetOpen(); }
  const cb = $("series-sheet-close");
  if (cb && !cb.__sn) { cb.__sn = 1; cb.onclick = () => seriesSheetOpen(false); }
  const sc = $("series-scrim");
  if (sc && !sc.__sn) { sc.__sn = 1; sc.onclick = () => seriesSheetOpen(false); }
  try {
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") seriesSheetOpen(false); });
  } catch (e) {}
}

function renderSeriesBar() {
  const bar = $("series-bar");
  if (!bar || !current) return;
  const rows = seriesRows(current);
  const open = $("series-open");
  bar.innerHTML = "";
  if (rows.length < 2) {
    bar.style.display = "none";
    if (open) open.style.display = "none";
    if ($("series-sheet") && $("series-sheet").style.display === "block") seriesSheetOpen(false);
    return;
  }
  bar.style.display = "flex";
  if (open) open.style.display = "inline-block";
  rows.forEach((r) => {
    const b = document.createElement("button");
    b.className = "ghost";
    const on = r.index === currentSeries;
    /* v147 — the tick carries the state, the colour only repeats it. */
    b.textContent = (on ? "\u2713 " : "") + seriesRowText(r, LANG === "en", true);
    if (on) { b.style.background = "#38bdf8"; b.style.color = "#0f172a"; b.setAttribute("aria-current", "true"); }
    b.onclick = () => selectSeries(r.index);
    bar.appendChild(b);
  });
  if ($("series-sheet") && $("series-sheet").style.display === "block") renderSeriesSheet();
}
// All series remain visible; only one full-resolution main canvas is allocated.
let overviewStudy = null;
let overviewIndices = new Map();
let overviewSync = false;
export function spatialMatch(source, targets) {
  const a = source && source.geometry;
  if (!a || !a.frameOfReferenceUid || !a.ipp || !a.iop) return -1;
  const cross = v => [v[1]*v[5]-v[2]*v[4],v[2]*v[3]-v[0]*v[5],v[0]*v[4]-v[1]*v[3]];
  const n=cross(a.iop), len=Math.hypot(...n);
  if (!(len>.99 && len<1.01) || !a.ipp.every(Number.isFinite)) return -1;
  let best=-1, distance=Infinity;
  targets.forEach((f,i)=>{
    const b=f.geometry;
    if (!b || b.frameOfReferenceUid!==a.frameOfReferenceUid || !b.ipp || !b.iop || !b.ipp.every(Number.isFinite)) return;
    const m=cross(b.iop), ml=Math.hypot(...m);
    if (!(ml>.99 && ml<1.01) || Math.abs(n.reduce((v,x,k)=>v+x*m[k],0))<.999) return;
    const d=Math.abs(n.reduce((v,x,k)=>v+x*(a.ipp[k]-b.ipp[k]),0));
    const tolerance=Math.max(.5,Number(b.spacingBetweenSlices)||Number(b.sliceThickness)||1)/2+.1;
    if(d<=tolerance && d<distance){best=i;distance=d;}
  });
  return best;
}
function renderSeriesOverview(idx) {
  const root=$("series-overview"); if(!root || !current)return;
  if(overviewStudy!==current){overviewStudy=current;overviewIndices=new Map();}
  const ss=ensureSeries(current);root.hidden=ss.length<2;
  const fold=$("series-preview-fold");if(fold)fold.hidden=ss.length<2;
  const summary=$("series-preview-summary");if(summary)summary.textContent=(LANG==="en"?"Series thumbnails":"السلاسل — المصغّرات")+" ("+ss.length+")";
  if(ss.length<2){root.replaceChildren();return;}
  overviewIndices.set(currentSeries,idx);
  root.replaceChildren();
  const tiles=document.createElement("div");tiles.className="series-live-grid";root.append(tiles);
  const source=activeFrames()[idx];
  ss.forEach((series,i)=>{
    const frames=series.indices.map(k=>current.frames[k]);let j=overviewIndices.get(i)||0;
    const match=overviewSync && i!==currentSeries?spatialMatch(source,frames):-1;
    if(match>=0)j=match;
    j=Math.max(0,Math.min(frames.length-1,j));overviewIndices.set(i,j);
    const tile=document.createElement("div");tile.className="series-live-tile";
    const b=document.createElement("button");b.className="ghost";b.setAttribute("aria-pressed",String(i===currentSeries));
    const cv=document.createElement("canvas");cv.width=160;cv.height=160;
    const image=document.createElement("canvas");
    try{drawFrame(image,frames[j],presetVal(),current.modality);const scale=Math.min(160/image.width,160/image.height);cv.getContext("2d").drawImage(image,(160-image.width*scale)/2,(160-image.height*scale)/2,image.width*scale,image.height*scale);}catch(e){}
    const label=document.createElement("span");label.textContent=(i===currentSeries?"✓ ":"")+(series.label||series.description||("Se "+(i+1)))+" · "+(j+1)+"/"+frames.length+(i===currentSeries?"":match>=0?" · ↔":" · مستقل / independent");
    b.append(cv,label);b.onclick=()=>{if(dualOn && dualActive===2){secondaryPoints=[];secondaryProbe=null;dualSeries=i;dualIndex=overviewIndices.get(i)||0;dualRender();return;}const target=overviewIndices.get(i)||0;if(allOn)allToggle(false);if(mprOn)mprToggle(false);selectSeries(i);if(!mprOn&&!allOn){{const sl=$("slice");if(sl)sl.value=String(target);}show(target);}};
    const slider=document.createElement("input");slider.type="range";slider.min="0";slider.max=String(Math.max(0,frames.length-1));slider.value=String(j);slider.setAttribute("aria-label",label.textContent);
    slider.onchange=()=>{overviewIndices.set(i,Number(slider.value));const target=Number(slider.value);if(allOn)allToggle(false);if(mprOn)mprToggle(false);if(currentSeries!==i)selectSeries(i);{const sl=$("slice");if(sl)sl.value=String(target);}show(target);};
    tile.append(b,slider);tiles.append(tile);
  });
}
/** A linear reading session, not a reconstructed volume: series boundaries
 * are retained and displayed, never treated as spatial neighbors. */
export function sessionFrameAt(series, position) {
  let offset=0; const total=series.reduce((n,s)=>n+(s.indices||[]).length,0);
  const at=Math.max(0,Math.min(Math.max(0,total-1),Math.trunc(Number(position)||0)));
  for(let i=0;i<series.length;i++){
    const count=(series[i].indices||[]).length;
    if(at<offset+count)return {series:i,index:at-offset,total,position:at};
    offset+=count;
  }
  return null;
}
function sessionBarUpdate(index){
  const bar=$("session-bar"), slider=$("session-slice"),label=$("session-position");
  if(!bar||!slider||!current)return;
  const ss=ensureSeries(current),total=ss.reduce((n,s)=>n+(s.indices||[]).length,0);
  const offset=ss.slice(0,currentSeries).reduce((n,s)=>n+(s.indices||[]).length,0);
  bar.hidden=!total;
  slider.max=String(Math.max(0,total-1));slider.value=String(offset+index);
  const series=ss[currentSeries]||{};
  const name=series.label||series.description||("Se "+(currentSeries+1));
  const text=name+" · "+(index+1)+"/"+(series.indices||[]).length+" · "+(LANG==="en"?"Series ":"سلسلة ")+(currentSeries+1)+"/"+ss.length+" · "+(offset+index+1)+"/"+total;
  if(label)label.textContent=text;slider.setAttribute("aria-valuetext",text);
  if(!slider.__session){slider.__session=1;slider.addEventListener("input",()=>{
    if(!current)return;paneSelect(1);const target=sessionFrameAt(ensureSeries(current),slider.value);if(!target)return;
    if(allOn)allToggle(false);if(mprOn)mprToggle(false);
    if(currentSeries!==target.series)selectSeries(target.series);
    const local=$("slice");if(local)local.value=String(target.index);show(target.index);
  });}
}
function selectSeries(i) {
  vrClose();
  const ss = ensureSeries(current);
  if (!ss.length) return;
  currentSeries = Math.max(0, Math.min(ss.length - 1, i | 0));
  vst({ type: "selectSeries", seriesId: String(currentSeries) });
  const n = (ss[currentSeries].indices || []).length;
  const sl = $("slice");
  if (sl) { sl.max = String(Math.max(0, n - 1)); sl.value = "0"; }
  mprVol = null; mprKey = "";
  renderSeriesBar();
  if (allOn) { renderAll(); return; }
  if (mprOn) mprRender(); else show(0);
}

/* ---- sequence naming: what the file says, else a clearly-marked inference ---- */
const SEQ_TOKENS = [
  [/flair/i, "FLAIR"], [/t2\s*\*|swi|swan|hemo/i, "T2*/SWI"], [/\bdwi\b|diffusion|ep2d_?diff|_diff\b|diff_/i, "DWI"],
  [/\badc\b/i, "ADC"], [/(post|after).*(gad|contrast|\+c)|\+c\b/i, "T1+C"], [/\bt1\b/i, "T1"],
  [/\bt2\b/i, "T2"], [/proton|\bpd\b/i, "PD"], [/\bstir\b/i, "STIR"], [/\bdce\b|perfusion/i, "DCE"],
  [/\btof\b|angio|\bmra\b/i, "MRA/TOF"], [/\bmrv\b|venog/i, "MRV"], [/\bgre\b|gradient/i, "GRE"],
  [/\bepi\b/i, "EPI"], [/ssfp|fiesta/i, "SSFP"], [/\bciss\b/i, "CISS"], [/haste|ss.?tse|\bsstse\b/i, "HASTE"],
  [/\btse\b|\bfse\b|turbo/i, "TSE/FSE"], [/spair|fat.?sat|\bfs\b|dixon/i, "FS"], [/\bir\b/i, "IR"],
];
/** {label, derived, detail} — never invents a sequence without flagging it. */
export function seqLabelOf(seq, modality) {
  const s = seq || {};
  const text = [s.seriesDescription, s.sequenceName, s.protocolName, s.imageType, s.scanOptions].join(" ");
  let label = "", derived = false;
  for (const [rx, name] of SEQ_TOKENS) {
    if (rx.test(text)) { label = name; break; }
  }
  if (!label && (s.bValue || 0) > 50) { label = "DWI"; derived = true; }
  if (!label && String(modality || "").toUpperCase() === "MR") {
    const te = s.te || 0, tr = s.tr || 0, ti = s.ti || 0;
    if (ti > 400 && /IR/i.test(s.scanningSequence || "")) { label = "FLAIR"; derived = true; }
    else if (tr >= 1500 && te >= 80) { label = "T2"; derived = true; }
    else if (tr > 0 && tr <= 800 && te > 0 && te <= 45) { label = "T1"; derived = true; }
  }
  if (!label && (/IR/i.test(s.scanningSequence || ""))) { label = "IR"; derived = true; }
  const c = String(s.contrast || "").trim();
  if (label && c && !/^(no|none|n\/a|0)$/i.test(c)) label += "+C";
  let detail = "";
  if (s.te || s.tr) detail = "TE " + (Math.round((s.te || 0) * 10) / 10) + " / TR " + Math.round(s.tr || 0);
  else if (s.bValue) detail = "b=" + Math.round(s.bValue);
  return { label, derived, detail };
}
/** Best human label for the exam as a whole: file text first, inferred last. */
export function studyTypeLabel(study) {
  if (!study) return "";
  const desc = String(study.description || (study.meta && study.meta.studyDesc) || "").trim();
  if (desc) return desc;
  const f = (study.frames && study.frames[0]) || null;
  const seq = (f && f.seq) || null;
  if (seq) {
    const sd = String(seq.seriesDescription || "").trim();
    if (sd) return sd;
    const pn = String(seq.protocolName || "").trim();
    if (pn) return pn;
    const l = seqLabelOf(seq, study.modality);
    if (l.label) return l.derived ? "~" + l.label : l.label;
  }
  const bp = String(study.bodyPart || (study.meta && study.meta.bodyPart) || "").trim();
  if (bp) return bp;
  return "";
}

/* ---- dates: DICOM YYYYMMDD (+ optional HHMM) → readable, sortable ---- */
const dateDigits = (v) => String(v == null ? "" : v).replace(/\D/g, "");
export function fmtDicomDate(v, t) {
  const m = dateDigits(v).match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return "";
  let out = m[1] + "/" + m[2] + "/" + m[3];
  const tm = dateDigits(t).match(/^(\d{2})(\d{2})/);
  if (tm) out += " " + tm[1] + ":" + tm[2];
  return out;
}
export function dateKey(v) {
  const m = dateDigits(v).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? Number(m[1] + m[2] + m[3]) : 0;
}

/* ---- rendering ---- */
const PRESETS = { auto: null, soft: [50, 400], mediastinum: [40, 400], bone: [300, 1500], lung: [-600, 1600], brain: [40, 80] };

/** Window the samples and fill the RGBA buffer.
    Returns { spread, clipped }: spread 0 = blank; clipped ~1 = the window collapsed
    and everything was pushed to one end (a flat white or flat black frame). */
function fillGray(img, d, n, lo, hi, invert) {
  const span = (hi - lo) || 1;
  let mn = 255, mx = 0, edge = 0;
  for (let i = 0; i < n; i++) {
    let v = (d[i] - lo) / span;
    v = v < 0 ? 0 : (v > 1 ? 1 : v);
    if (invert) v = 1 - v;
    const g = (v * 255) | 0;
    if (g < mn) mn = g;
    if (g > mx) mx = g;
    if (g === 0 || g === 255) edge++;
    const j = i << 2;
    img.data[j] = g; img.data[j + 1] = g; img.data[j + 2] = g; img.data[j + 3] = 255;
  }
  return { spread: mx - mn, clipped: n ? edge / n : 1 };
}
/** True when the render carries no usable information: flat, or clipped to one end. */
/* Flat, or clipped to one end until less than 0.5% of the frame carries any
   information. A small bright structure inside a large dark field is legitimate
   and must stay visible; a frame that is 99.9% one grey is not. */
const poorRender = (r) => !r || r.spread < 2 || r.clipped > 0.995;
/** Grey spread of an already-built ImageData — rejects a blank cache from an older build. */
function imgSpread(imageData) {
  const a = imageData && imageData.data;
  if (!a || !a.length) return 0;
  const step = Math.max(1, Math.floor((a.length >> 2) / 4000)) * 4;
  let mn = 255, mx = 0;
  for (let j = 0; j < a.length; j += step) { const g = a[j]; if (g < mn) mn = g; if (g > mx) mx = g; }
  return mx - mn;
}
/** One value (air, padding, a flat band) can hold >98% of the frame, which collapses
    the 2/98 percentile window to lo == hi and paints every pixel the same grey.
    This re-windows on the values outside that dominant band. */
export function windowOutsideMode(d, n) {
  if (!d || !n) return null;
  const step = Math.max(1, Math.floor(n / 120000));
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i += step) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  if (!(mx > mn)) return null;
  const span = mx - mn;
  const bin = (v) => { let b = (((v - mn) / span) * 255) | 0; return b < 0 ? 0 : (b > 255 ? 255 : b); };
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < n; i += step) { hist[bin(d[i])]++; total++; }
  let mode = 0;
  for (let b = 1; b < 256; b++) if (hist[b] > hist[mode]) mode = b;
  if (!total || hist[mode] / total < 0.5) return null;   // nothing dominates → nothing to rescue
  let lo = Infinity, hi = -Infinity, cnt = 0;
  for (let i = 0; i < n; i += step) {
    if (bin(d[i]) === mode) continue;
    const v = d[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    cnt++;
  }
  if (cnt < 8 || !(hi > lo)) return null;
  return { lo, hi, modeShare: hist[mode] / total };
}

export function drawFrame(canvas, pixels, preset, modality) {
  const prob0 = pixelProblem(pixels);
  if (prob0) { drawReasonPlate(canvas, pixels, prob0); return; }
  try { pixels.__blank = 0; } catch (e) {}
  const { w, h } = pixels;
  const photometric = pixels.photometric || "MONOCHROME2";
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  if (pixels.kind === "rgb") {
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = pixels.data[i * 3];
      img.data[i * 4 + 1] = pixels.data[i * 3 + 1];
      img.data[i * 4 + 2] = pixels.data[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
  } else {
    const d = pixels.data;
    let lo, hi;
    const win = PRESETS[preset];
    if (win && modality === "CT") {
      lo = win[0] - win[1] / 2; hi = win[0] + win[1] / 2;
    } else if (pixels.__win && pixels.__win.k === preset + "|" + modality) {
      lo = pixels.__win.lo; hi = pixels.__win.hi;
    } else {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < d.length; i++) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
      const hist = new Uint32Array(256);
      const span = max - min || 1;
      for (let i = 0; i < d.length; i++) hist[Math.floor(((d[i] - min) / span) * 255)]++;
      const p = (q) => {
        const target = d.length * q; let acc = 0;
        for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= target) return min + (b / 255) * span; }
        return max;
      };
      lo = p(0.02); hi = p(0.98);
      try { pixels.__win = { k: preset + "|" + modality, lo, hi }; } catch (e) {}
    }
    if (!(hi > lo)) hi = lo + 1;
    const ck = preset + "|" + modality;
    if (pixels.__img && pixels.__img.k === ck && imgSpread(pixels.__img.img) >= 2) {
      ctx.putImageData(pixels.__img.img, 0, 0);
      return;
    }
    const invert = photometric === "MONOCHROME1";
    const n = Math.min(w * h, d.length);
    let res = fillGray(img, d, n, lo, hi, invert);
    /* A user-chosen CT preset is respected: only the automatic window gets rescued. */
    const autoWin = !(win && modality === "CT");
    if (autoWin && poorRender(res)) {
      const r = windowOutsideMode(d, n);
      if (r) {
        const lo0 = lo, hi0 = hi;
        lo = r.lo; hi = r.hi;
        res = fillGray(img, d, n, lo, hi, invert);
        if (!poorRender(res)) { try { pixels.__win = { k: ck, lo, hi }; } catch (e) {} }
        else { lo = lo0; hi = hi0; res = fillGray(img, d, n, lo, hi, invert); }
      }
    }
    let spread = res.spread;
    if (autoWin && poorRender(res)) {
      /* Last resort before giving up: the plain value range. It is a poor window
         for CT, but it always shows *something* rather than a black rectangle. */
      let mn2 = Infinity, mx2 = -Infinity;
      for (let i = 0; i < n; i++) { const v = d[i]; if (v < mn2) mn2 = v; if (v > mx2) mx2 = v; }
      if (mx2 > mn2 && (mx2 !== hi || mn2 !== lo)) {
        const lo0 = lo, hi0 = hi;
        lo = mn2; hi = mx2;
        const r3 = fillGray(img, d, n, lo, hi, invert);
        if (!poorRender(r3)) { spread = r3.spread; try { pixels.__win = { k: ck, lo, hi }; } catch (e) {} }
        else { lo = lo0; hi = hi0; fillGray(img, d, n, lo, hi, invert); }
      }
    }
    if (spread < 2) {
      try { pixels.__blank = 1; } catch (e) {}
      drawReasonPlate(canvas, pixels, "blank");
      return;
    }
    try { pixels.__blank = 0; } catch (e) {}
  }
  try {
    pixels.__img = { k: preset + "|" + modality, img };
    pixels.__spread = spread;
    const md = windowOutsideMode(d, n);
    pixels.__mode = md ? Math.round(md.modeShare * 100) / 100 : 0;
  } catch (e) {}
  ctx.putImageData(img, 0, 0);
}

/* ---- viewer interaction: zoom / pan / measure ---- */
let vk = 1, vx = 0, vy = 0, measureMode = false, mPts = [], viewKey = "", fitK = 1;
/* ---- one viewer state, one reducer (v147) ---------------------------------
   The viewer's state used to be these variables and several more (mprOn, allOn,
   currentSeries), each written by a different handler, so two of them could
   disagree and the screen showed a third thing. It now lives in ONE object and
   changes in ONE place — a pure reducer in viewer-state.v147.js, testable with
   node and no browser. The variables above stay as mirrors only because the
   drawing code reads them every frame; they are written FROM vState, never
   instead of it. */
let vState = null;
function vst(a) {
  if (!vstate) return null;
  if (!vState) vState = vstate.initialViewerState();
  const n = vstate.viewerReducer(vState, a);
  if (n && n !== vState) vState = n;
  return vState;
}
function vStateInit() {
  if (!vstate) return;
  vState = vstate.initialViewerState();
  try { vst({ type: "toggleIdentity", on: localStorage.getItem("rrai-id-hidden") === "1" }); } catch (e) {}
}
/** The patient's name as it may be shown: masked while identity is hidden. */
function shownName(nm) {
  const s0 = String(nm == null ? "" : nm);
  if (!s0 || !vstate || !(vState && vState.identityHidden)) return s0;
  return vstate.identityName(s0, true);
}
/* Cine: whether to loop is the state's decision; the timer is only plumbing. */
let cineT = 0;
function cineLabel() {
  const b = $("cine-toggle");
  if (!b) return;
  const on = !!(vState && vState.cine);
  b.textContent = LANG === "en" ? (on ? "Stop cine" : "Cine") : (on ? "\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0645\u062a\u062d\u0631\u0643" : "\u0639\u0631\u0636 \u0645\u062a\u062d\u0631\u0643");
  b.style.background = on ? "#38bdf8" : "";
  b.style.color = on ? "#0f172a" : "";
}
function cineStop() {
  if (cineT) { clearInterval(cineT); cineT = 0; }
  vst({ type: "toggleCine", on: false });
  cineLabel();
}
function cineStart() {
  if (!vState) return;
  vst({ type: "toggleCine", on: true });
  if (!(vState && vState.cine)) {
    cineLabel();
    setStatus(LANG === "en" ? "Cine needs a series with more than one image." : "\u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0645\u062a\u062d\u0631\u0643 \u064a\u062d\u062a\u0627\u062c \u0633\u0644\u0633\u0644\u0629 \u0641\u064a\u0647\u0627 \u0623\u0643\u062b\u0631 \u0645\u0646 \u0635\u0648\u0631\u0629.", true);
    return;
  }
  if (cineT) clearInterval(cineT);
  cineT = setInterval(cineTick, vState.cineMs || 400);
  cineLabel();
}
function cineTick() {
  if (!vState || !vState.cine) { if (cineT) { clearInterval(cineT); cineT = 0; } return; }
  try {
    vst({ type: "cineTick" });
    const i2 = vState ? vState.sliceIndex : 0;
    if (mprOn) { try { mprSetIndex(mprFocus, i2); } catch (e2) {} }
    else { const sl2 = $("slice"); if (sl2 && current) { sl2.value = String(i2); show(i2); } }
  } catch (e3) {}
}
function setupViewerState() {
  const ib = $("id-toggle");
  if (ib && !ib.__vs) {
    ib.__vs = 1;
    ib.onclick = () => {
      vst({ type: "toggleIdentity" });
      const hid = !!(vState && vState.identityHidden);
      try { localStorage.setItem("rrai-id-hidden", hid ? "1" : "0"); } catch (e) {}
      ib.textContent = hid ? (LANG === "en" ? "Identity hidden" : "\u0627\u0644\u0647\u0648\u064a\u0629 \u0645\u062e\u0641\u064a\u0629") : (LANG === "en" ? "Hide identity" : "\u0625\u062e\u0641\u0627\u0621 \u0627\u0644\u0647\u0648\u064a\u0629");
      ib.style.background = hid ? "#38bdf8" : "";
      ib.style.color = hid ? "#0f172a" : "";
      try { if (current) show(sliceIdx()); } catch (e) {}
      setStatus(hid
        ? (LANG === "en" ? "Patient name hidden on the screen and on the image." : "\u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064a\u0636 \u0645\u062e\u0641\u064a \u0639\u0644\u0649 \u0627\u0644\u0634\u0627\u0634\u0629 \u0648\u0639\u0644\u0649 \u0627\u0644\u0635\u0648\u0631\u0629.")
        : (LANG === "en" ? "Patient name shown again." : "\u0639\u0627\u062f \u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064a\u0636 \u0638\u0627\u0647\u0631\u0627."), false);
    };
    try {
      if (localStorage.getItem("rrai-id-hidden") === "1") {
        vst({ type: "toggleIdentity", on: true });
        ib.textContent = LANG === "en" ? "Identity hidden" : "\u0627\u0644\u0647\u0648\u064a\u0629 \u0645\u062e\u0641\u064a\u0629";
        ib.style.background = "#38bdf8";
        ib.style.color = "#0f172a";
      }
    } catch (e) {}
  }
  seriesWire();
  filmWire();
  fsWire();
  cmpWire();
  orientWire();
  vsWire();
  setupV130();
  const cb = $("cine-toggle");
  if (cb && !cb.__vs) { cb.__vs = 1; cb.onclick = () => { if (vState && vState.cine) cineStop(); else cineStart(); }; }
  cineLabel();
  try { document.addEventListener("visibilitychange", () => { if (document.hidden) cineStop(); }); } catch (e) {}
}

let mMode = "seg", mItems = { segments: [], angles: [], rois: [], rects: [] };
/* The last pixel the physician asked the value of: { p:[x,y], v, unit }. A
   readout, not a measurement — it is never written into the report. */
let mProbe = null;
/* ---- v147: how the picture is turned ------------------------------------
   One object read from the state, so no handler can rotate the picture without
   the tap mapping and the fit knowing about it. */
function orientNow() {
  return {
    invert: !!(vState && vState.invert),
    rotate: (vState && Number(vState.rotate)) || 0,
    flipH: !!(vState && vState.flipH),
    flipV: !!(vState && vState.flipV),
  };
}
/** The size of the turned picture, in the image's own pixel units. */
function oSize(w, h, o) {
  if (orientSize) return orientSize(w, h, o);
  const rot = ((o && Number(o.rotate)) || 0) % 360;
  return (rot === 90 || rot === 270) ? [h, w] : [w, h];
}
function oPoint(x, y, w, h, o) { return orientPoint ? orientPoint(x, y, w, h, o) : [x, y]; }
function unPoint(u, v, w, h, o) { return unorientPoint ? unorientPoint(u, v, w, h, o) : [u, v]; }
function applyView() {
  if (vk <= 1.01 && !fsNow()) { vx = 0; vy = 0; }
  const o = orientNow();
  /* The flips sit OUTSIDE the rotation: they are applied in the space the
     physician sees, so "flip horizontally" always means left becomes right on
     screen — not on the film. */
  const sx = o.flipH ? -vk : vk, sy = o.flipV ? -vk : vk;
  $("vwrap").style.transform =
    `translate(${Math.round(vx)}px, ${Math.round(vy)}px) scale(${sx}, ${sy}) rotate(${o.rotate}deg)`;
  const cv = $("frame");
  /* Inverted greyscale is how a chest radiograph is still read in much of the
     world: it is a filter on the picture only, never on the overlay text or on
     the numbers. */
  if (cv) cv.style.filter = o.invert ? "invert(1)" : "none";
  const zs = $("zscale");
  if (zs) zs.textContent = "\u00d7" + (fitK * vk).toFixed(2);
  if(dualOn)requestAnimationFrame(renderReferences);
}
const fsNow = () => !!document.fullscreenElement || !!($("viewer-card") && $("viewer-card").classList.contains("fs-fake"));
/** The scale that fits w×h into cw×ch, clamped. Pure, so it can be tested. */
export function fitScaleFor(cw, ch, w, h) {
  const a = Math.min((Number(cw) || 0) / (Number(w) || 1), (Number(ch) || 0) / (Number(h) || 1));
  if (!isFinite(a) || a <= 0) return 1;
  return Math.max(0.25, Math.min(4, a));
}
/* In fullscreen the bars sit over the bottom of the picture. Fitting to the
   whole viewport therefore drew the anatomy underneath them — the physician
   saw a smaller image than the screen could show. Measure the space that is
   actually free. */
function fsAvailHeight(vp, fallback) {
  const card = $("viewer-card");
  if (!card || !vp) return fallback;
  try {
    const vr = vp.getBoundingClientRect();
    let top = Infinity;
    const els = card.querySelectorAll("#viewer-settings, #viewer-bar, #session-bar, .fs-mini");
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.height > 2 && r.top < top) top = r.top;
    }
    if (!isFinite(top)) return fallback;
    const h = top - vr.top - 8;
    return h > 120 ? h : fallback;
  } catch (e) { return fallback; }
}
/* The fullscreen viewport covers the whole screen; the bars sit on top of its
   lower strip. Reserving that strip as padding keeps the flex centring — which
   would otherwise put the middle of the picture behind the bars — inside the
   band the physician can actually see. Pure in effect: cleared outside
   fullscreen. */
function fsReserve(vp, avail) {
  if (!vp) return;
  const total = vp.clientHeight || Math.round(vp.getBoundingClientRect().height) || 0;
  if (fsNow() && avail > 0 && total > avail + 8) {
    vp.style.paddingBottom = Math.max(0, Math.round(total - avail)) + "px";
  } else if (vp.style.paddingBottom) {
    vp.style.paddingBottom = "";
  }
}
function sliceFitFor(f) {
  const vp = $("viewport");
  const cw = (vp && (vp.clientWidth || Math.round(vp.getBoundingClientRect().width))) || 0;
  /* v147 — the fit is to the TURNED picture: a wide film stood on its end is
     as tall as it was wide, and it has to fit that way. */
  const [dw, dh] = oSize(f.w || 1, f.h || 1, orientNow());
  const kw = cw ? cw / dw : 4;
  let k = kw;
  const fs = fsNow();
  if(dualOn){
    const available=fs?Math.max(80,(vp?.clientHeight||window.innerHeight/2)-45):(window.matchMedia("(max-width:820px)").matches?window.innerHeight*.38:window.innerHeight*.65);
    fsReserve(vp,0);return fitScaleFor(cw,available,dw,dh);
  }
  if (fs) {
    const ch = vp ? (vp.clientHeight || 0) : 0;
    const chh = ch > 40 ? ch : (window.innerHeight || 800);
    /* v147 — fit to the space above the bars, not to the whole screen. */
    const avail = fsAvailHeight(vp, chh);
    fsReserve(vp, avail);
    return fitScaleFor(cw, avail, dw, dh);
  }
  if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
    const ih = window.innerHeight || 800;
    let top = 0;
    if (vp) { const vr = vp.getBoundingClientRect(); top = Math.min(Math.max(vr.top, 0), ih * 0.5); }
    const ch = ih - top - 150;
    if (ch > 40) k = Math.min(k, ch / dh);
  }
  return Math.max(0.25, Math.min(4, k));
}
let lastPaint = null;
let fsHideT = 0;
/* ---- fullscreen: one slim line instead of a stack of settings (v147) ------
   In fullscreen every settings row stayed on screen and covered the bottom of
   the picture, so the image the physician could actually see was smaller than
   the screen allowed. The rows now fold into a single line — a settings button,
   the slice counter and an exit button — and unfold on tap. */
function fsFolded() {
  const c = $("viewer-card");
  return !!(c && c.classList.contains("fs-folded"));
}
function fsSetFold(on) {
  const c = $("viewer-card");
  if (!c) return;
  c.classList.toggle("fs-folded", !!on);
  const b = $("fs-fold");
  if (b) {
    b.setAttribute("aria-expanded", on ? "false" : "true");
    b.style.background = on ? "" : "#38bdf8";
    b.style.color = on ? "#0f172a" : "";
  }
  try { localStorage.setItem("rrai-fs-fold", on ? "1" : "0"); } catch (e) {}
  try { if (current) resetView(true); } catch (e) {}
}
function fsExit() {
  const card = $("viewer-card");
  try { fsReserve($("viewport"), 0); } catch (e) {}
  if (document.fullscreenElement) { try { document.exitFullscreen().catch(() => {}); } catch (e) {} return; }
  if (card) card.classList.remove("fs-fake");
  try { if (current) resetView(true); } catch (e) {}
  const b = $("fs-toggle");
  if (b) b.textContent = LANG === "ar" ? "\u0645\u0644\u0621 \u0627\u0644\u0634\u0627\u0634\u0629" : "Fullscreen";
}
function fsWire() {
  const f = $("fs-fold");
  if (f && !f.__fs) { f.__fs = 1; f.onclick = () => fsSetFold(!fsFolded()); }
  const x = $("fs-exit");
  if (x && !x.__fs) { x.__fs = 1; x.onclick = fsExit; }
  fsSetFold(true);
}
function fsBarShow(on) { const c = $("viewer-card"); if (c) c.classList.toggle("fs-hide", !on); }
function fsArm() {
  clearTimeout(fsHideT);
  fsBarShow(true);
}
function clampPan() {
  const vp = $("viewport");
  const r = $("vwrap").getBoundingClientRect();
  const mx = Math.max(0, (r.width - vp.clientWidth) / 2) + 40;
  const my = Math.max(0, (r.height - vp.clientHeight) / 2) + 40;
  if (vx > mx) vx = mx; if (vx < -mx) vx = -mx;
  if (vy > my) vy = my; if (vy < -my) vy = -my;
}
function resetView(fit, frameOverride) {
  /* sliceIdx() is an index inside the SELECTED SERIES: indexing the whole study
     here sized the canvas from another series' matrix and could push the image
     out of view. Use the frame the viewer actually drew. */
  const f = frameOverride || curFrame() || (current && current.frames[0]) || null;
  if (!f || !f.w || !f.h) return;
  const compute = () => {
    if (fit) fitK = sliceFitFor(f);
    vk = 1; vx = 0; vy = 0;
    vst({ type: "resetView" });
    /* v147 — the wrapper is the TURNED box, so the rotated picture stays
       centred in the viewport instead of hanging off one side of it. */
    const [dw, dh] = oSize(f.w, f.h, orientNow());
    const stW = Math.max(1, Math.round(dw * fitK));
    const stH = Math.max(1, Math.round(dh * fitK));
    const wr = $("vwrap");
    wr.style.width = stW + "px";
    wr.style.height = stH + "px";
    wr.style.margin = "0 auto";
    const cv = $("frame");
    cv.style.display = "block";
    cv.style.inset = "auto";
    cv.style.position = "absolute";
    cv.style.width = Math.round(f.w * fitK) + "px";
    cv.style.height = Math.round(f.h * fitK) + "px";
    cv.style.left = Math.round((dw - f.w) * fitK / 2) + "px";
    cv.style.top = Math.round((dh - f.h) * fitK / 2) + "px";
    const ov = $("overlay");
    ov.style.inset = "auto";
    ov.style.position = "absolute";
    ov.style.width = cv.style.width;
    ov.style.height = cv.style.height;
    ov.style.left = cv.style.left;
    ov.style.top = cv.style.top;
    const ref=$("reference-overlay");if(ref){ref.style.width=cv.style.width;ref.style.height=cv.style.height;ref.style.left=cv.style.left;ref.style.top=cv.style.top;ref.style.inset="auto";ref.style.position="absolute";}
    applyView();
  };
  compute();
  requestAnimationFrame(compute);
}
/** Where a pointer event landed, in the pixels of the FILE — not of the turned
    picture on screen. v147: a measurement must stay true however the film is
    turned, so every tap goes through the same inverse mapping. */
function imgPoint(e) {
  const r = $("frame").getBoundingClientRect();
  const f0 = curFrame();
  const o = orientNow();
  const dw = f0 ? oSize(f0.w, f0.h, o)[0] : 0;
  const s = (f0 && dw && r.width / dw) || vk;
  const u = (e.clientX - r.left) / s, v = (e.clientY - r.top) / s;
  return f0 ? unPoint(u, v, f0.w, f0.h, o) : [u, v];
}
function centerOn(ix, iy) {
  const vr = $("viewport").getBoundingClientRect();
  const r = $("frame").getBoundingClientRect();
  const f0 = curFrame();
  if (!f0) return;
  const o = orientNow();
  const dw = oSize(f0.w, f0.h, o)[0];
  const s = (dw && r.width / dw) || vk;
  const pt = oPoint(ix, iy, f0.w, f0.h, o);   /* the same point, in the turned picture */
  vx += vr.left + vr.width / 2 - (r.left + pt[0] * s);
  vy += vr.top + vr.height / 2 - (r.top + pt[1] * s);
  applyView();
}
const curFrame = () => { if (!current) return null; const fr = activeFrames(); return fr[sliceIdx()] || fr[0] || null; };
function commitMeasurements() {
  if (!current) return;
  const key=measurementKey(1);if(key){current.measurementFrames=current.measurementFrames||{};current.measurementFrames[key]=mItems;}
  // Unscoped legacy measurements are retained unchanged; never assign them to an unknown frame.
  try { putStudy(current).catch(() => {}); } catch (e) {}
}
function drawOverlay() {
  const ov = $("overlay");
  const ctx = ov.getContext("2d");
  ctx.clearRect(0, 0, ov.width, ov.height);
  ctx.strokeStyle = measureColor(); ctx.fillStyle = measureColor(); ctx.lineWidth = 1.5;
  ctx.font = "12px system-ui, sans-serif";
  const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); };
  const label = (t, x, y) => { ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "#0b1220"; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); ctx.restore(); };
  (mItems.segments || []).forEach((s, i) => {
    ctx.beginPath(); ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]); ctx.stroke();
    dot(s.a[0], s.a[1]); dot(s.b[0], s.b[1]);
    label((i + 1) + ": " + (s.mm != null ? (measureUnit() === "cm" ? (s.mm / 10).toFixed(2) + " سم" : s.mm.toFixed(1) + " مم") : s.px.toFixed(0) + " بكسل"), (s.a[0] + s.b[0]) / 2 + 6, (s.a[1] + s.b[1]) / 2 - 6);
  });
  (mItems.angles || []).forEach((g, i) => {
    ctx.beginPath(); ctx.moveTo(g.p1[0], g.p1[1]); ctx.lineTo(g.v[0], g.v[1]); ctx.lineTo(g.p2[0], g.p2[1]); ctx.stroke();
    dot(g.p1[0], g.p1[1]); dot(g.v[0], g.v[1]); dot(g.p2[0], g.p2[1]);
    label("∠" + (i + 1) + ": " + g.deg.toFixed(1) + "°", g.v[0] + 8, g.v[1] - 8);
  });
  (mItems.rois || []).forEach((r, i) => {
    ctx.beginPath(); ctx.ellipse(r.c[0], r.c[1], r.rx, r.ry, 0, 0, 7); ctx.stroke();
    dot(r.c[0], r.c[1]);
    label("ROI" + (i + 1) + ": μ" + r.mean.toFixed(1) + " σ" + r.std.toFixed(1) + " " + r.unit, r.c[0] + r.rx + 4, r.c[1]);
  });
  /* v147 — a rectangle ROI: mean / sd / min / max over every pixel of the box */
  (mItems.rects || []).forEach((r, i) => {
    const x0 = Math.min(r.a[0], r.b[0]), y0 = Math.min(r.a[1], r.b[1]);
    const x1 = Math.max(r.a[0], r.b[0]), y1 = Math.max(r.a[1], r.b[1]);
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.stroke();
    label("\u25ad" + (i + 1) + ": \u03bc" + r.mean.toFixed(1) + " \u03c3" + r.std.toFixed(1) + " " + (r.unit || ""), x0 + 4, y0 - 5);
  });
  /* v147 — the pixel the physician asked the value of, marked where he asked */
  if (mProbe && mProbe.p) {
    ctx.save();
    ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(mProbe.p[0] - 9, mProbe.p[1]); ctx.lineTo(mProbe.p[0] + 9, mProbe.p[1]);
    ctx.moveTo(mProbe.p[0], mProbe.p[1] - 9); ctx.lineTo(mProbe.p[0], mProbe.p[1] + 9);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(mProbe.p[0], mProbe.p[1], 4, 0, 7); ctx.stroke();
    ctx.restore();
    label(probeText(mProbe), mProbe.p[0] + 11, mProbe.p[1] - 9);
  }
  for (const [x, y] of mPts) dot(x, y);
  if (mMode === "rect" && mPts.length === 2) {
    ctx.beginPath();
    ctx.rect(Math.min(mPts[0][0], mPts[1][0]), Math.min(mPts[0][1], mPts[1][1]),
             Math.abs(mPts[1][0] - mPts[0][0]), Math.abs(mPts[1][1] - mPts[0][1]));
    ctx.stroke();
  }
  if (mMode === "seg" && mPts.length === 2) { ctx.beginPath(); ctx.moveTo(mPts[0][0], mPts[0][1]); ctx.lineTo(mPts[1][0], mPts[1][1]); ctx.stroke(); }
  if (mMode === "angle" && mPts.length >= 2) {
    ctx.beginPath(); ctx.moveTo(mPts[0][0], mPts[0][1]); ctx.lineTo(mPts[1][0], mPts[1][1]);
    if (mPts[2]) ctx.lineTo(mPts[2][0], mPts[2][1]);
    ctx.stroke();
  }
  if (mMode === "roi" && mPts.length === 2) {
    ctx.beginPath(); ctx.ellipse(mPts[0][0], mPts[0][1], Math.max(2, Math.abs(mPts[1][0] - mPts[0][0])), Math.max(2, Math.abs(mPts[1][1] - mPts[0][1])), 0, 0, 7); ctx.stroke();
  }
  if (mMode === "probe" && mPts.length === 1) {
    ctx.save(); ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(mPts[0][0] - 9, mPts[0][1]); ctx.lineTo(mPts[0][0] + 9, mPts[0][1]);
    ctx.moveTo(mPts[0][0], mPts[0][1] - 9); ctx.lineTo(mPts[0][0], mPts[0][1] + 9);
    ctx.stroke(); ctx.restore();
  }
}
let cmp = null;
/* ---- v147 — compare side by side ----------------------------------------
   The comparison that shipped first was a difference map drawn the size of a
   thumbnail below the viewer. It answers "how much changed"; a follow-up asks
   "what does it look like next to the old one". So this is a two-pane hanging:
   the study on screen beside another study of the same patient, each with its
   own slice, with the slice, the zoom and the window optionally linked. Two
   studies of the same region rarely hold the same number of images, so the
   link is by DEPTH (a ratio along the stack), never by index. */
/** Other studies of the same patient on this device, newest first. */
export function cmpCandidates(studies, current) {
  const list = Array.isArray(studies) ? studies : [];
  if (!current) return [];
  const mine = cmpNameKey(current);
  if (!mine) return [];
  return list
    .filter((s) => s && s !== current && s.uid !== current.uid && cmpNameKey(s) === mine)
    .sort((x, y) => (cmpWhen(y) < cmpWhen(x) ? -1 : cmpWhen(y) > cmpWhen(x) ? 1 : 0));
}
/* One patient arrives under several spellings even inside one device:
   "Ala^Fahmi^Bazl" from one source, "Ala Fahmi Bazl" from another,
   "AlaFahmiBazl" from a third. Matching on the raw string found nothing to
   compare against — which looks like "this feature does not work". Compare the
   name without its separators instead: two names that differ only by '^' or by
   spaces are one patient. */
export function cmpNameKey(s) {
  return String((s && (s.patient || (s.meta && s.meta.patientName))) || "")
    .toUpperCase().replace(/\^/g, " ").replace(/\s+/g, "");
}
const cmpWhen = (s) => String((s && s.meta && s.meta.studyDate) || (s && s.createdAt) || "");
/** Two studies belong to the same person however their names are spelled. */
export function cmpSamePatient(a, b) {
  const ka = cmpNameKey(a), kb = cmpNameKey(b);
  return !!ka && ka === kb;
}
/** Every other study on the device, newest first — the fallback when this
    patient has no previous study of their own. */
export function cmpOthers(studies, current) {
  const list = Array.isArray(studies) ? studies : [];
  if (!current) return [];
  return list
    .filter((s) => s && s !== current && s.uid !== current.uid)
    .sort((x, y) => (cmpWhen(y) < cmpWhen(x) ? -1 : cmpWhen(y) > cmpWhen(x) ? 1 : 0));
}
/** True when the comparison partner is another person's study. */
export function cmpCrossPatient(current, other) {
  if (!current || !other) return false;
  return !cmpSamePatient(current, other);
}
/** Where a slice sits inside its stack, as 0..1 — the shared currency. */
export function cmpRatio(idx, n) {
  const N = Math.max(0, Math.round(Number(n) || 0));
  if (N < 2) return 0;
  const i = Math.max(0, Math.min(N - 1, Math.round(Number(idx) || 0)));
  return i / (N - 1);
}
/** The slice at a given depth of a stack. */
export function cmpIndex(ratio, n) {
  const N = Math.max(0, Math.round(Number(n) || 0));
  if (N < 1) return 0;
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  return Math.max(0, Math.min(N - 1, Math.round(r * (N - 1))));
}
/** The slice of the other stack that lies at the same depth. */
export function cmpPartner(idx, fromN, toN) { return cmpIndex(cmpRatio(idx, fromN), toN); }
/** One line a physician recognises a study by. With withPatient the name is
    part of the line — which it must be when the partner is another person. */
export function cmpLabel(study, withPatient) {
  if (!study) return "";
  const n = (study.frames || []).length;
  const name = withPatient ? String(study.patient || (study.meta && study.meta.patientName) || "").trim() : "";
  return [name, study.modality, fmtDicomDate(study.meta && study.meta.studyDate), n ? n + (LANG === "en" ? " img" : " \u0635\u0648\u0631\u0629") : ""].filter(Boolean).join(" \u2022 ");
}

let cmpB = null, cmpIa = 0, cmpIb = 0, cmpZa = 1, cmpZb = 1;
const cmpSyncGet = (kind) => { const b = $("cmp-sync-" + kind); if (b) return !!b.checked; try { return localStorage.getItem("rrai-cmp-sync-" + kind) !== "0"; } catch (e) { return true; } };
const cmpSyncSet = (kind, on) => { try { localStorage.setItem("rrai-cmp-sync-" + kind, on ? "1" : "0"); } catch (e) {} };
const cmpStudy = (which) => (which === "b" ? cmpB : current);
const cmpIdx = (which) => (which === "b" ? cmpIb : cmpIa);
const cmpZoom = (which) => (which === "b" ? cmpZb : cmpZa);
const cmpCount = (which) => { const s = cmpStudy(which); return (s && s.frames ? s.frames.length : 0) || 0; };
const cmpFrameAt = (which, i) => { const s = cmpStudy(which); const fr = (s && s.frames) || []; return fr[Math.max(0, Math.min(fr.length - 1, i))] || null; };

function cmpSetSlice(which, idx) {
  const n = cmpCount(which);
  if (!n) return;
  const i = Math.max(0, Math.min(n - 1, Math.round(Number(idx) || 0)));
  if (which === "b") cmpIb = i; else cmpIa = i;
  if (cmpSyncGet("slice")) {
    const other = which === "b" ? "a" : "b";
    const j = cmpPartner(i, n, cmpCount(other));
    if (which === "b") cmpIa = j; else cmpIb = j;
  }
  cmpDraw();
}
function cmpSetZoom(which, z) {
  const zz = Math.max(1, Math.min(6, Number(z) || 1));
  if (cmpSyncGet("zoom")) { cmpZa = zz; cmpZb = zz; }
  else if (which === "b") cmpZb = zz; else cmpZa = zz;
  cmpDraw();
}
function cmpWinOptions() {
  const src = $("preset");
  return src ? Array.prototype.map.call(src.options, (o) => [o.value, o.textContent]) : [["auto", "\u062a\u0644\u0642\u0627\u0626\u064a"]];
}
function cmpFillWin(which) {
  const sel = $("cmp-win-" + which);
  if (!sel || sel.options.length) return;
  const opts = cmpWinOptions();
  for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
  sel.value = presetVal();
}
function cmpPresetFor(which) {
  if (cmpSyncGet("win")) return presetVal();
  const sel = $("cmp-win-" + which);
  return sel && sel.value ? sel.value : presetVal();
}
function cmpPaint(which) {
  const cv = $("cmp-cv-" + which);
  const sub = $("cmp-sub-" + which);
  const study = cmpStudy(which);
  const n = cmpCount(which);
  const sl = $("cmp-slice-" + which);
  if (sl) { sl.max = String(Math.max(0, n - 1)); sl.value = String(Math.min(cmpIdx(which), Math.max(0, n - 1))); sl.disabled = n < 2; }
  if (!cv) return;
  const f = cmpFrameAt(which, cmpIdx(which));
  if (!f) {
    cv.width = cv.width || 1; cv.height = cv.height || 1;
    const cx = cv.getContext("2d"); if (cx) { cx.clearRect(0, 0, cv.width, cv.height); }
    if (sub) sub.textContent = LANG === "en" ? "no image" : "\u0644\u0627 \u0635\u0648\u0631\u0629";
    return;
  }
  const preset = cmpPresetFor(which);
  try { drawFrame(cv, f, preset, study.modality); } catch (e) {}
  cv.style.width = Math.round(100 * cmpZoom(which)) + "%";
  if (sub) sub.textContent = (cmpIdx(which) + 1) + " / " + n + " \u2022 " + f.w + "\u00d7" + f.h + " \u2022 " + preset + (cmpZoom(which) > 1.005 ? " \u2022 \u00d7" + cmpZoom(which).toFixed(1) : "");
}
function cmpText() {
  const t = $("cmp-title"); if (t) t.textContent = LANG === "en" ? "Side by side" : "\u0645\u0642\u0627\u0631\u0646\u0629 \u062c\u0646\u0628\u064b\u0627 \u0625\u0644\u0649 \u062c\u0646\u0628";
  const lp = $("lbl-cmp-pick"); if (lp) lp.firstChild.textContent = LANG === "en" ? "Other study: " : "\u0627\u0644\u062f\u0631\u0627\u0633\u0629 \u0627\u0644\u0623\u062e\u0631\u0649: ";
  const lw = $("lbl-win-b"); if (lw) lw.firstChild.textContent = LANG === "en" ? "Window: " : "\u0627\u0644\u0646\u0627\u0641\u0630\u0629: ";
  const ob = $("cmp-open-b"); if (ob) ob.textContent = LANG === "en" ? "Open this study" : "\u0641\u062a\u062d \u0647\u0630\u0647 \u0627\u0644\u062f\u0631\u0627\u0633\u0629";
  const set = (id, ar, en) => { const e = $(id); if (e) e.textContent = LANG === "en" ? en : ar; };
  set("lbl-cmp-slice", "\u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u0634\u0631\u064a\u062d\u0629", "Link slice");
  set("cmp-side-btn", "\u062c\u0646\u0628\u064b\u0627 \u0625\u0644\u0649 \u062c\u0646\u0628", "Side by side");
  set("lbl-cmp-zoom", "\u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u062a\u0643\u0628\u064a\u0631", "Link zoom");
  set("lbl-cmp-win", "\u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u0646\u0627\u0641\u0630\u0629", "Link window");
  const ha = $("cmp-head-a"); if (ha) ha.textContent = (LANG === "en" ? "Current \u2014 " : "\u0627\u0644\u062d\u0627\u0644\u064a\u0629 \u2014 ") + cmpLabel(current);
  const cross = cmpCrossPatient(current, cmpB);
  const hb = $("cmp-head-b");
  if (hb) hb.textContent = (cross
    ? (LANG === "en" ? "Other study \u2014 " : "\u062f\u0631\u0627\u0633\u0629 \u0623\u062e\u0631\u0649 \u2014 ")
    : (LANG === "en" ? "Previous \u2014 " : "\u0627\u0644\u0633\u0627\u0628\u0642\u0629 \u2014 ")) + cmpLabel(cmpB, cross);
}
function cmpDraw() {
  cmpFillWin("b");
  /* while the window is linked, pane B follows the viewer's window — its own
     select is shown disabled rather than silently ignored */
  const wb = $("cmp-win-b");
  if (wb) wb.disabled = !!cmpSyncGet("win");
  cmpPaint("a"); cmpPaint("b");
  cmpText();
  const note = $("cmp-note");
  if (note) {
    const linked = [];
    if (cmpSyncGet("slice")) linked.push(LANG === "en" ? "slice" : "\u0627\u0644\u0634\u0631\u064a\u062d\u0629");
    if (cmpSyncGet("zoom")) linked.push(LANG === "en" ? "zoom" : "\u0627\u0644\u062a\u0643\u0628\u064a\u0631");
    if (cmpSyncGet("win")) linked.push(LANG === "en" ? "window" : "\u0627\u0644\u0646\u0627\u0641\u0630\u0629");
    let txt = (LANG === "en" ? "Linked: " : "\u0645\u0632\u0627\u0645\u0646\u0629: ") + (linked.length ? linked.join(" \u2022 ") : (LANG === "en" ? "nothing \u2014 the panes move on their own" : "\u0644\u0627 \u0634\u064a\u0621 \u2014 \u0643\u0644 \u0646\u0627\u0641\u0630\u0629 \u062a\u062a\u062d\u0631\u0643 \u0648\u062d\u062f\u0647\u0627"));
    /* never by colour alone, and never silently: say whose study it is */
    if (cmpCrossPatient(current, cmpB)) {
      txt = (LANG === "en"
        ? "\u26a0 Not the same patient \u2014 " + String((cmpB && (cmpB.patient || (cmpB.meta && cmpB.meta.patientName))) || "").trim() + ". "
        : "\u26a0 \u0644\u064a\u0633 \u0627\u0644\u0645\u0631\u064a\u0636 \u0646\u0641\u0633\u0647 \u2014 " + String((cmpB && (cmpB.patient || (cmpB.meta && cmpB.meta.patientName))) || "").trim() + ". ") + txt;
    }
    note.textContent = txt;
  }
}
async function cmpFillPicker() {
  const sel = $("cmp-pick");
  const all = await allStudies();
  const list = cmpCandidates(all, current);
  const same = new Set(list.map((s) => s.uid));
  const others = cmpOthers(all, current).filter((s) => !same.has(s.uid));
  const pool = list.concat(others);
  if (!sel) return pool;
  sel.innerHTML = "";
  if (!pool.length) {
    sel.style.display = "none";
    const note = $("cmp-note");
    if (note) note.textContent = LANG === "en" ? "No other study is on this device yet." : "\u0644\u0627 \u062a\u0648\u062c\u062f \u062f\u0631\u0627\u0633\u0629 \u0623\u062e\u0631\u0649 \u0639\u0644\u0649 \u0627\u0644\u062c\u0647\u0627\u0632 \u0628\u0639\u062f.";
    return pool;
  }
  sel.style.display = "";
  const group = (label, items, withPatient) => {
    if (!items.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const s of items) {
      const o = document.createElement("option");
      o.value = s.uid;
      o.textContent = cmpLabel(s, withPatient);
      g.appendChild(o);
    }
    sel.appendChild(g);
  };
  group(LANG === "en" ? "Same patient" : "\u0646\u0641\u0633 \u0627\u0644\u0645\u0631\u064a\u0636", list, false);
  group(LANG === "en" ? "Other studies on this device" : "\u062f\u0631\u0627\u0633\u0627\u062a \u0623\u062e\u0631\u0649 \u0639\u0644\u0649 \u0627\u0644\u062c\u0647\u0627\u0632", others, true);
  if (!cmpB || !pool.some((s) => s.uid === cmpB.uid)) { cmpB = pool[0]; cmpIb = 0; }
  sel.value = cmpB.uid;
  return pool;
}
async function cmpSheetOpen(on) {
  const sh = $("cmp-sheet"), sc = $("cmp-scrim");
  if (!sh) return;
  const show = on === undefined ? sh.style.display === "none" : !!on;
  if (!show) { sh.style.display = "none"; if (sc) sc.style.display = "none"; return; }
  if (!current) { setStatus(LANG === "en" ? "Open a study first." : "\u0627\u0641\u062a\u062d \u062f\u0631\u0627\u0633\u0629 \u0623\u0648\u0644\u064b\u0627.", false); return; }
  cmpIa = typeof sliceIdx === "function" ? sliceIdx() : 0;
  await cmpFillPicker();
  sh.style.display = "block";
  if (sc) sc.style.display = "block";
  try { sh.setAttribute("aria-hidden", "false"); } catch (e) {}
  cmpDraw();
}
function cmpGestures(cv, which) {
  const pts = new Map();
  let d0 = 0, z0 = 1;
  const dist = () => { const v = [...pts.values()]; return Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); };
  cv.addEventListener("pointerdown", (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { d0 = dist(); z0 = cmpZoom(which); }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size !== 2 || !d0) return;
    cmpSetZoom(which, z0 * (dist() / d0));
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("dblclick", () => cmpSetZoom(which, 1));
  cv.addEventListener("wheel", (e) => { e.preventDefault(); cmpSetSlice(which, cmpIdx(which) + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
}
function cmpWire() {
  for (const which of ["a", "b"]) {
    const sl = $("cmp-slice-" + which);
    if (sl && !sl.__cmp) { sl.__cmp = 1; sl.addEventListener("input", () => cmpSetSlice(which, Number(sl.value))); }
    const cv = $("cmp-cv-" + which);
    if (cv && !cv.__cmp) { cv.__cmp = 1; cmpGestures(cv, which); }
  }
  for (const kind of ["slice", "zoom", "win"]) {
    const box = $("cmp-sync-" + kind);
    if (box && !box.__cmp) {
      box.__cmp = 1;
      try { box.checked = localStorage.getItem("rrai-cmp-sync-" + kind) !== "0"; } catch (e) {}
      box.addEventListener("change", () => { cmpSyncSet(kind, box.checked); cmpDraw(); });
    }
  }
  const wb = $("cmp-win-b");
  if (wb && !wb.__cmp) { wb.__cmp = 1; wb.addEventListener("change", () => cmpDraw()); }
  const pk = $("cmp-pick");
  if (pk && !pk.__cmp) {
    pk.__cmp = 1;
    pk.addEventListener("change", async () => {
      const all = await allStudies();
      cmpB = all.find((s) => s.uid === pk.value) || null;
      cmpIb = 0; cmpZb = 1;
      cmpDraw();
    });
  }
  const ob = $("cmp-open-b");
  if (ob && !ob.__cmp) { ob.__cmp = 1; ob.addEventListener("click", async () => { if (!cmpB) return; cmpSheetOpen(false); try { await openStudy(cmpB); } catch (e) {} }); }
  const cl = $("cmp-close");
  if (cl && !cl.__cmp) { cl.__cmp = 1; cl.onclick = () => cmpSheetOpen(false); }
  const sc = $("cmp-scrim");
  if (sc && !sc.__cmp) { sc.__cmp = 1; sc.onclick = () => cmpSheetOpen(false); }
  const side = $("cmp-side-btn");
  if (side && !side.__cmp) { side.__cmp = 1; side.onclick = () => cmpSheetOpen(true); }
  /* the viewer's own window is the one both panes follow while the window is
     linked, so a change there must reach the sheet */
  const pre = $("preset");
  if (pre && !pre.__cmp) {
    pre.__cmp = 1;
    pre.addEventListener("change", () => {
      const sh = $("cmp-sheet");
      if (sh && sh.style.display === "block") cmpDraw();
    });
  }
  try {
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") cmpSheetOpen(false); });
  } catch (e) {}
}

function compareGrayAtRatio(study, ratio) {
  const idx = Math.min(study.frames.length - 1, Math.round(ratio * (study.frames.length - 1)));
  const f = study.frames[idx];
  return f ? frameGrayFlat(f) : null;
}
function resampleGray(gray, w, h, tw, th) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d");
  const img = cx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, gray[i]));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const c2 = document.createElement("canvas");
  c2.width = tw; c2.height = th;
  const cx2 = c2.getContext("2d");
  cx2.imageSmoothingEnabled = perfSmooth();
  cx2.drawImage(c, 0, 0, tw, th);
  const d = cx2.getImageData(0, 0, tw, th).data;
  const out = new Float32Array(tw * th);
  for (let i = 0; i < tw * th; i++) out[i] = d[i * 4];
  return { gray: out, w: tw, h: th };
}
function drawCompare() {
  const root = $("compare-root");
  if (!root) return;
  if (!cmp || !current) { root.style.display = "none"; return; }
  root.style.display = "block";
  const fa = curFrame() || current.frames[0];
  if (!fa) return;
  const ratio = current.frames.length > 1 ? sliceIdx() / (current.frames.length - 1) : 0;
  let ga = frameGrayFlat(fa), wa = fa.w, ha = fa.h;
  let gb = compareGrayAtRatio(cmp, ratio);
  if (!gb) return;
  const fb = cmp.frames[Math.min(cmp.frames.length - 1, Math.round(ratio * (cmp.frames.length - 1)))];
  if (fb.w !== wa || fb.h !== ha) {
    const r = resampleGray(gb, fb.w, fb.h, wa, ha);
    gb = r.gray;
  }
  const sa = cmpFrameStats(ga), sb = cmpFrameStats(gb);
  const na = normalize01(ga, sa.min, sa.max), nb = normalize01(gb, sb.min, sb.max);
  const ds = diffStats(na, nb, 0.25);
  const put = (id, gray, w, h, tint) => {
    const cv = $(id);
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      let v = Math.max(0, Math.min(255, gray[i]));
      img.data[i * 4] = tint && tint[i] ? 255 : v;
      img.data[i * 4 + 1] = tint && tint[i] ? 60 : v;
      img.data[i * 4 + 2] = tint && tint[i] ? 60 : v;
      img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
  };
  put("cmp-a", ga, wa, ha, null);
  put("cmp-b", gb, wa, ha, null);
  put("cmp-d", na.map((v, i) => v * 90), wa, ha, ds.mask);
  $("compare-out").textContent =
    "مقارنة مع " + (cmp.patient || cmp.uid) + ": متوسط الفرق " + ds.meanAbs.toFixed(3) +
    " والنقاط الساخنة " + ds.pctHot.toFixed(1) + "% (عتبة 0.25 بعد التطبيع).";
  if (!current.compare || current.compare.uid !== cmp.uid || Math.abs(current.compare.meanAbs - ds.meanAbs) > 1e-9) {
    current.compare = { uid: cmp.uid, patient: cmp.patient, meanAbs: ds.meanAbs, pctHot: ds.pctHot, at: new Date().toISOString() };
    try { putStudy(current).catch(() => {}); } catch (e) {}
  }
}
function setupCompareUI() {
  const anchor = $("measure-clear") || $("measure");
  if (!anchor || $("compare-btn")) return;
  const btn = document.createElement("button");
  btn.className = "ghost";
  btn.id = "compare-btn";
  btn.textContent = "مقارنة";
  const sel = document.createElement("select");
  sel.id = "compare-sel";
  sel.className = "ghost";
  sel.style.display = "none";
  sel.style.padding = ".3rem .4rem";
  anchor.parentNode.insertBefore(btn, anchor.nextSibling);
  anchor.parentNode.insertBefore(sel, btn.nextSibling);
  const root = document.createElement("div");
  root.id = "compare-root";
  root.style.display = "none";
  root.style.margin = ".8rem 0";
  root.innerHTML =
    '<div id="compare-heading" style="font-weight:700;margin-bottom:.4rem;">مقارنة مع دراسة سابقة</div>' +
    '<div style="display:flex;gap:.5rem;flex-wrap:wrap;">' +
    '<div><canvas id="cmp-a" style="width:32%;max-width:220px;background:#000;"></canvas><div id="compare-current-caption" style="font-size:.75rem;">الحالية</div></div>' +
    '<div><canvas id="cmp-b" style="width:32%;max-width:220px;background:#000;"></canvas><div id="compare-prior-caption" style="font-size:.75rem;">السابقة/الأخرى</div></div>' +
    '<div><canvas id="cmp-d" style="width:32%;max-width:220px;background:#000;"></canvas><div id="compare-difference-caption" style="font-size:.75rem;">خريطة الفرق (أحمر = ساخن)</div></div>' +
    '</div><div id="compare-out" style="margin-top:.4rem;font-size:.85rem;color:var(--accent);"></div>';
  const sideBtn = document.createElement("button");
  sideBtn.className = "ghost";
  sideBtn.id = "cmp-side-btn";
  sideBtn.textContent = LANG === "en" ? "Side by side" : "\u062c\u0646\u0628\u064b\u0627 \u0625\u0644\u0649 \u062c\u0646\u0628";
  anchor.parentNode.insertBefore(sideBtn, sel.nextSibling);
  const vwrap = $("vwrap");
  const sec = (vwrap && vwrap.closest ? vwrap.closest("section") : null) || vwrap;
  if (sec && sec.parentNode) sec.parentNode.insertBefore(root, sec.nextSibling);
  else document.body.appendChild(root);
  btn.onclick = async () => {
    if (!current) { setStatus("افتح دراسة أولًا.", true); return; }
    const all = await allStudies();
    sel.innerHTML = "";
    for (const s of all) {
      if (s.uid === current.uid) continue;
      const o = document.createElement("option");
      o.value = s.uid;
      o.textContent = (s.patient || s.uid) + " — " + (s.modality || "?");
      sel.appendChild(o);
    }
    if (!sel.options.length) { setStatus("لا دراسات أخرى للمقارنة على هذا الجهاز.", true); return; }
    sel.style.display = sel.style.display === "none" ? "inline-block" : "none";
  };
  sel.onchange = async () => {
    const all = await allStudies();
    cmp = all.find((s) => s.uid === sel.value) || null;
    drawCompare();
  };
  /* the side-by-side button is created here, after the wirings above have run */
  try { cmpWire(); } catch (e) {}
}
/* The value of one pixel, said the way a radiologist reads it: the numbers the
   file carries, in the unit the file declares — HU for a CT that was rescaled,
   plain grey otherwise. Never a number we invented. */
function probeText(p) {
  const f = curFrame();
  const sp = f && f.spacing;
  const unit = p.unit === "HU" ? " HU" : "";
  const val = p.unit === "HU" ? Math.round(p.v) : (Math.round(p.v * 10) / 10);
  let mm = "";
  if (sp) {
    const mmx = (p.p[0] * (sp[1] || sp[0] || 0)), mmy = (p.p[1] * (sp[0] || sp[1] || 0));
    mm = " \u2022 " + mmx.toFixed(1) + " \u00d7 " + mmy.toFixed(1) + (LANG === "en" ? " mm" : " \u0645\u0645");
  }
  return (LANG === "en" ? "pixel " : "\u0628\u0643\u0633\u0644 ") +
    "(" + Math.round(p.p[0]) + ", " + Math.round(p.p[1]) + ") = " + val + unit + mm;
}
/* ---- v147: the five ways a film is turned --------------------------------
   Invert, rotate, flip H, flip V, and back to the way it was acquired. Each one
   dispatches to the reducer and then refits, because a picture stood on its end
   is a different shape on screen and must be fitted as one. */
/* ---- v147 (2): one fold for the viewer's settings -----------------------
   Six rows had piled up under the picture — measure tools, slice, window, the
   turns, series, MPR, filmstrip, the info line — 372 px of chrome on a phone,
   so the anatomy was left with 641 px of a 1544-px screen. One button folds the
   lot; what a hand reaches for while reading (Fit, Fullscreen, and the fold
   itself) stays. Folded by default and remembered, because the picture is the
   point. */
const VS_KEY = "rrai-vs-fold";
let vsOn = true;                       /* folded until the physician says otherwise */
const vsFolded = () => !!vsOn;
function vsLabel() {
  const b = $("vs-fold");
  if (!b) return;
  const name = LANG === "en" ? "\u2699 Viewer settings" : "\u2699 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0639\u0627\u0631\u0636";
  /* the arrow carries the state, not the colour: the app's own rule */
  b.textContent = name + (vsOn ? " \u25be" : " \u25b4");
  b.setAttribute("aria-expanded", vsOn ? "false" : "true");
  b.style.background = vsOn ? "" : "var(--accent)";
  b.style.color = vsOn ? "" : "#0f172a";
  b.style.borderColor = vsOn ? "" : "var(--accent)";
}
function vsSetFold(on) {
  vsOn = !!on;
  const box = $("viewer-settings");
  if (box) box.hidden = vsOn;
  try { localStorage.setItem(VS_KEY, vsOn ? "1" : "0"); } catch (e) {}
  vsLabel();
  /* The fit is measured from what is free: folding the rows away must hand the
     space back to the anatomy, not leave a hole underneath it. */
  try { if (current) resetView(true); } catch (e) {}
  try { renderFilmstrip(); } catch (e) {}
}
/** A keyboard shortcut that reaches a control inside the fold opens it first:
    a turn the physician cannot see is worse than no turn at all. */
function vsOpen() { if (vsOn) vsSetFold(false); }
function vsWire() {
  const b = $("vs-fold");
  if (b && !b.__vs) { b.__vs = 1; b.addEventListener("click", () => vsSetFold(!vsOn)); }
  let want = "1";
  try { want = localStorage.getItem(VS_KEY) || "1"; } catch (e) {}
  vsSetFold(want !== "0");
}
function orientChanged() {
  orientLabels();
  try { if (current) resetView(true); } catch (e) {}
  drawOverlay();
}
function orientLabels() {
  const o = dualOn && dualActive===2 ? secondaryView : orientNow();
  const mark = (id, on) => {
    const el = $(id);
    if (!el) return;
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.style.background = on ? "var(--accent)" : "";
    el.style.color = on ? "#0f172a" : "";
    el.style.borderColor = on ? "var(--accent)" : "";
  };
  mark("orient-invert", o.invert);
  mark("orient-fliph", o.flipH);
  mark("orient-flipv", o.flipV);
  const rb = $("orient-rotate");
  if (rb) rb.textContent = (LANG === "en" ? "Rotate " : "تدوير ") + o.rotate + "\u00b0";
}
function orientWire() {
  const bind = (id, fn) => { const el = $(id); if (el && !el.__orient) { el.__orient = 1; el.addEventListener("click", fn); } };
  bind("orient-invert", () => { vst({ type: "toggleInvert" }); orientChanged(); });
  bind("orient-rotate", () => { vst({ type: "rotate90" }); orientChanged(); });
  bind("orient-fliph", () => { vst({ type: "toggleFlip", axis: "h" }); orientChanged(); });
  bind("orient-flipv", () => { vst({ type: "toggleFlip", axis: "v" }); orientChanged(); });
  bind("orient-reset", () => { vst({ type: "resetOrientation" }); orientChanged(); });
  orientLabels();
}
function measureOut() {
  if(dualOn&&dualActive===2){secondaryReadout();return;}
  const out = $("measure-out");
  if (!out) return;
  if (!measureMode) { out.textContent = ""; return; }
  const n = (mItems.segments || []).length + (mItems.angles || []).length + (mItems.rois || []).length + (mItems.rects || []).length;
  const hints = LANG === "en"
    ? { seg: "Tap two points for each segment", angle: "Tap 3 points: side, vertex, side", roi: "Tap center then ellipse edge", rect: "Tap two corners of the rectangle", probe: "Tap any pixel to read its value" }
    : { seg: "انقر نقطتين لكل قطعة", angle: "انقر 3 نقاط: ضلع ثم رأس ثم ضلع", roi: "انقر المركز ثم حافة القطع الناقص", rect: "انقر زاويتين للمستطيل", probe: "انقر أي بكسل لقراءة قيمته" };
  out.textContent = hints[mMode] + (n ? " — محفوظ: " + n : "") +
    (mMode === "probe" && mProbe ? " — " + probeText(mProbe) : "");
}


/** Worklist filtering is presentation-only; never merges patients or changes records. */
export function worklistText(value){
 return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[٠-٩]/g,x=>String(x.charCodeAt(0)-1632)).replace(/[۰-۹]/g,x=>String(x.charCodeAt(0)-1776)).replace(/\^/g,' ').replace(/\b(\d{4})[-/.](\d{2})[-/.](\d{2})\b/g,'$1$2$3').toLocaleLowerCase().trim();
}
export function worklistPriority(s){return s.consult?'consult':s.triage?.priority==='urgent'?'urgent':'routine';}
export function selectWorklistStudies(studies,filter={}){
 const words=worklistText(filter.query).slice(0,256).split(/\s+/).filter(Boolean),priority=s=>worklistPriority(s);
 const found=studies.filter(s=>{
  const p=priority(s),mod=String(s.modality||'').toUpperCase();
  if(filter.critical&&p!=='urgent'&&p!=='consult')return false;
  if(filter.modality&&mod!==filter.modality)return false;
  if(filter.priority&&p!==filter.priority)return false;
  if(filter.state==='signed'&&!s.signedBy)return false;
  if(filter.state==='unsigned'&&s.signedBy)return false;
  if(!words.length)return true;
  const date=String(s.meta?.studyDate||''),search=worklistText([s.meta?.patientName,s.patient,s.description,s.meta?.studyDesc,s.bodyPart,s.meta?.bodyPart,s.modality,date,date.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),...(s.series||[]).flatMap(x=>[x.description,x.label]),...(s.frames||[]).map(f=>f.seq?.seriesDescription)].join(' '));
  return words.every(w=>search.includes(w));
 });
 const created=s=>Number(s.created)||0,studyDate=s=>dateKey(s.meta?.studyDate)||0;
 return found.slice().sort((a,b)=>{
  let diff=0;
  if(filter.sort==='name')diff=worklistText(a.meta?.patientName||a.patient).localeCompare(worklistText(b.meta?.patientName||b.patient));
  else if(filter.sort==='study')diff=studyDate(b)-studyDate(a);
  else if(filter.sort!=='date')diff=({urgent:0,consult:1,routine:2}[priority(a)]-({urgent:0,consult:1,routine:2}[priority(b)]));
  return diff||created(b)-created(a)||String(a.uid).localeCompare(String(b.uid));
 });
}
let worklistRefreshSerial=0,worklistFullReadSerial=0,worklistCachedStudies=null,worklistSessionSort=null;
function worklistFilters(sort){return {query:$('wl-query')?.value||'',modality:$('wl-modality')?.value||'',priority:$('wl-priority')?.value||'',state:$('wl-state')?.value||'',sort,critical:critOnly()};}
function setupWorklist(){
 const q=$('wl-query');if(!q||q.__wired)return;q.__wired=true;
 const mobileCards=matchMedia('(max-width:600px)');
 mobileCards.addEventListener('change',()=>{for(const d of document.querySelectorAll('.wl-study-details'))d.open=!mobileCards.matches;});
 const fold=$('wl-options');
 try{fold.open=localStorage.getItem('rrai-worklist-options-open')==='1';}catch(e){}
 fold.addEventListener('toggle',()=>{try{localStorage.setItem('rrai-worklist-options-open',fold.open?'1':'0');}catch(e){}});
 let timer;q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>refresh({worklistOnly:true}),120);});
 for(const id of ['wl-modality','wl-priority','wl-state'])$(id).addEventListener('change',()=>refresh({worklistOnly:true}));
 $('wl-sort').addEventListener('change',()=>{worklistSessionSort=$('wl-sort').value;try{localStorage.setItem('rrai-sort',$('wl-sort').value);}catch(e){}if($('sort-sel'))$('sort-sel').value=$('wl-sort').value;refresh({worklistOnly:true});});
 $('wl-clear').onclick=()=>{clearTimeout(timer);for(const id of ['wl-query','wl-modality','wl-priority','wl-state'])$(id).value='';try{localStorage.setItem('rrai-crit-only','0');}catch(e){}refresh({worklistOnly:true});updDrawer();q.focus();};
}
function worklistMeta(studies,visible,sort){
 const mod=$('wl-modality'),selected=mod.value,values=[...new Set(studies.map(s=>String(s.modality||'').toUpperCase()).filter(Boolean))].sort();
 mod.replaceChildren(new Option(LANG==='en'?'All modalities':'كل الأنواع',''));
 for(const m of values)mod.add(new Option(m,m));
 // Keep a selected absent modality visible, so a zero-result filter never silently changes.
 if(selected&&!values.includes(selected))mod.add(new Option(selected,selected));mod.value=selected;
 $('wl-sort').value=sort;
 const filters=worklistFilters(sort),active=!!(filters.query.trim()||filters.modality||filters.priority||filters.state||filters.critical);
 $('wl-active-filter').hidden=!active;$('wl-active-filter').textContent=LANG==='en'?' · Filters active':' · تصفية مفعّلة';
 $('wl-count').textContent=LANG==='en'?`Showing ${visible} of ${studies.length} studies`:`يعرض ${visible} من ${studies.length} دراسة`;
 const alert=$('wl-critical-note');alert.hidden=!critOnly();alert.textContent=LANG==='en'?'Critical-only worklist filter is on. Clear filters to show all priorities.':'فلتر القائمة الحرجة مفعّل. امسح عوامل التصفية لعرض كل الأولويات.';
 const empty=$('empty');empty.style.display=visible?'none':'block';empty.textContent=studies.length?(LANG==='en'?'No matching studies. Clear search or filters.':'لا توجد دراسات مطابقة. امسح البحث أو عوامل التصفية.'):(LANG==='en'?'No studies — import DICOM files or generate a demo.':'لا توجد دراسات — ارفع DICOM أو ولّد ديمو.');
 $('worklist').hidden=!visible;
}
function addWorklistDescription(cell,study){
 if(study.patient&&study.meta?.patientName&&worklistText(study.patient)!==worklistText(study.meta.patientName)){
  const id=document.createElement('div');id.className='wl-description';id.dir='auto';id.textContent=(LANG==='en'?'ID: ':'المعرّف: ')+String(study.patient);cell.appendChild(id);
 }
 const desc=String(study.meta?.studyDesc||study.description||study.bodyPart||study.meta?.bodyPart||'').trim();
 if(desc){const d=document.createElement('div');d.className='wl-description';d.textContent=desc;cell.appendChild(d);}
 const series=ensureSeries(study);if(!series.length)return;
 const details=document.createElement('details');details.className='wl-series';const sum=document.createElement('summary');sum.textContent=(LANG==='en'?'Series: ':'السلاسل: ')+series.length;details.appendChild(sum);
 const list=document.createElement('ul');
 for(const s of series){const li=document.createElement('li');const name=String(s.description||s.label||(LANG==='en'?'Series ':'سلسلة ')+(s.number||'?'));li.textContent=name+' · '+(s.indices?.length||0)+(LANG==='en'?' images':' صورة');list.appendChild(li);}
 details.appendChild(list);cell.appendChild(details);
}

/* ---- UI wiring ---- */
const $ = (id) => (typeof document !== "undefined" && document.getElementById ? document.getElementById(id) : null);

export async function refresh(options={}) {
  purgeOnceSoon();
  const preferredSort=worklistSessionSort||(()=>{try{return localStorage.getItem("rrai-sort")||"urgent";}catch(e){return "urgent";}})();
  const sortMode=["urgent","date","study","name"].includes(preferredSort)?preferredSort:"urgent";
  const serial=++worklistRefreshSerial;
  const fullRead=!(options.worklistOnly&&worklistCachedStudies);
  const readSerial=fullRead?++worklistFullReadSerial:worklistFullReadSerial;
  const studies=fullRead?await allStudies():worklistCachedStudies;
  if(fullRead&&readSerial!==worklistFullReadSerial)return;
  if(fullRead)worklistCachedStudies=studies;
  if(serial!==worklistRefreshSerial){if(fullRead)refresh({worklistOnly:true});return;}
  const visible=selectWorklistStudies(studies,worklistFilters(sortMode));
  worklistMeta(studies,visible.length,sortMode);
  const body = document.querySelector("#worklist tbody");
  body.innerHTML = "";
  for (const [studyIndex,s] of visible.entries()) {
    const tr = document.createElement("tr");
    tr.setAttribute('role','row');
    for (let i = 0; i < 6; i++) {const cell=document.createElement('td');cell.setAttribute('role','cell');cell.dataset.label=[$('th-patient').textContent,$('th-mod').textContent,$('th-date').textContent,$('th-pri').textContent,$('th-slices').textContent,LANG==='en'?'Actions':'إجراءات'][i];tr.appendChild(cell);}
    const name=document.createElement('div');name.className='wl-name';name.dir='auto';
    name.textContent = (s.meta && s.meta.patientName) || s.patient || "—";name.title=name.textContent;
    const nameRow=document.createElement('div');nameRow.className='wl-name-row';
    const number=document.createElement('span');number.className='wl-number';number.dir='ltr';number.textContent=String(studyIndex+1);
    number.setAttribute('aria-label',(LANG==='en'?'Study number ':'رقم الدراسة ')+(studyIndex+1));
    number.title=LANG==='en'?'Position in the displayed list':'الترتيب في القائمة المعروضة';
    nameRow.append(number,name);tr.children[0].appendChild(nameRow);
    const extra=document.createElement('details');extra.className='wl-study-details';extra.open=!matchMedia('(max-width:600px)').matches;
    const more=document.createElement('summary');more.textContent=LANG==='en'?'Details':'التفاصيل';extra.appendChild(more);
    const info=document.createElement('div');info.className='wl-study-info';extra.appendChild(info);
    if (s.signedBy) { const sb = document.createElement("span"); sb.className = "badge signed"; sb.textContent = LANG === "en" ? "signed" : "موقّع"; tr.children[0].appendChild(sb); }
    { const sum = seriesSummary(s);
      if (sum) { const sd = document.createElement("div"); sd.className = "treason"; sd.textContent = sum; sd.style.opacity = ".8"; info.appendChild(sd); } }
    addWorklistDescription(info,s);
    tr.children[1].textContent = s.modality||"—";
    const dTxt = fmtDicomDate(s.meta && s.meta.studyDate, s.meta && s.meta.studyTime);
    tr.children[2].textContent = dTxt || "—";
    if (!dTxt) tr.children[2].style.opacity = ".55";
    tr.children[2].dir = "ltr";
    tr.children[2].title = LANG === "en" ? "Study date (from DICOM)" : "تاريخ الدراسة (من ملف DICOM)";
    const badge = document.createElement("span");
    const priority = s.triage?.priority || "routine";
    badge.className = "badge " + priority;
    badge.textContent = priLabel(s.consult ? "consult" : priority);
    if (s.consult) badge.className = "badge consult";
    tr.children[3].appendChild(badge);
    const rsn = document.createElement("div");
    rsn.className = "treason";
    const r0 = (s.triage && s.triage.reasons && s.triage.reasons[0]) || "";
    rsn.textContent = LANG === "en" ? (REASON_EN[r0] || r0) : r0;
    rsn.title = ((s.triage && s.triage.reasons) || []).map((x) => LANG === "en" ? (REASON_EN[x] || x) : x).join(" | ");
    tr.children[3].appendChild(rsn);
    tr.children[4].textContent = (s.frames||[]).length;
    try {
      let badN = s.pixelBad;
      if (typeof badN !== "number") {
        badN = 0;
        for (const fr of (s.frames || [])) { if (pixelProblem(fr)) badN++; }
        s.pixelBad = badN;
      }
      if (badN > 0) {
        const wb = document.createElement("div");
        wb.className = "treason";
        wb.dataset.status="warning";
        wb.style.color = "#fca5a5";
        wb.textContent = (LANG === "en" ? "⚠ " + badN + " blank" : "⚠ " + badN + " بلا بكسل");
        wb.title = LANG === "en" ? "This study holds frames with no drawable pixel data" : "هذه الدراسة تحوي إطارات بلا بيانات بكسل قابلة للعرض";
        tr.children[4].appendChild(wb);
      }
    } catch (e) {}
    const meta=document.createElement('div');meta.className='wl-card-meta';
    const brief=document.createElement('span');brief.dir='auto';
    brief.textContent=[s.modality||'—',dTxt?dTxt.split(' ')[0]:'—',(s.frames||[]).length+(LANG==='en'?' images':' صورة')].join(' · ');
    meta.appendChild(brief);meta.appendChild(badge.cloneNode(true));
    const warning=tr.children[4].querySelector('[data-status="warning"]');if(warning)meta.appendChild(warning.cloneNode(true));
    tr.children[0].appendChild(meta);
    const fullDate=document.createElement('div');fullDate.className='wl-mobile-only wl-description';fullDate.textContent=(LANG==='en'?'Study date: ':'تاريخ الدراسة: ')+(dTxt||'—');info.appendChild(fullDate);
    if(rsn.textContent){const reason=rsn.cloneNode(true);reason.classList.add('wl-mobile-only');info.appendChild(reason);}
    tr.children[0].appendChild(extra);
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = LANG === "en" ? "View" : "عرض";
    btn.onclick = () => openStudy(s);
    tr.children[5].appendChild(btn);
    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "✕";
    del.title = LANG==="en"?"Delete study from this device":"حذف الدراسة من الجهاز";
    del.setAttribute("aria-label",del.title);
    del.style.marginInlineStart = ".3rem";
    del.style.padding = ".2rem .5rem";
    del.onclick = async () => {
      if (!confirm(LANG==="en"?"Delete study "+(s.meta?.patientName||s.patient||"")+" from this device?":"حذف دراسة "+(s.meta?.patientName||s.patient||"")+" من هذا الجهاز؟")) return;
      await txDel(s.uid);
      if (current && current.uid === s.uid) current = null;
      await refresh();
    };
    tr.children[5].appendChild(del);
    body.appendChild(tr);
  }
  try {
    const urgNow = studies.filter((x) => (x.triage && x.triage.priority === "urgent") || x.consult).map((x) => x.uid);
    let seenU = [];
    try { seenU = JSON.parse(localStorage.getItem("rrai-urgent-seen") || "[]"); } catch (e2) {}
    const seenSet = new Set(seenU);
    const fresh = urgNow.filter((u) => !seenSet.has(u));
    if (fresh.length) setStatus((LANG === "en" ? "⚠ New urgent cases in worklist: " : "⚠ حالات حرجة جديدة في القائمة: ") + fresh.length, true);
    if (fresh.length) { try { if (localStorage.getItem("rrai-crit-alert") === "1") critBeep(); } catch (e3) {} }
    localStorage.setItem("rrai-urgent-seen", JSON.stringify(urgNow.slice(0, 200)));
  } catch (e2) {}
}

async function openStudy(study) {
  /* v147 — callers have passed a UID before. Resolve it rather than throwing:
     a study that is already on the device must simply open. */
  if (typeof study === "string") {
    try {
      const all3 = await allStudies();
      study = all3.find((x) => x && x.uid === study) || null;
    } catch (e) { study = null; }
  }
  if (!study || typeof study !== "object") return;
  if(aiJob||aiProbe)aiCancel();
  vrClose();
  applyDxFoot();
  current = study;
  try {
    const fixedN = coerceFrames(study);
    if (fixedN) { putStudy(study); study.pixelFixed = fixedN; }
  } catch (e) {}
  try { const dw2 = localStorage.getItem("rrai-default-win"); if (dw2 && $("preset")) $("preset").value = dw2; } catch (e) {}
  try {
  const pl = $("prior-line");
  if (pl) {
    const pn = String((study.meta && study.meta.patientName) || "").toUpperCase();
    const allNow = await allStudies();
    const others = allNow.filter((x) => x.uid !== study.uid && pn && String((x.meta && x.meta.patientName) || "").toUpperCase() === pn);
    let arch = [];
    try { arch = pn ? archiveLoad().filter((e) => String(e.patient || "").toUpperCase() === pn) : []; } catch (e) {}
    const parts = [];
    if (others.length) parts.push((LANG === "en" ? "other studies on device: " : "دراسات أخرى للمريض على الجهاز: ") + others.map((x) => x.modality + " " + String((x.meta && x.meta.studyDate) || "").slice(0, 10)).join("، "));
    if (arch.length) parts.push((LANG === "en" ? "archived report(s): " : "وتقرير محفوظ بالأرشيف: ") + arch.map((e) => String(e.ts).slice(0, 10)).join("، "));
    pl.textContent = parts.length ? "📁 " + parts.join(" • ") : "";
    pl.style.display = parts.length ? "block" : "none";
    pl.dataset.uid = others.length ? others[0].uid : "";
  }
  } catch (e) { const plx = $("prior-line"); if (plx) { plx.style.display = "none"; } }
  prefillComposer(study);
  renderBank(study);
  { const ss0 = ensureSeries(study);
    /* v147 — series are ordered by SeriesNumber, which can put a one-image
       series (a scout, a dose page) ahead of the acquisition the physician came
       for: the study then looks empty and the slice bar sits dead at 1/1. Open
       the series that carries the most frames. */
    currentSeries = 0;
    if (ss0.length > 1) {
      let bi = 0, bn = -1;
      for (let i = 0; i < ss0.length; i++) {
        const n = (ss0[i].indices || []).length;
        if (n > bn) { bn = n; bi = i; }
      }
      currentSeries = bi;
    }
    const n0 = ss0.length ? ((ss0[currentSeries].indices || []).length || study.frames.length) : study.frames.length;
    const sl0 = $("slice"); if (sl0) { sl0.max = String(Math.max(0, n0 - 1)); sl0.value = "0"; }
    /* v147 — one row per series in the viewer state: the hanging, the slice
       count and the cine loop all read it from there. */
    try {
      const rows0 = ss0.map((s2, i2) => ({
        id: String(i2),
        label: (seqLabelOf(s2 && s2.seq, study.modality) || {}).label || "",
        modality: study.modality || "",
        count: (s2 && s2.indices ? s2.indices.length : 0),
        w: 0, h: 0, spacing: null, reslice: false, reason: "",
      }));
      vst({ type: "studyLoaded", studyId: study.uid || "", series: rows0, seriesId: String(currentSeries) });
    } catch (e4) {} }
  mprVol = null; mprKey = "";
  renderSeriesBar();
  try { if (localStorage.getItem("rrai-all-on") === "1" && !allOn) allToggle(true); } catch (e) {}
  if (allOn) renderAll();
  viewKey = "";
  $("frame").style.display = "block";
  $("report-ar").style.display = "none";
  $("report-en").style.display = "none";
  reportExportStudyChanged(study);
  vrRefresh();
  show(0);
}

function frameStats(px) {
  const d = px && px.data;
  const info = (px && px.info) || null;
  const need = px ? (px.w || 0) * (px.h || 0) : 0;   /* samples, like data.length */
  if (!d || !d.length) return { min: 0, max: 0, len: d ? d.length : 0, need, flat: true, distinct: 0 };
  let mn = Infinity, mx = -Infinity;
  const step = Math.max(1, Math.floor(d.length / 20000));
  const seen = new Set();
  for (let i = 0; i < d.length; i += step) {
    if (d[i] < mn) mn = d[i];
    if (d[i] > mx) mx = d[i];
    if (seen.size < 8) seen.add(d[i]);
  }
  return {
    min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx,
    len: d.length, need, flat: !(mx > mn) || d.length < need, distinct: seen.size,
  };
}

/* ---- a frame that cannot be drawn must say so, never render as black ---- */
/** "" when drawable, else a short code: noframe | empty | short | flat. */
export function pixelProblem(px) {
  if (!px || !px.w || !px.h) return "noframe";
  const d = px.data;
  if (!d || !d.length) return "empty";
  const need = px.w * px.h;            /* samples — never bytes (see v147) */
  if (d.length < need) return "short";
  const st = frameStats(px);
  if (st.flat) return "flat";
  return "";
}
/** Human sentence for the problem, with the numbers that explain it. */
export function pixelProblemText(px, lang) {
  const code = pixelProblem(px);
  if (!code) return "";
  const en = lang === "en";
  const info = (px && px.info) || {};
  const nums = " [len=" + ((px && px.data) ? px.data.length : 0) +
    " need=" + ((px && px.w && px.h) ? px.w * px.h : 0) +
    " bytes=" + (info.haveBytes == null ? "?" : info.haveBytes) + "/" + (info.bytes || "?") +
    " bits=" + (info.bitsAllocated == null ? "?" : info.bitsAllocated) +
    " ts=" + (info.tsuid || "?") + "]";
  if (code === "noframe") return (en ? "No frame to draw." : "لا يوجد إطار للرسم.") + nums;
  if (code === "empty") return (en ? "This file carries no pixel data — there is nothing to display." : "هذا الملف لا يحمل بيانات بكسل — لا شيء لعرضه.") + nums;
  if (code === "blank") return (en ? "The image renders blank: one value fills over half the frame, so the 2–98% window collapses." : "الصورة تُرسم فارغة: قيمة واحدة تملأ أكثر من نصف الإطار فتنهار النافذة (٢–٩٨٪).") + nums;
  if (code === "short") return (en ? "The pixel data is truncated — the file is incomplete." : "بيانات البكسل ناقصة — الملف غير مكتمل.") + nums;
  return (en ? "The pixel data is uniform (min = max) — the image would be blank." : "بيانات البكسل متطابقة (المدى = صفر) — الصورة ستكون فارغة.") + nums;
}
/** Did the blit actually reach the canvas? Distinguishes "no data" from "no paint". */
export function paintReadback(canvas, minPixels) {
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return { ok: false, spread: 0, note: "no-context" };
    /* v147 — this used to read only the top-left 64x64 corner. In a head CT that
       corner is air: every sampled pixel the same black, so the viewer told the
       physician the image had not reached the screen while it was on screen in
       front of them. Read the whole frame, spread out over all of it. */
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const step = Math.max(1, Math.floor((canvas.width * canvas.height) / 8000)) * 4;
    let mn = 255, mx = 0, n = 0;
    for (let j = 0; j < d.length; j += step) { const g = d[j]; if (g < mn) mn = g; if (g > mx) mx = g; n++; }
    return { ok: true, spread: mx - mn, note: mx === mn ? "uniform" : "ok", sampled: n };
  } catch (e) {
    return { ok: false, spread: 0, note: "readback-failed: " + String((e && e.message) || e) };
  }
}

/** Everything needed to debug a frame, in plain text: one screenshot says it all. */
export function diagLines(f, extra) {
  if (!f) return [];
  const st = frameStats(f);
  const info = f.info || {};
  const ss = current ? ensureSeries(current) : [];
  const si = current ? currentSeries : 0;
  const n = current ? activeFrames().length : 0;
  const w = f.__win || null;
  const out = [
    APP_BUILD + " • " + (LANG === "en" ? "series " : "سلسلة ") + (si + 1) + "/" + Math.max(1, ss.length) +
      " • " + (LANG === "en" ? "slice " : "شريحة ") + (sliceIdx() + 1) + "/" + (n || (current ? current.frames.length : 0)),
    f.w + "x" + f.h + " • len=" + (st.len || 0) + "/" + (st.need || (f.w * f.h) || "?"),
    "px=" + st.min + "\u2026" + st.max + " • bits=" + (info.bitsAllocated == null ? "?" : info.bitsAllocated) +
      " • ts=" + (info.tsuid || "?"),
    "win=" + (w ? Math.round(w.lo) + "\u2026" + Math.round(w.hi) : "auto") +
      " • grey=" + (f.__spread == null ? "?" : f.__spread) +
      " • mode=" + (f.__mode == null ? "?" : Math.round(f.__mode * 100) + "%"),
    "fit=" + fitK.toFixed(2) + " • preset=" + presetVal(),
    "paint=" + (lastPaint ? (lastPaint.ok ? lastPaint.note + "/" + lastPaint.spread : lastPaint.note) : "?"),
  ];
  if (extra) out.push(String(extra));
  return out;
}

/** Draw the reason on the canvas itself: a black rectangle tells the user nothing. */
function drawReasonPlate(canvas, pixels, code) {
  const w = Math.max(64, (pixels && pixels.w) || 256);
  const h = Math.max(64, (pixels && pixels.h) || 256);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = Math.max(2, Math.round(w / 220));
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
  const lines = [
    LANG === "en" ? "NO IMAGE DATA" : "لا توجد بيانات صورة",
    pixelProblemText(pixels, LANG),
    (LANG === "en" ? "Re-import the original DICOM files. " : "أعد استيراد ملفات DICOM الأصلية. ") + APP_BUILD,
  ].concat(diagLines(pixels));
  const fs = Math.max(11, Math.min(26, Math.round(w / 24)));
  ctx.font = fs + "px system-ui, Tahoma, sans-serif";
  ctx.textBaseline = "top";
  const pad = Math.round(w * 0.07);
  let y = Math.round(h * 0.2);
  for (const raw of lines) {
    const words = String(raw).split(" ");
    let line = "";
    const flush = () => {
      if (!line) return;
      ctx.fillStyle = line === lines[0] ? "#f59e0b" : "#e2e8f0";
      ctx.fillText(line, pad, y);
      y += Math.round(fs * 1.5);
      line = "";
    };
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > w - pad * 2 && line) { flush(); line = wd; } else { line = test; }
    }
    flush();
    y += Math.round(fs * 0.4);
  }
  ctx.restore();
}
/** One-tap report the user can paste into a message: no guessing from screenshots. */
function copyDiagnostics(px) {
  const info = (px && px.info) || {};
  const study = current || {};
  const ss = (ensureSeries(study) || []).map((x) => (x.label || "?") + ":" + (x.indices || []).length).join(", ");
  const txt = [
    "Radiology report AI " + APP_BUILD,
    "problem=" + pixelProblem(px),
    "study=" + (study.uid || ""),
    "patient=" + ((study.meta && study.meta.patientName) || study.patient || ""),
    "modality=" + (study.modality || ""),
    "frames=" + ((study.frames || []).length) + " series=[" + ss + "]",
    "w=" + (px && px.w) + " h=" + (px && px.h),
    "len=" + ((px && px.data) ? px.data.length : 0) + " need=" + (info.need || "") + " bpp=" + (info.bpp || ""),
    "bits=" + (info.bitsAllocated == null ? "?" : info.bitsAllocated) + " signed=" + (info.signed || false) +
      " photometric=" + (info.photometric || "") + " encapsulated=" + (info.encapsulated || false),
    "ts=" + (info.tsuid || "") + " slope=" + (info.slope || 1) + " intercept=" + (info.intercept || 0),
    "min=" + (px ? frameStats(px).min : "") + " max=" + (px ? frameStats(px).max : ""),
    "compressedStudy=" + (study.compressedSrc ? (study.compressedSrc.tsuid || "yes") : "no"),
  ].join("\n");
  const done = () => setStatus(LANG === "en" ? "Diagnostics copied — paste it in the chat." : "نُسخ التشخيص — الصقه في المحادثة.");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, () => { try { prompt(LANG === "en" ? "Copy this:" : "انسخ هذا:", txt); } catch (e) {} });
      return;
    }
  } catch (e) {}
  try { prompt(LANG === "en" ? "Copy this:" : "انسخ هذا:", txt); } catch (e) {}
}
/* A viewer that shows nothing must say why, on its own, without a setting.
   Everything here is measured from the live DOM: how big the canvas is on
   screen, what style it ended up with, what element is actually on top of it,
   and what the canvas reads back after the draw. */
function canvasAudit(f) {
  const cv = $("frame"), vp = $("viewport");
  if (!cv) return null;
  let r = null, cs = null, vpr = null;
  try { r = cv.getBoundingClientRect(); } catch (e) {}
  try { cs = getComputedStyle(cv); } catch (e) {}
  try { vpr = vp ? vp.getBoundingClientRect() : null; } catch (e) {}
  const rb = paintReadback(cv);
  const st = f ? frameStats(f) : { min: "?", max: "?", len: 0, need: "?" };
  const why = [];
  if (!r || r.width < 8 || r.height < 8) why.push("no-size");
  if (cs && (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05)) why.push("hidden");
  if (!f) why.push("no-frame");
  if (f && (!rb.ok || rb.spread < 2)) why.push("uniform");
  let topEl = "";
  try {
    if (r && r.width > 8 && r.height > 8) {
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      topEl = el ? String(el.id || (el.tagName || "?").toLowerCase()) : "none";
      if (topEl && ["frame", "overlay", "annot", "vwrap", "viewport", "none"].indexOf(topEl) < 0) why.push("covered:" + topEl);
      /* v147 — a layer that is allowed on top can still be opaque: an overlay
         canvas carrying its own background colour paints a solid sheet over the
         image. That was the black-screen bug; it must be named, not guessed. */
      if (el && el.tagName === "CANVAS" && el.id && el.id !== "frame") {
        const cs2 = getComputedStyle(el);
        const bg = cs2 ? String(cs2.backgroundColor || "") : "";
        const clear = !bg || bg === "transparent" || /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(bg);
        if (!clear) why.push("opaque:" + el.id);
      }
    }
  } catch (e) {}
  return {
    why: why,
    rect: r ? (Math.round(r.width) + "x" + Math.round(r.height)) : "?",
    css: ((cv.style && cv.style.width) || "?") + "x" + ((cv.style && cv.style.height) || "?"),
    bmp: cv.width + "x" + cv.height,
    vp: vpr ? (Math.round(vpr.width) + "x" + Math.round(vpr.height)) : "?",
    disp: cs ? [cs.display, cs.visibility, cs.opacity, cs.position].join("/") : "?",
    top: topEl || "?",
    paint: rb.ok ? rb.note + "/" + rb.spread : rb.note,
    vals: st.min + ".." + st.max + " len=" + st.len + "/" + (st.need || "?"),
    mode: mprOn ? (mprMax ? "mpr-max:" + mprMax : "mpr") : "single",
  };
}
function auditText(a) {
  const en = LANG === "en";
  return [
    (en ? "The image did not reach the screen. Why: " : "الصورة لم تصل إلى الشاشة. السبب: ") + (a.why.join(", ") || "?"),
    (en ? "canvas on screen: " : "الكانفاس على الشاشة: ") + a.rect + (en ? " · css: " : " · المُحدَّد: ") + a.css +
      (en ? " · bitmap: " : " · الصورة النقطية: ") + a.bmp + (en ? " · viewport: " : " · إطار العرض: ") + a.vp,
    (en ? "style: " : "النمط: ") + a.disp + (en ? " · topmost element: " : " · العنصر الأعلى: ") + a.top,
    (en ? "readback: " : "القراءة المرتدة: ") + a.paint + (en ? " · values: " : " · القيم: ") + a.vals,
    (en ? "mode: " : "النمط: ") + a.mode + " · " + APP_BUILD,
  ].join("\n");
}
/** A canvas with no size on screen can never show anything: put it back in flow. */
function repairCanvas(cv) {
  try {
    cv.style.position = "relative";
    cv.style.inset = "auto";
    cv.style.left = "auto";
    cv.style.top = "auto";
    cv.style.width = "100%";
    cv.style.height = "auto";
    cv.style.margin = "0 auto";
    cv.style.display = "block";
    const wr = $("vwrap");
    if (wr) { wr.style.width = "100%"; wr.style.height = "auto"; wr.style.margin = "0 auto"; }
    const ov = $("overlay");
    if (ov) { ov.style.position = "absolute"; ov.style.inset = "0"; ov.style.width = "100%"; ov.style.height = "100%"; ov.style.left = "auto"; ov.style.top = "auto"; ov.style.background = "transparent"; }
    const an = $("annot");
    if (an) an.style.background = "transparent";
    return true;
  } catch (e) { return false; }
}
function showAuditNote(a) {
  const box = $("img-note"), txt = $("img-note-text"), btn = $("img-note-copy");
  if (!box || !txt) return;
  const body = auditText(a);
  box.style.display = "block";
  txt.textContent = body;
  if (btn) {
    btn.style.display = "inline-block";
    btn.textContent = LANG === "en" ? "Copy this report" : "نسخ هذا التقرير";
    btn.onclick = () => {
      let ok = false;
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(body); ok = true; } } catch (e) {}
      if (!ok) { try { const ta = document.createElement("textarea"); ta.value = body; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch (e2) {} }
      setStatus(ok ? (LANG === "en" ? "Report copied — paste it in the chat." : "نُسخ التقرير — الصقه في المحادثة.")
                   : (LANG === "en" ? "Report shown above — long-press to copy." : "التقرير معروض أعلاه — اضغط مطولًا للنسخ."), !ok);
    };
  }
}
function showPixelNote(px) {
  const box = $("img-note");
  if (!box) return;
  const code = pixelProblem(px) || ((px && px.__blank) ? "blank" : "");
  const txt = $("img-note-text"), btn = $("img-note-copy");
  if (!code) { box.style.display = "none"; if (txt) txt.textContent = ""; if (btn) btn.style.display = "none"; return; }
  box.style.display = "block";
  if (txt) txt.textContent = pixelProblemText(px, LANG) +
    (LANG === "en" ? "  — tap “Copy diagnostics” below." : "  — اضغط «Copy diagnostics» بالأسفل.");
  if (btn) {
    btn.style.display = "inline-block";
    btn.textContent = LANG === "en" ? "Copy diagnostics" : "نسخ التشخيص";
    btn.onclick = () => copyDiagnostics(px);
  }
}

function show(idx) {
  if (!current) return;
  const frames = activeFrames();
  if (!frames.length) return;
  vst({ type: "setSlice", index: idx, total: frames.length, keepCine: !!cineT });
  {
    const fc = $("fs-count");
    if (fc) fc.textContent = (idx + 1) + " / " + frames.length;
  }
  renderFilmstrip();
  loadPrimaryMeasures(idx);
  dualRender();
  sessionBarUpdate(idx);
  renderSeriesOverview(idx);
  const f0 = frames[idx] || current.frames[0];
  let drawErr = "";
  try {
    drawFrame($("frame"), f0, presetVal(), current.modality);
  } catch (e) {
    drawErr = String((e && e.message) || e);
  }
  const directRender = (tag) => {
    try {
      const cv = $("frame");
      cv.width = f0.w; cv.height = f0.h;
      const cx = cv.getContext("2d");
      const st2 = frameStats(f0);
      const img2 = cx.createImageData(f0.w, f0.h);
      const dd = f0.data, lo2 = st2.min, hi2 = st2.max;
      for (let i = 0; i < f0.w * f0.h; i++) {
        let v = (dd[i] - lo2) / ((hi2 - lo2) || 1);
        v = Math.max(0, Math.min(1, v));
        const g = (v * 255) | 0;
        img2.data[i * 4] = g; img2.data[i * 4 + 1] = g; img2.data[i * 4 + 2] = g; img2.data[i * 4 + 3] = 255;
      }
      cx.putImageData(img2, 0, 0);
      return tag;
    } catch (e2) { return tag + "+فشل2"; }
  };
  if (drawErr) directRender("استبدال");
  const cvF = $("frame");
  cvF.style.transform = "none";
  cvF.style.display = "block";
  const ovv = $("overlay");
  ovv.style.transform = "none";
  ovv.style.background = "transparent";
  ovv.style.pointerEvents = "none";
  cvF.style.touchAction = "none";
  const vp2 = $("viewport");
  if (vp2) { vp2.style.touchAction = "none"; vp2.style.pointerEvents = "auto"; }
  const vp = $("viewport");
  if (vp) vp.style.background = "transparent";
  const ov = $("overlay");
  if (ov.width !== f0.w) ov.width = f0.w;
  if (ov.height !== f0.h) ov.height = f0.h;
  $("viewport").style.display = "block";
  { const rb2 = $("redraw-btn"); if (rb2) { rb2.style.display = "inline-block"; if (!rb2.__wired) { rb2.__wired = 1; rb2.addEventListener("click", () => { try { viewKey = ""; resetView(true); show(sliceIdx()); setStatus(LANG === "en" ? "Redrawn." : "أُعيد الرسم.", false); } catch (e) {} }); } } }
  if ($("viewer-name")) $("viewer-name").style.display = "block";
  mPts = [];
  drawOverlay();
  measureOut();
  const vKey = f0.w + "x" + f0.h;
  if (viewKey !== vKey) { viewKey = vKey; resetView(true, f0); } else { applyView(); }
  const pnShow = shownName((current.meta && current.meta.patientName) || current.patient || "—");
  const vnm = $("viewer-name");
  if (vnm) vnm.textContent = pnShow + " • " + ((current.meta && current.meta.sex) || "—") + " " + ((current.meta && current.meta.age) || "") + " • " + (fmtDicomDate(current.meta && current.meta.studyDate, current.meta && current.meta.studyTime) || ((current.meta && current.meta.studyDate) || "")) + " • " + current.modality + " • " + APP_BUILD;
  $("meta").textContent =
    `${pnShow} • ${current.modality} • ${LANG === "en" ? "slice " + (idx + 1) + " of " + frames.length : "شريحة " + (idx + 1) + " من " + frames.length} • ${current.description || ""} • ${APP_BUILD} • ${LANG === "en" ? "fit=" : "ملاءمة="}${fitK.toFixed(2)}`;
  try {
    const ssN = ensureSeries(current).length;
    if (frames.length < 2 && ssN > 1) {
      /* v147 — a dead slice bar is a defect, not a mystery: say which series to use. */
      $("meta").textContent += LANG === "en"
        ? " • this series is a single image — pick another series to scroll"
        : " • هذه السلسلة صورة واحدة — اختر سلسلة أخرى للتنقل بين الشرائح";
    }
  } catch (e) {}
  const st = frameStats(f0);
  $("meta").textContent += " • [" + st.min + "-" + st.max + "]" + (st.len ? " • len=" + st.len + "/" + (st.need || "?") : "");
  showPixelNote(f0);
  if (f0.info && f0.info.depthFit) {
    $("meta").textContent += " • " + (LANG === "en"
      ? "depth=" + (f0.info.depthFit === "8bit" ? "8bit" : "16bit, partial")
      : "عمق=" + (f0.info.depthFit === "8bit" ? "٨ بت" : "١٦ بت جزئي"));
  }
  if (ovPrefD("rrai-ov-diag", false)) {
    const rb = paintReadback($("frame"));
    lastPaint = rb;
    $("meta").textContent += " • paint=" + (rb.ok ? rb.note + "/" + rb.spread : rb.note);
  }
  applyOverlayPrefs();
  try { drawAnnot(); } catch (e) {}
  /* Prove the image reached the screen; fix a canvas the layout left with no
     size, then say what is still wrong instead of showing a silent black box. */
  try {
    let a = canvasAudit(f0);
    if (a && a.why.some((x) => x === "no-size" || x === "hidden" || x.indexOf("covered:") === 0 || x.indexOf("opaque:") === 0)) {
      repairCanvas(cvF);
      a = canvasAudit(f0);
      if (a && !a.why.length) $("meta").textContent += LANG === "en" ? " • layout=repaired" : " • أُصلح التخطيط";
    }
    if (a && a.why.length) {
      showAuditNote(a);
      $("meta").textContent += (LANG === "en" ? " • not shown: " : " • لم تظهر: ") + a.why.join(",");
    }
  } catch (e) {}
  if (drawErr) $("meta").textContent += " • " + (LANG === "en" ? "draw error: " : "خطأ رسم: ") + drawErr;
  $("meta").textContent += " • " + (LANG === "en" ? "size=" : "حجم=") + cvF.width + "x" + cvF.height;
  mprSyncFromSlice(idx);
  if (st.max - st.min < 2 && current.compressedSrc && !f0.__redecode) { f0.__redecode = 1;
    decodeCompressed(current.compressedSrc, current)
      .then((px) => {
        current.frames[idx] = px;
        putStudy(current);
        drawFrame($("frame"), px, presetVal(), current.modality);
        const ov2 = $("overlay");
        ov2.width = px.w;
        ov2.height = px.h;
        $("meta").textContent += " • [أعيد الفك]";
      })
      .catch(() => {});
  }
}


/* ---- MPR: three linked viewports (axial / coronal / sagittal) ---- */
const MPR_PLANES = ["axial", "coronal", "sagittal"];
const MPR_NAME = { axial: ["\u0645\u062d\u0648\u0631\u064a", "Axial"], coronal: ["\u0625\u0643\u0644\u064a\u0644\u064a", "Coronal"], sagittal: ["\u0633\u0647\u0645\u064a", "Sagittal"] };
let mprOn = false, mprVol = null, mprKey = "", mprC = { x: 0, y: 0, z: 0 }, mprFocus = "axial", mprReason = "";
const mprName = (pl) => (MPR_NAME[pl] || MPR_NAME.axial)[LANG === "en" ? 1 : 0];

function mprVolume() {
  if (!current || !mprApi || !current.frames) return null;
  const frames = activeFrames();
  const f0 = frames[0] || {};
  const key = [current.uid || "", currentSeries, frames.length, f0.w, f0.h].join("|");
  if (mprVol && mprKey === key) return mprVol;
  mprVol = null; mprKey = key; mprReason = "";
  /* Reslicing blank frames only produces three blank panes: say why instead. */
  const badFrame = frames.find((f) => pixelProblem(f));
  if (badFrame) { mprReason = pixelProblemText(badFrame, LANG); return null; }
  try {
    const v = mprApi.volumeFromFrames(frames, { maxVoxels: 40e6 });
    if (v && v.ok) {
      mprVol = v;
      mprC = { x: v.nx >> 1, y: v.ny >> 1, z: v.nz >> 1 };
    } else {
      mprReason = (v && v.reason) || "unavailable";
    }
  } catch (e) { mprReason = String((e && e.message) || e); }
  return mprVol;
}
/* Every pane keeps its own window: a bone window on the sagittal and a soft-tissue
   window on the axial is how a reformatted series is actually read. "auto" follows
   the shared preset so nothing changes for anyone who does not touch it. */
const MPR_PRESETS = ["auto", "soft", "mediastinum", "bone", "lung", "brain"];
function mprPresetGet(pl) {
  try { const v = localStorage.getItem("rrai-mpr-preset-" + pl); if (v && PRESETS[v] !== undefined) return v; } catch (e) {}
  return "auto";
}
function mprPresetSet(pl, v) {
  try { localStorage.setItem("rrai-mpr-preset-" + pl, v); } catch (e) {}
}
function mprPresetFor(pl) {
  const v = mprPresetGet(pl);
  return v === "auto" ? presetVal() : v;
}
/* 1500 -> 1.500 — the group separator the reference viewer uses on a phone. */
const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function mprPresetTag(pl) {
  const v = mprPresetGet(pl);
  if (v === "auto") return "";
  const w = PRESETS[v];
  const nm = (PRESET_L[v] || PRESET_L.auto)[LANG === "en" ? 1 : 0];
  return " \u2022 " + nm + (w ? " " + grp(w[1]) : "");
}
function mprSyncPaneCtl(pl, d, idx) {
  const sl = $("mpr-slice-" + pl);
  if (sl) {
    if (sl.max !== String(d.n - 1)) sl.max = String(Math.max(0, d.n - 1));
    if (sl.value !== String(idx)) sl.value = String(idx);
  }
  const sel = $("mpr-preset-" + pl);
  if (sel && sel.value !== mprPresetGet(pl)) sel.value = mprPresetGet(pl);
}
function mprWirePaneCtl() {
  for (const pl of MPR_PLANES) {
    const sl = $("mpr-slice-" + pl);
    if (sl && !sl.__mpr) {
      sl.__mpr = 1;
      sl.addEventListener("input", () => { mprFocus = pl; mprSetIndex(pl, Number(sl.value) || 0); });
    }
    const sel = $("mpr-preset-" + pl);
    if (sel && !sel.__mpr) {
      sel.__mpr = 1;
      sel.addEventListener("change", () => { mprPresetSet(pl, sel.value); mprRender(); });
    }
  }
}
const mprIndex = (pl) => {
  if (!mprVol || !mprApi) return 0;
  const d = mprApi.planeDims(mprVol, pl);
  return Math.max(0, Math.min(d.n - 1, mprApi.planeIndexFor(mprVol, pl, mprC) | 0));
};
function mprSetIndex(pl, v) {
  if (!mprVol || !mprApi) return;
  const d = mprApi.planeDims(mprVol, pl);
  const i = Math.max(0, Math.min(d.n - 1, v | 0));
  if (pl === "axial") mprC.z = i; else if (pl === "coronal") mprC.y = i; else mprC.x = i;
  mprRender(); mprSyncSlider();
}
function mprSyncSlider() {
  const sl = $("slice");
  if (!sl || !mprVol) return;
  const n = (activeFrames().length || current.frames.length) - 1;
  const z = Math.max(0, Math.min(n, Math.round(mprC.z * (mprVol.downsample || 1))));
  if (String(sl.value) !== String(z)) sl.value = String(z);
}
function mprSyncFromSlice(idx) {
  if (!mprOn || !mprVol) return;
  const ds = mprVol.downsample || 1;
  mprC.z = Math.max(0, Math.min(mprVol.nz - 1, Math.round(idx / ds)));
  mprRender();
}
function mprCross(ctx, cv, p) {
  const w = cv.width, h = cv.height;
  const px = Math.round(p.px), py = Math.round(p.py);
  if (px < 0 || py < 0 || px > w || py > h) return;
  const lw = Math.max(1, Math.round(w / 320));
  const gap = Math.max(6, Math.round(w / 22));
  ctx.save();
  ctx.strokeStyle = "rgba(56,189,248,.85)";
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(0, py); ctx.lineTo(Math.max(0, px - gap), py);
  ctx.moveTo(Math.min(w, px + gap), py); ctx.lineTo(w, py);
  ctx.moveTo(px, 0); ctx.lineTo(px, Math.max(0, py - gap));
  ctx.moveTo(px, Math.min(h, py + gap)); ctx.lineTo(px, h);
  ctx.stroke();
  ctx.restore();
}
let mprMax = "";
function mprSetMax(pl) {
  mprMax = mprMax === pl ? "" : pl;
  const grid = $("mpr-grid");
  if (grid) grid.classList.toggle("portrait-focus", !!mprMax);
  for (const p of MPR_PLANES) {
    const pane = $("mpr-pane-" + p);
    if (pane) pane.classList.toggle("focus-plane", (mprMax || "axial") === p);
  }
  mprRender();
}
function mprWireMax() {
  if (mprMaxWired) return;
  mprMaxWired = true;
  for (const pl of MPR_PLANES) {
    const lab = $("mpr-lab-" + pl);
    const pane = $("mpr-pane-" + pl);
    const on = () => mprSetMax(pl);
    if (lab) { lab.style.cursor = "zoom-in"; lab.title = LANG === "en" ? "Tap to enlarge" : "اضغط للتكبير"; lab.addEventListener("click", on); }
    if (pane) pane.addEventListener("dblclick", on);
  }
}
let mprMaxWired = false;

/* A viewer is not a medical device: say so once, then get out of the way. */
/** Counts the frames of the active series that would render blank. One tap, no guessing. */
async function scanSeries() {
  if (!current) return;
  const frames = activeFrames();
  let blank = 0, bad = 0;
  for (const f of frames) {
    if (pixelProblem(f)) { bad++; blank++; }
  }
  let rendered = 0;
  try {
    const probeCv = document.createElement("canvas");
    for (let i = 0; i < frames.length; i += Math.max(1, Math.ceil(frames.length / 24))) {
      const f = frames[i];
      if (!f || pixelProblem(f)) continue;
      try {
        drawFrame(probeCv, f, presetVal(), current.modality);
        const rb = paintReadback(probeCv);
        if (!rb.ok || rb.spread < 2) rendered++;
      } catch (e) { rendered++; }
    }
  } catch (e) {}
  const ss = ensureSeries(current);
  const name = ss.length > 1 ? (ss[Math.min(currentSeries, ss.length - 1)] || {}).label || "" : "";
  setStatus((LANG === "en" ? "Series scan" : "فحص السلسلة") + (name ? " (" + name + ")" : "") + ": " +
    frames.length + " " + (LANG === "en" ? "frames, " : "إطارًا، ") +
    (LANG === "en" ? bad + " without pixel data, " : bad + " بلا بيانات بكسل، ") +
    (LANG === "en" ? rendered + " sampled frames that came out blank." : rendered + " من الإطارات المفحوصة تُرسم فارغة."),
    bad + rendered > 0);
}

function applyDxFoot() {
  const box = $("dx-foot");
  if (!box) return;
  let ack = "0";
  try { ack = localStorage.getItem("rrai-dx-ack") || "0"; } catch (e) {}
  box.style.display = ack === "1" ? "none" : "block";
  const tx = $("dx-foot-text");
  if (tx) tx.innerHTML = (I18N["dx-foot-text"] || ["", ""])[LANG === "en" ? 1 : 0];
  const btn = $("dx-foot-ok");
  if (btn && !btn.__wired) {
    btn.__wired = true;
    btn.textContent = (I18N["dx-foot-ok"] || ["إخفاء", "Confirm and hide"])[LANG === "en" ? 1 : 0];
    btn.addEventListener("click", () => {
      try { localStorage.setItem("rrai-dx-ack", "1"); } catch (e) {}
      box.style.display = "none";
    });
  }
}

function mprRender() {
  const vol = mprVolume();
  const grid = $("mpr-grid");
  if (!grid || !mprApi) return;
  if (!vol) {
    const note = $("mpr-note");
    if (note) note.textContent = LANG === "en"
      ? ("MPR unavailable: " + (mprReason || "this series cannot be resliced"))
      : ("MPR \u063a\u064a\u0631 \u0645\u062a\u0627\u062d: " + (mprReason || "\u0647\u0630\u0647 \u0627\u0644\u0633\u0644\u0633\u0644\u0629 \u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u0639\u0627\u062f\u0629 \u062a\u0634\u0643\u064a\u0644\u0647\u0627"));
    if (mprOn) {
      mprOn = false;
      const g2 = $("mpr-grid"); if (g2) g2.style.display = "none";
      const vp2 = $("viewport"); if (vp2) vp2.style.display = "block";
      const btn2 = $("mpr-toggle");
      if (btn2) { btn2.textContent = LANG === "en" ? "MPR: axial / coronal / sagittal" : "MPR: \u0645\u062d\u0648\u0631\u064a / \u0625\u0643\u0644\u064a\u0644\u064a / \u0633\u0647\u0645\u064a"; btn2.style.background = ""; btn2.style.color = ""; }
      try { localStorage.setItem("rrai-mpr-on", "0"); } catch (e) {}
      if (current) show(sliceIdx());
    }
    return;
  }
  const preset = presetVal();
  const modality = current ? current.modality : "CT";
  for (const pl of MPR_PLANES) {
    const cv = $("mpr-c-" + pl), lab = $("mpr-lab-" + pl);
    if (!cv) continue;
    const d = mprApi.planeDims(vol, pl);
    const idx = mprIndex(pl);
    const img = mprApi.planeImage(vol, pl, idx);
    if (!img) continue;
    drawFrame(cv, img, mprPresetFor(pl), modality);
    mprSyncPaneCtl(pl, d, idx);
    try { cv.style.aspectRatio = String(Math.max(1, Math.round(d.w * d.sx * 100) / 100)) + " / " + String(Math.max(1, Math.round(d.h * d.sy * 100) / 100)); } catch (e) {}
    const ctx = cv.getContext("2d");
    if (ctx) {
      mprCross(ctx, cv, mprApi.volumeToPlanePixel(vol, pl, mprC));
      try {
        if (ovPref("rrai-ov-seq", true) && current) {
          const f = current.frames[Math.min(current.frames.length - 1, Math.round(idx * (vol.downsample || 1)))] || current.frames[0];
          const lb = seqLabelOf(f && f.seq, current.modality);
          if (lb.label) {
            const fs = Math.max(9, Math.min(16, Math.round(cv.width / 40)));
            ctx.save();
            ctx.font = "600 " + fs + "px system-ui,Tahoma,sans-serif";
            ctx.textAlign = "left";
            ctx.lineWidth = Math.max(2, fs / 4);
            ctx.strokeStyle = "rgba(0,0,0,.7)";
            const txt = lb.derived ? lb.label + " ~" : lb.label;
            ctx.strokeText(txt, fs * 0.6, fs * 1.5);
            ctx.fillStyle = "#dbeafe";
            ctx.fillText(txt, fs * 0.6, fs * 1.5);
            ctx.restore();
          }
        }
      } catch (e) {}
    }
    if (lab) {
      const mm = pl === "axial" ? mprC.z * vol.sz : pl === "coronal" ? mprC.y * vol.sy : mprC.x * vol.sx;
      lab.textContent = mprName(pl) + " " + (idx + 1) + "/" + d.n + (mm ? " \u2022 " + mm.toFixed(0) + "mm" : "") + mprPresetTag(pl);
    }
  }
  const note = $("mpr-note");
  if (note) {
    const bits = [];
    if (mprApi.isAnisotropic(vol)) bits.push(LANG === "en"
      ? "thick slices \u2014 coronal/sagittal are approximate"
      : "\u0634\u0631\u0627\u0626\u062d \u0633\u0645\u064a\u0643\u0629: \u0627\u0644\u0625\u0643\u0644\u064a\u0644\u064a \u0648\u0627\u0644\u0633\u0647\u0645\u064a \u062a\u0642\u0631\u064a\u0628\u064a\u0627\u0646");
    if ((vol.downsample || 1) > 1) bits.push(LANG === "en"
      ? "downsampled \u00d7" + vol.downsample + " to fit memory"
      : "\u0645\u0635\u063a\u0651\u0631 \u00d7" + vol.downsample + " \u0644\u062a\u0648\u0641\u064a\u0631 \u0627\u0644\u0630\u0627\u0643\u0631\u0629");
    note.textContent = bits.join(" \u2022 ");
  }
}
function mprToggle(on) {
  if(dualOn){paneSelect(1);dualOn=false;dualRender();}
  mprOn = (on === undefined ? !mprOn : !!on);
  if (mprOn && allOn) { try { allToggle(false); } catch (e) {} }
  if (mprOn && !mprApi) mprOn = false;
  if (mprOn) { const v = mprVolume(); if (!v) mprOn = false; }
  const grid = $("mpr-grid"), vp = $("viewport");
  if (grid) grid.style.display = mprOn ? "grid" : "none";
  if (vp) vp.style.display = mprOn ? "none" : (current ? "block" : "none");
  const btn = $("mpr-toggle");
  if (btn) {
    btn.textContent = LANG === "en" ? (mprOn ? "Single view" : "MPR: axial / coronal / sagittal") : (mprOn ? "\u0639\u0631\u0636 \u0645\u0641\u0631\u062f" : "MPR: \u0645\u062d\u0648\u0631\u064a / \u0625\u0643\u0644\u064a\u0644\u064a / \u0633\u0647\u0645\u064a");
    btn.style.background = mprOn ? "#38bdf8" : "";
    btn.style.color = mprOn ? "#0f172a" : "";
  }
  if (mprOn) { mprWireMax(); mprWirePaneCtl(); mprRender(); mprSyncSlider(); }
  else { const sl = $("slice"); if (sl && current) show(Number(sl.value) || 0); else if (current) show(0); }
  vst({ type: "setLayout", layout: mprOn ? "mpr" : "single" });
  renderFilmstrip();
  applyDxFoot();
  const note = $("mpr-note");
  if (note && !mprOn && !mprApi) note.textContent = LANG === "en" ? "MPR module unavailable" : "\u0648\u062d\u062f\u0629 MPR \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629";
  try { localStorage.setItem("rrai-mpr-on", mprOn ? "1" : "0"); } catch (e) {}
}
/* ---- comprehensive hanging: the whole study on one screen -----------------
   A study is read sequence by sequence — T1, T2, FLAIR — and every sequence in
   the three planes. This lays it all out: one row per series, axial / coronal /
   sagittal side by side in each row, the way a hanging protocol hangs a film. */
let allOn = false, allKey = "", allVols = new Map();

/** One row per series, with what that row can actually show. Pure: no DOM. */
export function allSeriesRows(study, api) {
  const mpr = api === undefined ? mprApi : api;
  const ss = ensureSeries(study);
  const frames = (study && study.frames) || [];
  const out = [];
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    const fs = (s.indices || []).map((k) => frames[k]).filter(Boolean);
    const f0 = fs[0] || {};
    const sameSize = fs.every((f) => f && f.w === f0.w && f.h === f0.h);
    let reason = "";
    if (!mpr) reason = "no-mpr";
    else if (fs.length < 2) reason = "one-frame";
    else if (!sameSize) reason = "mixed-size";
    else if (fs.some((f) => pixelProblem(f))) reason = "bad-frame";
    out.push({
      index: i,
      label: s.label || s.description || ("Se " + (s.number || "?")),
      derived: !!s.derived, count: fs.length, w: f0.w || 0, h: f0.h || 0,
      reslice: !reason, reason: reason,
    });
  }
  return out;
}
function allReasonText(r) {
  const en = LANG === "en";
  if (r.reason === "no-mpr") return en ? "MPR unavailable" : "MPR غير متاحة";
  if (r.reason === "one-frame") return en ? "one image — nothing to reslice" : "صورة واحدة — لا تُعاد صياغتها";
  if (r.reason === "mixed-size") return en ? "slices differ in size" : "الشرائح بمقاسات مختلفة";
  if (r.reason === "bad-frame") return en ? "a frame cannot be drawn" : "إطار غير قابل للرسم";
  return "";
}
/* Volumes are the expensive part, so each series keeps its own, keyed by what
   it was built from, and the memory budget is shared between the rows. */
function allRowVolume(r) {
  if (!mprApi || !current) return null;
  const ss = ensureSeries(current);
  const frames = ((ss[r.index] && ss[r.index].indices) || []).map((k) => current.frames[k]).filter(Boolean);
  if (!frames.length) return null;
  const key = [current.uid || "", r.index, frames.length, r.w, r.h].join("|");
  if (allVols.has(key)) return allVols.get(key);
  let vol = null;
  try {
    const rows = Math.max(1, allSeriesRows(current).length || 1);
    const v = mprApi.volumeFromFrames(frames, { maxVoxels: Math.max(2e6, Math.floor(40e6 / rows)) });
    if (v && v.ok) vol = v;
  } catch (e) { vol = null; }
  allVols.set(key, vol);
  return vol;
}
function renderAll() {
  const grid = $("all-grid");
  if (!grid || !current) return;
  grid.innerHTML = "";
  allVols.clear();
  const rows = allSeriesRows(current);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "mpr-pane";
    row.style.width = "100%";
    const lab = document.createElement("p");
    lab.className = "mpr-lab";
    lab.textContent = (r.derived ? r.label + " ~" : r.label) + " • " + r.count +
      (r.w ? " • " + r.w + "×" + r.h : "") + (r.reason ? " • " + allReasonText(r) : "");
    row.appendChild(lab);
    const inner = document.createElement("div");
    inner.className = "mpr-grid";
    inner.style.display = "grid";
    const vol = r.reslice ? allRowVolume(r) : null;
    const idx0 = ((ensureSeries(current)[r.index] || {}).indices || [])[0];
    for (const pl of MPR_PLANES) {
      const cell = document.createElement("div");
      const cv = document.createElement("canvas");
      cv.width = 8; cv.height = 8;
      cv.style.width = "100%"; cv.style.height = "auto"; cv.style.display = "block";
      cv.style.background = "#000"; cv.style.borderRadius = ".3rem"; cv.style.cursor = "pointer";
      cv.title = (LANG === "en" ? "Open " : "افتح ") + r.label;
      cell.appendChild(cv);
      const cl = document.createElement("p");
      cl.className = "mpr-lab";
      cl.textContent = mprName(pl);
      cell.appendChild(cl);
      inner.appendChild(cell);
      try {
        if (vol && mprApi) {
          const d = mprApi.planeDims(vol, pl);
          const ix = Math.max(0, Math.min(d.n - 1, Math.round((d.n - 1) / 2)));
          const img = mprApi.planeImage(vol, pl, ix);
          if (img) drawFrame(cv, img, mprPresetFor(pl), current.modality);
        } else if (pl === "axial" && idx0 != null) {
          const fr = current.frames[idx0];
          if (fr) drawFrame(cv, fr, presetVal(), current.modality);
        }
      } catch (e) {}
      cv.onclick = () => {
        try { selectSeries(r.index); } catch (e) {}
        if (r.reslice) { try { if (!mprOn) mprToggle(true); } catch (e) {} }
        else { try { allToggle(false); } catch (e) {} }
      };
    }
    row.appendChild(inner);
    grid.appendChild(row);
  }
  const note = $("all-note");
  if (note) note.textContent = rows.length + (LANG === "en" ? " series" : " سلسلة") +
    " • " + (LANG === "en" ? "tap a pane to open that series" : "اضغط أي نافذة لفتح سلسلتها");
  allKey = [current.uid || "", rows.length, currentSeries].join("|");
}
function allToggle(on) {
  if(dualOn){paneSelect(1);dualOn=false;dualRender();}
  allOn = (on === undefined ? !allOn : !!on);
  if (allOn && mprOn) { try { mprToggle(false); } catch (e) {} }
  const grid = $("all-grid"), vp = $("viewport"), mg = $("mpr-grid");
  if (grid) grid.style.display = allOn ? "block" : "none";
  if (mg) mg.style.display = "none";
  if (vp) vp.style.display = allOn ? "none" : (current ? "block" : "none");
  const btn = $("all-toggle");
  if (btn) {
    btn.textContent = LANG === "en"
      ? (allOn ? "Single view" : "All series × 3 planes")
      : (allOn ? "عرض مفرد" : "عرض شامل: كل السلاسل × ٣ مستويات");
    btn.style.background = allOn ? "#38bdf8" : "";
    btn.style.color = allOn ? "#0f172a" : "";
  }
  if (allOn) renderAll();
  else if (current) { const sl = $("slice"); show(Number(sl && sl.value) || 0); }
  vst({ type: "setLayout", layout: allOn ? "all" : "single" });
  renderFilmstrip();
  applyDxFoot();
  try { localStorage.setItem("rrai-all-on", allOn ? "1" : "0"); } catch (e) {}
}
function mprWire() {
  setupViewerState();
  const btn = $("mpr-toggle");
  if (btn && !btn.__mpr) { btn.__mpr = 1; btn.onclick = () => mprToggle(); }
  const abtn = $("all-toggle");
  if (abtn && !abtn.__all) { abtn.__all = 1; abtn.onclick = () => allToggle(); }
  const ps = $("preset");
  if (ps && !ps.__mpr) { ps.__mpr = 1; ps.addEventListener("change", () => { if (mprOn) mprRender(); }); }
  for (const pl of MPR_PLANES) {
    const cv = $("mpr-c-" + pl);
    if (!cv || cv.__mpr) continue;
    cv.__mpr = 1;
    let drag = null;
    cv.addEventListener("pointerdown", (ev) => {
      mprFocus = pl;
      drag = { y: ev.clientY, idx: mprIndex(pl), moved: 0 };
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    cv.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dy = ev.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dy));
      mprSetIndex(pl, drag.idx - Math.trunc(dy / 8));
    });
    cv.addEventListener("pointerup", (ev) => {
      const moved = drag ? drag.moved : 0;
      drag = null;
      if (moved > 6 || !mprVol || !mprApi) return;
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = Math.round(((ev.clientX - r.left) / r.width) * cv.width);
      const py = Math.round(((ev.clientY - r.top) / r.height) * cv.height);
      const c = mprApi.pointToVolume(mprVol, pl, mprIndex(pl), px, py);
      if (c) { mprC = c; mprRender(); mprSyncSlider(); }
    });
    cv.addEventListener("wheel", (ev) => {
      if (!mprOn) return;
      ev.preventDefault();
      mprFocus = pl;
      mprSetIndex(pl, mprIndex(pl) + (ev.deltaY > 0 ? 1 : -1));
    }, { passive: false });
  }
}

/* ---- on-image annotation layer (corner information) ---- */
function techLine(f) {
  const s = f && f.seq;
  if (!s) return "";
  if (s.te || s.tr) return "TE " + (Math.round((s.te || 0) * 10) / 10) + " / TR " + Math.round(s.tr || 0);
  if (s.bValue) return "b=" + Math.round(s.bValue);
  return "";
}
function drawAnnot() {
  const cv = $("annot");
  if (!cv || !current) return;
  /* v147 — this canvas lies ON TOP of the image. Any background colour here
     (the old `.viewer canvas{background:#000}`) hid the whole frame behind an
     opaque black sheet, so the viewer looked broken while the pixels were
     fine underneath. Force it transparent on every draw, not just in CSS:
     a cached stylesheet from an older build must not be able to undo it. */
  try { cv.style.background = "transparent"; } catch (e) {}
  try { const ov0 = $("overlay"); if (ov0) ov0.style.background = "transparent"; } catch (e) {}
  const host = $("viewport");
  const w = (host && host.clientWidth) || 0;
  const h = (host && (host.clientHeight || Math.round(host.getBoundingClientRect().height))) || 0;
  if (!w || !h) return;
  const dpr = Math.min(2, (window.devicePixelRatio || 1));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!ovPref("rrai-ov-seq", true)) return;
  const fs = Math.max(10, Math.min(15, Math.round(w / 55)));
  const pad = Math.round(fs * 0.7);
  const put = (text, x, y, align) => {
    if (!text) return;
    ctx.font = "600 " + fs + "px system-ui,\"Segoe UI\",Tahoma,sans-serif";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(2, fs / 4);
    ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#dbeafe";
    ctx.fillText(text, x, y);
  };
  const f = curFrame() || current.frames[0];
  const lbl = seqLabelOf(f && f.seq, current.modality);
  const se = f && f.seq && f.seq.seriesNumber ? "Se " + f.seq.seriesNumber : "";
  const seqTxt = [se, lbl.label ? (lbl.derived ? lbl.label + " ~" : lbl.label) : ""].filter(Boolean).join(" • ");
  const tl = ovPref("rrai-ov-name", false) ? shownName((current.meta && current.meta.patientName) || current.patient || "") : "";
  const tr = [fmtDicomDate(current.meta && current.meta.studyDate), current.modality].filter(Boolean).join(" • ");
  const bl = [seqTxt, studyTypeLabel(current)].filter(Boolean).join(" — ");
  const br = [];
      br.push((LANG === "en" ? "Slice " : "شريحة ") + (sliceIdx() + 1) + "/" + (activeFrames().length || current.frames.length));
  if (ovPref("rrai-ov-tech", true)) { const tl2 = techLine(f); if (tl2) br.push(tl2); }
  put(tl, pad, pad + fs, "left");
  put(tr, w - pad, pad + fs, "right");
  put(bl, pad, h - pad, "left");
  put(br.join("  •  "), w - pad, h - pad, "right");
  if (ovPrefD("rrai-ov-diag", false)) {
    const fs2 = Math.max(9, Math.min(13, Math.round(w / 62)));
    let y = pad + fs * 2.6;
    ctx.font = "600 " + fs2 + "px ui-monospace,Menlo,Consolas,monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(2, fs2 / 4);
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    for (const ln of diagLines(f)) {
      ctx.strokeText(ln, pad, y);
      ctx.fillStyle = "#a7f3d0";
      ctx.fillText(ln, pad, y);
      y += Math.round(fs2 * 1.45);
    }
  }
}

function setStatus(msg, warn) {
  const el = $("ingest-status");
  if (!el) return;
  el.textContent = msg;
  el.dataset.status=warn?"warning":"info";
  el.style.color = warn ? "#fca5a5" : "#86efac";
}

let bootStage = "pre-init";
function stage(s) {
  bootStage = s;
  try { localStorage.setItem("rrai-boot-stage", s); } catch (e) {}
}
function bootBanner(e) {
  const msg = "إقلاع متوقف عند [" + bootStage + "]: " + (e && e.message ? e.message : e) + " | " + (String((e && e.stack) || "").split("\n")[1] || "").trim();
  try { localStorage.setItem("rrai-boot-error", msg); } catch (err) {}
  let healed = false;
  try { healed = sessionStorage.getItem("rrai-self-heal") === "1"; } catch (err) {}
  if (!healed) {
    try {
      sessionStorage.setItem("rrai-self-heal", "1");
      caches.keys()
        .then((ks) => Promise.all(ks.filter((k) => k.indexOf("rrai-web-") === 0 && k !== "rrai-web-" + APP_BUILD).map((k) => caches.delete(k))))
        .then(() => (navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([])))
        .then((regs) => Promise.all((regs || []).map((r) => r.unregister())))
        .then(() => location.reload());
      return;
    } catch (err) {}
  }
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;background:#7f1d1d;color:#fff;padding:10px;z-index:99999;font-size:13px;line-height:1.6;";
  d.textContent = msg + " — إن تكرر: امسح بيانات الموقع من إعدادات المتصفح ثم أعد الفتح.";
  document.body.appendChild(d);
}
function safeFilePart(x) {
  return String(x || "study").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "study";
}
const AI_MODELS = ["gemini-2.5-flash", "gemini-flash-latest"];
const AI_PROVIDERS = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", models: ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"], vision: { "qwen/qwen3.8-27b": true, "qwen/qwen3.6-27b": true } },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", models: ["google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct:free"], vision: { "google/gemini-2.0-flash-exp:free": true } },
  gemini: { url: "", models: AI_MODELS, vision: {}, native: true },
  server: { url: "", models: ["server"], vision: {}, serverSide: true },
};
export function aiProviderForKey(key) {
  const k = String(key || "").trim();
  if (/^gsk_/i.test(k)) return "groq";
  if (/^sk-or-/i.test(k)) return "openrouter";
  if (/^(AIza|AQ\.)/i.test(k)) return "gemini";
  if (/^sk-(proj-)?/i.test(k)) return "openai-unsupported";
  return null;
}
export function aiRequestFor(provider, key, model, payload) {
  const cfg = AI_PROVIDERS[provider] || AI_PROVIDERS.groq;
  const imgs = (payload && payload.images) || [];
  const text = (payload && payload.text) || "";
  if (cfg.native) {
    const parts = [{ text: text }];
    for (const b64 of imgs) parts.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key),
      headers: { "Content-Type": "application/json" },
      body: { contents: [{ role: "user", parts: parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } },
      vision: imgs.length > 0, openai: false,
    };
  }
  const canVision = !!cfg.vision[model] && imgs.length > 0;
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + key };
  if (provider === "openrouter") headers["X-Title"] = "Radiology report AI";
  const content = canVision
    ? [{ type: "text", text: text }].concat(imgs.map((b64) => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64 } })))
    : text;
  return {
    url: cfg.url,
    headers: headers,
    body: { model: model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: content }] },
    vision: canVision, openai: true,
  };
}
export function aiPromptText(study) {
  const meta = study.meta || {};
  const ctx = {
    modality: study.modality || "CR",
    sex: meta.sex || null, age: meta.age || null, studyDate: meta.studyDate || null,
    studyDesc: meta.studyDesc || null, bodyPart: meta.bodyPart || null,
    slices: study.frames ? study.frames.length : 0,
    triage: study.triage ? { score: Number(study.triage.score.toFixed(4)), priority: study.triage.priority, context: study.triage.context, reasons: study.triage.reasons || [] } : null,
    measurements: study.measurements || null,
    measurementFrames: study.measurementFrames || null,
    compare: study.compare ? { meanAbs: Number(study.compare.meanAbs), pctHot: Number(study.compare.pctHot) } : null,
  };
  const archRefs = (() => {
    try {
      const regionNow = bankRegion(study);
      const pat = String((study.meta && study.meta.patientName) || study.patient || "").toUpperCase();
      return archiveLoad().filter((e) => (pat && String(e.patient || "").toUpperCase() === pat) || bankRegion({ meta: { studyDesc: e.exam, bodyPart: "" }, modality: e.modality, description: e.exam }) === regionNow).slice(0, 2);
    } catch (e) { return []; }
  })();
  return [
    "You are a CONSULTANT RADIOLOGIST assistant drafting a complete, sign-ready report for the reviewing radiologist (decision support, not a diagnosis).",
    "Input: numeric study context + up to 6 evenly spaced grayscale slice renders + the physician's own exam/indication/notes fields when provided.",
    "The physician may attach up to 2 extra screenshots of the same study (e.g. photos of the PACS monitor with more slices or other sequences) — treat them as primary image evidence with EQUAL weight to the slice renders.",
    "STYLE (tertiary-hospital standard): full professional sentences; systematic and thorough; group by structure; lead with the dominant abnormality tied to the clinical indication, then a systematic review of the remaining compartments (brain: parenchyma, ventricles, extra-axial spaces, vasculature, calvarium/scalp; chest: lungs, airways, mediastinum, pleura, bones; abdomen/pelvis: solid organs, bowel, vessels, nodes; spine: alignment, discs, cord, facets; joint/MSK: bones and marrow, articular cartilage, menisci/labrum, ligaments, tendons, effusion/bursae, soft tissues); mention sequence or contrast behavior ONLY when supported by context, notes, or visible evidence; include relevant negatives; never invent lesions, levels, devices, or contrast phases; if something is not assessable write 'not assessed on the provided images'.",
    "NEVER comment on render resolution or image quality; if a limitation is truly required phrase it neutrally, e.g. 'Correlation with the source PACS images is recommended.'",
    "Do NOT write 'limited images', 'image quality', or any adequacy comment anywhere including IMPRESSION; 'not assessed on the provided images' is allowed ONLY for compartments genuinely not covered by this study.",
    "Bold key anatomical structures and key positive findings with **double asterisks** only (do NOT use <anat> tags).",
    "IMPRESSION: 2-6 sentences: (1) dominant diagnosis with location/laterality, (2) differential or qualifier, (3) clinically relevant negatives, (4) recommendation (follow-up, consultation, DSA, etc.) when appropriate.",
    "TECHNIQUE: REQUIRED, never empty: one professional sentence naming modality, planes and sequence names (MRI e.g. 'axial, sagittal and coronal T1, T2, FLAIR and DWI'; CT e.g. 'axial acquisitions with coronal and sagittal reformats'; XR e.g. 'standard orthogonal projections'), contrast status and special sequences (MRA/MRV/3D MIP/STIR/PD) — infer from context, notes and modality; mark uncertain elements 'per department protocol'.",
    ...(study.report && study.report.notes ? ["RAW CLINICAL NOTES / DICTATION (physician-provided, PRIMARY source — structure it, do not add findings absent from notes and images):", String(study.report.notes).slice(0, 6000)] : []),
    ...((() => { const ex = $("rep-exam"), ind = $("rep-indication"); const out = []; if (ex && ex.value.trim()) out.push("PHYSICIAN EXAM FIELD: " + ex.value.trim()); if (ind && ind.value.trim()) out.push("PHYSICIAN INDICATION FIELD: " + ind.value.trim()); return out; })()),
    ...(archRefs.length ? ["ARCHIVED PHYSICIAN-APPROVED REPORTS from this device (mirror their professional phrasing and structure; if the same patient, treat as prior study and add comparison language):", ...archRefs.map((e) => "[" + e.patient + " | " + e.exam + " | " + String(e.ts).slice(0, 10) + "] FINDINGS: " + String(e.findings).slice(0, 1200) + " IMPRESSION: " + String(e.impression).slice(0, 600))] : []),
    "Return STRICT JSON: {\"exam\": precise study name incl. modality, region and contrast (e.g. \"MRI of the Brain with IV contrast\"), \"indication\": string, \"technique\": string, \"findings\": [8-14 strings], \"impression\": [2-6 strings]}.",
    "STUDY CONTEXT JSON: " + JSON.stringify(ctx),
  ].join("\n");
}
function sliceRenderB64(study, idx) {
  const px = study.frames[idx];
  const tmp = document.createElement("canvas");
  const preset = presetVal();
  drawFrame(tmp, px, preset, study.modality);
  const scale = Math.min(4, 768 / Math.max(tmp.width, tmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(tmp.width * scale));
  c.height = Math.max(1, Math.round(tmp.height * scale));
  c.getContext("2d").drawImage(tmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.9);
  return url.slice(url.indexOf(",") + 1);
}
function contrastState(study) {
  const src = String(((study.meta || {}).studyDesc || "") + " " + (study.description || "") + " " + ((study.report && study.report.exam) || "") + " " + ((study.report && study.report.indication) || "") + " " + (study.indication || "")).toLowerCase();
  if (/with\s+(?:and|&|\/)\s+without[^.]{0,30}contrast/.test(src)) return "both";
  if (/\b(?:without|no)\s+(?:(?:iv|intravenous)\s+)?contrast\b|\bnon[- ]?contrast\b|بدون\s+(?:صبغة|تباين)/.test(src)) return "without";
  if (/\bwith\s+(?:(?:iv|intravenous)\s+)?contrast\b|\bpost[- ]contrast\b|contrast[^.]{0,20}(enhanced|given|administered)/.test(src)) return "with";
  return "unknown";
}
function examDefaultFor(study) {
  const lbl = studyTypeLabel(study);
  if (lbl) return lbl;
  const m = String((study && study.modality) || "").toUpperCase();
  return m ? m + (LANG === "en" ? " study" : " — دراسة") : "";
}
function techniqueFor(study) {
  const mod = study.modality || "CR";
  const src = String(((study.meta || {}).studyDesc || "") + " " + ((study.meta || {}).bodyPart || "") + " " + (study.description || "") + " " + ((study.report && study.report.exam) || "") + " " + ((study.report && study.report.indication) || "")).toUpperCase();
  const lat = /RIGHT|\bRT\b/.test(src) ? "right " : /LEFT|\bLT\b/.test(src) ? "left " : "";
  let region = "the region of interest";
  if (/BRAIN|HEAD|PITUIT|SELLA/.test(src)) region = "the brain";
  else if (/LUMBAR|SACRAL|\bLS\b|L-S/.test(src)) region = "the lumbosacral spine";
  else if (/CERVICAL/.test(src)) region = "the cervical spine";
  else if (/THORACIC SPINE/.test(src)) region = "the thoracic spine";
  else if (/SPINE/.test(src)) region = "the spine";
  else if (/KNEE/.test(src)) region = "the knee";
  else if (/SHOULDER/.test(src)) region = "the shoulder";
  else if (/\bHIP\b/.test(src)) region = "the hip";
  else if (/WRIST|HAND|ELBOW|ANKLE|FOOT/.test(src)) region = "the " + String(src.match(/WRIST|HAND|ELBOW|ANKLE|FOOT/)[0]).toLowerCase();
  else if (/CHEST|THORAX/.test(src)) region = "the chest";
  else if (/ABDOM|PELV/.test(src)) region = "the abdomen and pelvis";
  if (lat && /knee|shoulder|hip|wrist|hand|elbow|ankle|foot/.test(region)) region = region.replace(/^the /, "the " + lat);
  const cs = contrastState(study);
  const cph = cs === "both" ? "without and with intravenous contrast" : cs === "with" ? "with intravenous contrast" : cs === "without" ? "without intravenous contrast" : "with contrast status per department protocol";
  if (/^MR/.test(mod)) {
    let seq = "multiplanar multisequence T1- and T2-weighted images";
    if (/brain/.test(region)) seq = "axial, sagittal and coronal T1, T2, FLAIR and DWI";
    else if (/spine/.test(region)) seq = "sagittal T1, sagittal T2 and axial T2-weighted images";
    else if (/knee|shoulder|hip|wrist|hand|elbow|ankle|foot/.test(region)) seq = "sagittal PD fat-saturated, STIR and coronal/axial T2-weighted sequences";
    return "Multiplanar, multisequence MRI of " + region + " was performed " + cph + ". Sequences include " + seq + ".";
  }
  if (/^CT/.test(mod)) return "Axial CT acquisitions of " + region + " were performed " + cph + "; coronal and sagittal reformats were reviewed.";
  if (/^(CR|DX|XR)/.test(mod)) return "Standard orthogonal projections of " + region + " were obtained without intravenous contrast.";
  if (/^US/.test(mod)) return "Real-time grayscale sonography of " + region + " was performed.";
  return mod + " examination of " + region + " was performed " + cph + ".";
}
function fillComposerFromAi(study, obj) {
  reportExportEdited();
  const tech=$("rep-technique");if(tech)tech.value=String(obj.technique||"").trim()||techniqueFor(study);
  const f = $("rep-findings"), im = $("rep-impression"), ex = $("rep-exam"), ind = $("rep-indication");
  if (ex && obj.exam) ex.value = String(obj.exam);
  if (ind && obj.indication) ind.value = String(obj.indication);
  if (f && Array.isArray(obj.findings)) f.value = obj.findings.map(String).join("\n").replace(/<anat>(.*?)<\/anat>/g, "**$1**");
  if (im && Array.isArray(obj.impression)) im.value = obj.impression.map(String).join("\n").replace(/<anat>(.*?)<\/anat>/g, "**$1**");
  if (current === study) { study.report = { exam: ex.value.trim(), indication: ind.value.trim(), findings: f.value.trim(), impression: im.value.trim(), technique: String(obj.technique || "").trim() || techniqueFor(study), notes: ($("rep-notes") ? $("rep-notes").value.trim() : "") }; putStudy(study); }
  renderBank(study);
}
let aiExtraImgs = [];
async function fileToJpegB64(file, maxSide, q) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", q);
    return url.slice(url.indexOf(",") + 1);
  } catch (e) { return ""; }
}
// v147: one bounded job, accurate errors, response-body timeout, no image-dropping fallback.
export function aiFailure(code,status=0){return Object.assign(new Error(code),{code,status});}
export function aiDraftObject(obj){
 if(!obj||!['findings','impression'].every(k=>Array.isArray(obj[k])&&obj[k].length&&obj[k].every(x=>typeof x==='string'&&x.trim())))throw aiFailure('invalid-response');
 return obj;
}
export async function aiRunRequests(requests, opts={}){
 const signal=opts.signal, now=opts.now||Date.now, fetcher=opts.fetcher||fetch;
 const end=now()+(opts.budgetMs||240000), limit=opts.attemptMs||90000;
 const sleep=opts.sleep||((ms)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(t);reject(aiFailure('cancelled'));};const t=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();}));
 let last=aiFailure('unavailable'), attempt=0;
 for(const rq of requests){
  for(let repeat=0;repeat<(opts.attemptsPerModel||2);repeat++){
   if(signal?.aborted)throw aiFailure('cancelled');
   const remaining=end-now();if(remaining<=0)throw aiFailure('timeout');
   attempt++;opts.progress?.({attempt,model:rq.model,state:'request'});
   const record={attempt,model:rq.model,http:0,phase:'connect',result:'unknown',bytes:new TextEncoder().encode(JSON.stringify(rq.body)).length,vision:!!rq.vision};const started=now();
   const ac=new AbortController();let timed=false,wait=0,skip=false;
   const abort=()=>ac.abort();signal?.addEventListener('abort',abort,{once:true});
   const attemptEnd=now()+Math.min(limit,remaining);
   const timer=setTimeout(()=>{timed=true;ac.abort();},Math.min(limit,remaining));
   try{
    const r=await fetcher(rq.url,{method:'POST',headers:rq.headers,body:JSON.stringify(rq.body),signal:ac.signal});
    record.http=r.status;record.phase='body';
    if(!r.ok){
     const text=await r.text();
     if(r.status===401||r.status===403)throw aiFailure('auth',r.status);
     if(r.status===404){skip=true;throw aiFailure('model-unavailable',404);}
     if(r.status===429&&/quota[^\n]{0,100}(?:perday|per_day|daily|limit:\s*0)|perday|per_day|billing|insufficient_quota/i.test(text))throw aiFailure('quota',429);
     if(![408,429,500,502,503,504].includes(r.status))throw aiFailure('request-rejected',r.status);
     const h=r.headers.get('Retry-After');if(h){const sec=Number(h);wait=Number.isFinite(sec)?sec*1000:Math.max(0,Date.parse(h)-now());}
     if(wait>30000)throw aiFailure('rate-limit',r.status);
     throw aiFailure(r.status===429?'rate-limit':r.status===408||r.status===504?'timeout':'unavailable',r.status);
    }
    const j=await r.json();
    record.phase='parse';
    let obj=j;
    if(!rq.server){
     const txt=rq.openai?((j.choices||[])[0]?.message?.content||''):((j.candidates||[])[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
     const reason=rq.openai?j.choices?.[0]?.finish_reason:j.candidates?.[0]?.finishReason;
     if(j.promptFeedback?.blockReason||/SAFETY|RECITATION|PROHIBITED|content_filter/.test(reason||''))throw aiFailure('blocked');
     if(/MAX_TOKENS|length/.test(reason||''))throw aiFailure('invalid-response');
     try{obj=JSON.parse(txt.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim());}catch(e){throw aiFailure('invalid-response');}
    }
    if(signal?.aborted)throw aiFailure('cancelled');
    if(now()>=attemptEnd)throw aiFailure('timeout');
    aiDraftObject(obj);record.result='ok';record.phase='done';
    return {obj,model:rq.model,attempt};
   }catch(e){
    last=signal?.aborted?aiFailure('cancelled'):timed?aiFailure('timeout'):e.code?e:aiFailure(e instanceof SyntaxError?'invalid-response':'network');
    record.result=last.code;
    if(['cancelled','auth','quota','blocked','request-rejected'].includes(last.code))throw last;
    if(last.code==='rate-limit'&&wait>30000)throw last;
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);opts.trace?.({...record,ms:Math.max(0,now()-started)});}
   if(skip)break;
   if(attempt>=4||now()>=end)throw last;
   const delay=Math.max(wait,Math.min(8000,1000*2**(attempt-1))+Math.floor(Math.random()*500));
   if(now()+delay>=end)throw last;
   opts.progress?.({attempt,model:rq.model,state:'retry',code:last.code,delay});
   await sleep(delay);
  }
 }
 throw last;
}
let aiProbe=null;
let aiTraceRecords=[];
function aiTraceStart(kind){aiTraceRecords=[];const el=$('ai-trace');if(el)el.textContent='v147 · '+kind+' · no patient text/images/keys in this log';}
function aiTrace(record){aiTraceRecords.push(record);const el=$('ai-trace');if(el)el.textContent+='\n'+JSON.stringify(record);}
async function aiConnectionTest(){
 if(aiJob||aiProbe)return;
 const key=$('ai-key')?.value.trim()||'';
 const provider=aiProviderForKey(key)||$('ai-provider')?.value;
 const cfg=AI_PROVIDERS[provider];
 if(!key||!cfg||cfg.serverSide||provider==='openai-unsupported'){aiJobState(LANG==='en'?'Enter a supported provider key to test.':'أدخل مفتاح مزوّد مدعوم للاختبار.',true);return;}
 if(!confirm(LANG==='en'?'Send a tiny synthetic text-only connectivity test to your key’s provider? No patient data, study context, images or archived reports are sent. Up to two requests / 65 seconds; quota may apply.':'إرسال اختبار اتصال نصي صغير للمزوّد الموافق لمفتاحك؟ لا يُرسل أي اسم أو بيانات مريض أو سياق دراسة أو صور أو تقارير مؤرشفة. حتى طلبين خلال 65 ثانية، وقد يُحتسب من الحصة.'))return;
 const job={controller:new AbortController()};aiProbe=job;aiTraceStart('connectivity-text-only');
 const gen=$('ai-gen'),test=$('ai-test'),cancel=$('ai-cancel');gen.disabled=true;test.disabled=true;cancel.hidden=false;
 try{
  const payload={text:'Connectivity test only, no medical content. Return exactly this JSON: {"findings":["CONNECTION_OK"],"impression":["CONNECTION_OK"]}',images:[]};
  const requests=cfg.models.slice(0,2).map(model=>({...aiRequestFor(provider,key,model,payload),model}));
  const result=await aiRunRequests(requests,{signal:job.controller.signal,attemptsPerModel:1,attemptMs:30000,budgetMs:65000,trace:aiTrace,progress:p=>aiJobState(LANG==='en'?`Testing text-only connectivity · ${p.model} · attempt ${p.attempt}/2`:`اختبار اتصال نصي فقط · ${p.model} · محاولة ${p.attempt}/2`)});
  aiJobState(LANG==='en'?`Text-only connectivity succeeded (${result.model}). This does NOT verify image upload or report generation. Open Technical diagnostics to share the result.`:`نجح الاتصال النصي (${result.model}). هذا لا يثبت نجاح رفع الصور أو توليد التقرير. افتح «تشخيص الاتصال التقني» لإرسال النتيجة.`);
 }catch(e){aiJobState((LANG==='en'?'Connectivity test: ':'اختبار الاتصال: ')+aiErrorText(e),true);}
 finally{aiProbe=null;gen.disabled=false;test.disabled=false;cancel.hidden=true;}
}
let aiJob=null;
function aiCancel(){if(aiJob)aiJob.controller.abort();if(aiProbe)aiProbe.controller.abort();}
function aiJobState(text,bad=false){
 for(const id of ['ingest-status','ai-job-status']){const el=$(id);if(el){el.textContent=text;el.dataset.status=bad?'warning':'info';el.style.color=bad?'#fca5a5':'#86efac';}}
}
function aiErrorText(e){
 const en=LANG==='en', code=e.code||'unknown';
 const msgs={
  unavailable:['The AI service is temporarily overloaded (503/5xx). Bounded retries failed. Your text is unchanged; retry later.','خدمة AI مزدحمة مؤقتًا (503/5xx). لم تنجح المحاولات المحدودة. نصك لم يتغير؛ حاول لاحقًا.'],
  timeout:['The request exceeded its time limit. Your text is unchanged; retry later.','تجاوز الطلب مهلة الانتظار. نصك لم يتغير؛ أعد المحاولة لاحقًا.'],
  network:['Network connection failed or was blocked. Check your connection; this is not a confirmed timeout or invalid key.','تعذر الاتصال أو حُجب الطلب. تحقق من الشبكة؛ هذا ليس دليلًا على انتهاء المهلة أو خطأ المفتاح.'],
  auth:['The provider rejected authorization (401/403). Check the key and API permissions.','رفض المزوّد التفويض (401/403). تحقق من المفتاح وصلاحيات API.'],
  quota:['The provider reports exhausted quota/billing limits. Check the provider account; repeated requests will not fix this.','أبلغ المزوّد عن نفاد الحصة/حدود الفوترة. تحقق من حساب المزوّد؛ تكرار الطلب لا يحل هذا.'],
  'rate-limit':['The provider is limiting requests (429). Wait before retrying.','المزوّد يقيّد عدد الطلبات (429). انتظر قبل إعادة المحاولة.'],
  'model-unavailable':['The configured models are unavailable (404). No draft was inserted.','النماذج المحددة غير متاحة (404). لم تُدرج مسودة.'],
  'invalid-response':['The provider returned incomplete or invalid report text. Nothing was inserted; retry later.','أعاد المزوّد تقريرًا ناقصًا أو غير صالح. لم يُدرج شيء؛ أعد المحاولة لاحقًا.'],
  blocked:['The provider blocked the response. No draft was inserted.','حجب المزوّد الاستجابة. لم تُدرج مسودة.'],
  cancelled:['AI request cancelled. Your text is unchanged.','أُلغي طلب AI. نصك لم يتغير.'],
  changed:['The study or report changed during generation. The old response was discarded to protect your edits.','تغيرت الدراسة أو نص التقرير أثناء التوليد؛ أُهمل الرد القديم لحماية تعديلاتك.']
 };
 return (msgs[code]||['AI request failed. Your text is unchanged.','فشل طلب AI. نصك لم يتغير.'])[en?0:1];
}
async function aiGenerate(study) {
  if(aiJob||aiProbe)return;
  const keyEl = $("ai-key");
  const key = (keyEl && keyEl.value.trim()) || "";
  persistAiKey();
  const say = aiJobState;
  const serverSelected=$("ai-provider")?.value==="server";
  if(serverSelected&&!$("ai-service-token")?.value.trim()){say(LANG==="en"?"Enter the institution AI access token (session only).":"أدخل رمز الوصول لذكاء المؤسسة (للجلسة فقط).",true);return;}
  if (!key&&!serverSelected) { say(LANG === "en" ? "Add your free API key first — easiest without card: console.groq.com → API Keys (gsk…)." : "أضف مفتاحك المجاني أولًا — أسهل خيار بلا بطاقة: console.groq.com ← API Keys (يبدأ بـ gsk).", true); return; }
  const hint = serverSelected ? null : aiProviderForKey(key);
  if (hint === "openai-unsupported") {
    say(LANG === "en" ? "This looks like an OpenAI key: OpenAI usage requires paid credits (card) and is not supported here. Create a free key from Groq (gsk…) or OpenRouter (sk-or…) or Gemini (AQ…/AIza…)." : "هذا يبدو مفتاح OpenAI: استخدام OpenAI يحتاج رصيدًا مدفوعًا (بطاقة) وهو غير مدعوم هنا. أنشئ مفتاحًا مجانيًا من Groq (gsk…) أو OpenRouter (sk-or…) أو Gemini (AQ…/AIza…).", true);
    return;
  }
  const provEl = $("ai-provider");
  let provider = (provEl && provEl.value) || "groq";
  if (hint && hint !== provider) {
    provider = hint;
    if (provEl) provEl.value = provider;
    say(LANG === "en" ? "Provider auto-switched to match the key shape: " + provider : "بُدّل المزوّد تلقائيًا ليطابق شكل المفتاح: " + provider);
  }
  try { localStorage.setItem("rrai-ai-provider", provider); } catch (e) {}
  const provName = provider === "groq" ? "Groq" : provider === "openrouter" ? "OpenRouter" : provider === "gemini" ? "Google Gemini" : provider === "server" ? (LANG === "en" ? "the institution server" : "سيرفر المؤسسة") : provider;
  const extraTxt = aiExtraImgs.length ? (LANG === "en" ? " + " + aiExtraImgs.length + " attached screenshot(s)" : " + " + aiExtraImgs.length + " لقطة شاشة مرفقة") : "";
  const retryConsent=LANG==='en'?" Up to 4 attempts within 4 minutes, on the same provider only; cancel at any time. Existing report text will be replaced only if unchanged while waiting.":" حتى 4 محاولات خلال 4 دقائق لدى نفس المزوّد فقط، مع إمكانية الإلغاء. يُستبدل النص الحالي فقط إذا لم تعدّله أثناء الانتظار.";
  const okConsent = window.confirm(retryConsent + (provider==="server"?(LANG==="en"?"Send your clinical notes and limited study context (no images or raw DICOM) to the institution AI service for this request?":"إرسال الملاحظات السريرية وسياق الفحص المحدود (بدون صور أو DICOM خام) إلى ذكاء المؤسسة لهذا الطلب؟") : LANG === "en" ? "Send up to 6 slice renders" + extraTxt + " + numeric stats (NOT raw DICOM) to " + provName + " for this one request?" : "إرسال حتى 6 لقطات شرائح مصغّرة" + extraTxt + " + إحصاءات رقمية (ليس DICOM الخام) إلى " + provName + " لهذا الطلب الواحد فقط؟"));
  if (!okConsent) return;
  const job={study,controller:new AbortController(),snapshot:JSON.stringify(readComposer()),started:Date.now(),dirty:false};
  aiJob=job;aiTraceStart('report-generation');if($('ai-test'))$('ai-test').disabled=true;
  const edited=()=>{job.dirty=true;};
  const fields=['rep-exam','rep-indication','rep-technique','rep-findings','rep-impression','rep-notes'];
  fields.forEach(id=>$(id)?.addEventListener('input',edited));
  const gen=$('ai-gen'),cancel=$('ai-cancel');if(gen)gen.disabled=true;if(cancel)cancel.hidden=false;
  let progress={attempt:1,model:'',state:'request'};
  const showProgress=()=>{const seconds=Math.floor((Date.now()-job.started)/1000);say(LANG==='en'?`AI ${progress.state==='retry'?'temporarily unavailable; retrying':'drafting'} — attempt ${progress.attempt}/4 · ${progress.model} · ${seconds}s / 240s. You can cancel.`:`${progress.state==='retry'?'تعذر الطلب مؤقتًا؛ إعادة محاولة':'توليد مسودة AI'} — محاولة ${progress.attempt}/4 · ${progress.model} · ${seconds}ث / 240ث. يمكنك الإلغاء.`);};
  const ticker=setInterval(showProgress,1000);
  try{
  const n = study.frames.length;
  const idxs = n <= 6 ? study.frames.map((_, i) => i) : [0, Math.round((n - 1) * 0.2), Math.round((n - 1) * 0.4), Math.round((n - 1) * 0.6), Math.round((n - 1) * 0.8), n - 1].filter((v, i2, a) => a.indexOf(v) === i2);
  const images = idxs.map((i) => sliceRenderB64(study, i)).concat(aiExtraImgs).slice(0, 8);
  let totalB64 = images.reduce((a, b) => a + b.length, 0);
  while (totalB64 > 3500000 && images.length > 6) { totalB64 -= images.pop().length; }
  const payload = { text: aiPromptText({...study,report:{...study.report,...readComposer()}}), images: images };
  const cfg=AI_PROVIDERS[provider]||AI_PROVIDERS.groq;
  let requests;
  if(cfg.serverSide){
   requests=[{model:'institution',server:true,url:location.origin+'/api/report_ai',headers:{'Content-Type':'application/json',Authorization:'Bearer '+$('ai-service-token').value.trim()},body:{context:aiServerContext(study),notes:$('rep-notes')?.value||''}}];
  }else{
   const models=cfg.models.filter(model=>!payload.images.length||cfg.native||cfg.vision[model]).slice(0,2);
   if(!models.length)throw aiFailure('model-unavailable');
   requests=models.map(model=>({...aiRequestFor(provider,key,model,payload),model}));
  }
  const result=await aiRunRequests(requests,{trace:aiTrace,signal:job.controller.signal,budgetMs:Math.max(1,240000-(Date.now()-job.started)),progress:p=>{progress=p;showProgress();}});
  if(job.controller.signal.aborted)throw aiFailure('cancelled');
  if(current!==study||job.dirty||JSON.stringify(readComposer())!==job.snapshot)throw aiFailure('changed');
  fillComposerFromAi(study,result.obj);
  say(LANG==='en'?`AI draft inserted (${result.model}) — review the images and all report text before export.`:`أُدرجت مسودة AI (${result.model}) — راجع الصور وكل نص التقرير قبل التصدير.`);
  }catch(e){say(aiErrorText(e),true);}
  finally{clearInterval(ticker);fields.forEach(id=>$(id)?.removeEventListener('input',edited));if(aiJob===job){aiJob=null;if($('ai-test'))$('ai-test').disabled=false;if(gen)gen.disabled=false;if(cancel)cancel.hidden=true;}}
}

function setupAi() {
  const k = $("ai-key");
  if (!k) return;
  const remember=$("ai-key-remember");
  try {remember.checked=localStorage.getItem("rrai-ai-key-remember")==="1";if(remember.checked)k.value=localStorage.getItem("rrai-ai-key")||"";else localStorage.removeItem("rrai-ai-key");}catch(e){}
  k.addEventListener("input",persistAiKey);remember.addEventListener("change",persistAiKey);
  $("ai-key-clear").onclick=()=>{k.value="";remember.checked=false;persistAiKey();const t=$("ai-service-token");if(t)t.value="";};
  const pv = $("ai-provider");
  if (pv) { try { pv.value = localStorage.getItem("rrai-ai-provider") || "groq"; } catch (e) {} }
  if($("ai-test"))$("ai-test").onclick=aiConnectionTest;
  if($("ai-cancel"))$("ai-cancel").onclick=aiCancel;
  const b = $("ai-gen");
  if (b) b.addEventListener("click", () => { if (current) aiGenerate(current); });
  const extraEl = $("ai-extra");
  if (extraEl) extraEl.addEventListener("change", async () => {
    const cnt = $("ai-extra-count");
    aiExtraImgs = [];
    const files = Array.from(extraEl.files || []).slice(0, 2);
    for (const f of files) {
      if (!/^image\/(png|jpeg)$/.test(f.type)) continue;
      const b64 = await fileToJpegB64(f, 768, 0.8);
      if (b64) aiExtraImgs.push(b64);
    }
    if (cnt) cnt.textContent = aiExtraImgs.length ? (LANG === "en" ? aiExtraImgs.length + " extra screenshot(s) attached" : "مرفق " + aiExtraImgs.length + " لقطة إضافية") : "";
  });
}
function examNameFor(study) {
  const meta = study.meta || {};
  const fileLabel = studyTypeLabel(study);
  if (fileLabel && !/^(OT|CR|DX|MR|CT|US)$/i.test(fileLabel.trim())) {
    const mod = String(study.modality || "").toUpperCase();
    const hasMod = new RegExp("\\b" + mod + "\\b", "i").test(fileLabel);
    return hasMod ? fileLabel : (mod ? mod + " — " + fileLabel : fileLabel);
  }
  const src = ((meta.studyDesc || "") + " " + (meta.bodyPart || "") + " " + (study.description || "")).toUpperCase();
  const mod = study.modality || "CR";
  let region = "";
  const map = [["LUMBAR", "Lumbosacral Spine"], ["LS ", "Lumbosacral Spine"], ["L-S", "Lumbosacral Spine"], ["CERVICAL", "Cervical Spine"], ["THORACIC SPINE", "Thoracic Spine"], ["BRAIN", "Brain"], ["HEAD", "Head"], ["CHEST", "Chest"], ["THORAX", "Chest"], ["ABDOMEN", "Abdomen"], ["PELVIS", "Pelvis"], ["KNEE", "Knee"], ["SHOULDER", "Shoulder"], ["HIP", "Hip"], ["WRIST", "Wrist"], ["ANKLE", "Ankle"], ["FOOT", "Foot"], ["HAND", "Hand"], ["ELBOW", "Elbow"]];
  for (const [k, v] of map) if (src.includes(k)) { region = v; break; }
  const base = mod === "CR" || mod === "DX" ? (region === "Chest" ? "Chest Radiograph" : (region ? "Radiograph of the " + region : "Plain Radiograph")) : mod + " " + (region || "Study");
  const contrast = /CONTRAST|IV |GAD|POST/.test(src) ? " with IV Contrast" : "";
  return base + contrast;
}
function composerDefaults(study) {
  // New cases begin with empty clinical Findings/Impression, never a triage summary.
  return {exam:examNameFor(study),indication:study.indication||'',findings:'',impression:'',notes:''};
}
export function reportLinesText(value){return Array.isArray(value)?value.map(x=>String(x??'')).join('\n'):String(value??'');}
function readComposer() {
  const g = (id) => { const e = $(id); return e ? String(e.value || "").trim() : ""; };
  const exam = g("rep-exam"), indication = g("rep-indication"), f = g("rep-findings"), i = g("rep-impression"), notes = g("rep-notes");
  if (!exam && !indication && !f && !i && !notes) return null;
  return { exam, indication, technique:g("rep-technique"), findings: f ? f.split("\n").map((x) => x.trim()).filter(Boolean) : [], impression: i ? i.split("\n").map((x) => x.trim()).filter(Boolean) : [], notes };
}
function prefillComposer(study) {
  if (!study || !$("rep-exam")) return;
  reportExportEdited();
  const d = study.report || composerDefaults(study);
  $("rep-exam").value = d.exam || "";
  $("rep-indication").value = d.indication || "";
  $("rep-findings").value = reportLinesText(d.findings);
  $("rep-impression").value = reportLinesText(d.impression);
  { const te=$("rep-technique");if(te)te.value=d.technique||techniqueFor(study); }
  { const nn = $("rep-notes"); if (nn) nn.value = d.notes || ""; }
}
function setupComposer() {
  if (!$("rep-exam")) return;
  let t = null;
  const save = () => {
    if (!current) return;
    const e = $("rep-exam"), ind = $("rep-indication"), f = $("rep-findings"), im = $("rep-impression");
    current.report = { technique:($("rep-technique")?.value||"").trim(), exam: e.value.trim(), indication: ind.value.trim(), findings: f.value.trim(), impression: im.value.trim(), notes: ($("rep-notes") ? $("rep-notes").value.trim() : "") };
    putStudy(current);
  };
  for (const id of ["rep-exam", "rep-indication", "rep-technique", "rep-findings", "rep-impression", "rep-notes"]) {
    $(id).addEventListener("input", () => { clearTimeout(t); t = setTimeout(save, 600); });
  }
  const bankRoot = $("bank-set");
  if (bankRoot) bankRoot.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest("[data-bank]") : null;
    if (!b) return;
    const ta = $(b.getAttribute("data-bank") === "i" ? "rep-impression" : "rep-findings");
    if (!ta) return;
    reportExportEdited();
    const sent = (b.getAttribute("data-sent") || b.textContent || "").trim();
    ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + sent;
    save();
  });
}
const PHRASE_LIB = {
  brain: { f: [
    "The **brain parenchyma** shows no focal intra-axial lesion or abnormal signal intensity.",
    "The **ventricular system** is normal in size and configuration, with no hydrocephalus and no midline shift.",
    "The **extra-axial spaces** are clear, with no subdural or epidural collection.",
    "The **sella and suprasellar region** show post-operative changes with no definite residual enhancing tissue.",
    "The **basal cisterns**, **brainstem** and **cerebellum** appear unremarkable.",
    "No restricted diffusion to suggest acute infarction on **DWI**."], i: [
    "IMPRESSION: no acute intracranial abnormality; post-operative changes as described.",
    "IMPRESSION: correlate with prior imaging for residual or recurrent disease."] },
  spine: { f: [
    "Post-operative changes are noted in the lower **lumbar spine**, consistent with previous laminectomy and posterior instrumentation (pedicle screws/rods) at the L4–L5–S1 levels, associated with susceptibility artifacts.",
    "Evaluation of all lumbar **intervertebral discs** reveals multi-level disc desiccation (loss of normal T2 hyperintense signal).",
    "At the L4–L5 and L5–S1 levels, there are residual posterior **disc bulges** indenting the ventral **thecal sac**.",
    "Enhancing **epidural fibrosis**/scar tissue is noted at the surgical bed, wrapping around the **nerve roots** and contributing to **neural foraminal narrowing**.",
    "The **conus medullaris** terminates at a normal level and shows no abnormal signal.",
    "The posterior **paraspinal soft tissues** are unremarkable; there is no evidence of a post-operative fluid collection, seroma, or pseudomeningocele.",
    "The **spinal cord** shows no abnormal intrinsic signal, compression, or syrinx."], i: [
    "Post-operative changes of lower lumbar laminectomy and posterior fixation (L4–S1) with enhancing epidural fibrosis at the surgical bed.",
    "No evidence of post-operative fluid collection or pseudomeningocele.",
    "Multi-level lumbar **disc** desiccation with residual posterior **disc bulges** at the L4–L5 and L5–S1 levels.",
    "Given the clinical presentation, the differential diagnosis (DDx) primarily includes recurrent/residual mechanical discogenic pain versus radiculopathy secondary to the prominent epidural fibrosis. Clinical correlation is recommended."] },
  chest: { f: [
    "The **lungs** are clear with no focal consolidation, mass, or effusion.",
    "The **mediastinum** and **hila** are unremarkable; no significant lymphadenopathy.",
    "The **pleural spaces** are clear bilaterally; no pneumothorax.",
    "The **visualized bones** show no aggressive lesion or fracture."], i: [
    "IMPRESSION: no acute cardiopulmonary process."] },
  abdomen: { f: [
    "The **liver**, **spleen**, **pancreas** and **adrenal glands** show no focal lesion.",
    "The **kidneys** enhance symmetrically with no hydronephrosis or obstructing stone.",
    "The **bowel loops** are normal in calibre and distribution; no free fluid or free air.",
    "No significant **retroperitoneal or mesenteric lymphadenopathy**."], i: [
    "IMPRESSION: no acute intra-abdominal process."] },
  msk: { f: [
    "The **distal femur**, **proximal tibia** and **patella** show normal marrow signal with no fracture or bone marrow edema.",
    "The **medial** and **lateral menisci** are normal in shape and signal with no tear.",
    "The **ACL**, **PCL**, **MCL** and **LCL** are intact with normal course and signal.",
    "The **articular cartilage** is preserved; no significant **joint effusion** or loose body.",
    "Abnormal linear hyperintense signal within the **posterior horn of the medial meniscus** is suspicious for a partial tear.",
    "The **ACL** is thickened with intrasubstance high signal though fibers grossly continuous — sprain/low-grade partial tear.",
    "**Bone marrow edema** in the **proximal tibia** correlates with the history of recent trauma.",
    "Moderate **knee joint effusion** with fluid extending into the **suprapatellar bursa**."], i: [
    "No acute internal derangement of the knee.",
    "Suspected partial tear of the posterior horn of the medial meniscus; ACL sprain; moderate effusion."] },
  generic: { f: [
    "No focal lesion, abnormal signal intensity, or mass effect is identified.",
    "Comparison with prior studies is recommended when available."], i: [
    "Unremarkable study; no acute abnormality identified.",
    "IMPRESSION: clinical correlation recommended."] }
};
function bankRegion(study) {
  const nm = String((study && (examNameFor(study) + " " + (study.description || ""))) || "").toUpperCase();
  if (/BRAIN|HEAD|PITUIT|SELLA/.test(nm)) return "brain";
  if (/SPINE|LUMBAR|CERVICAL|VERTEBR/.test(nm)) return "spine";
  if (/CHEST|THORAX/.test(nm)) return "chest";
  if (/ABDOM|PELV/.test(nm)) return "abdomen";
  if (/KNEE|SHOULDER|HIP|WRIST|ANKLE|FOOT|HAND|ELBOW|MUSCULOSK|MSK/.test(nm)) return "msk";
  return "generic";
}
function renderBank(study) {
  const root = $("bank-list");
  if (!root) return;
  const r = bankRegion(study);
  const lib = PHRASE_LIB[r] || PHRASE_LIB.generic;
  root.textContent = "";
  const hdr = document.createElement("p");
  hdr.style.cssText = "margin:.5rem 0 .3rem;opacity:.7;";
  hdr.textContent = (LANG === "en" ? "Phrases matched to this study (" + r + ")" : "صياغات مطابقة لهذه الدراسة (" + r + ")") + " — " + APP_BUILD;
  root.appendChild(hdr);
  const mk = (kind, sent) => {
    const p = document.createElement("p"); p.style.cssText = "margin:0 0 .3rem;";
    const b = document.createElement("button"); b.className = "ghost";
    b.setAttribute("data-bank", kind); b.setAttribute("data-sent", sent);
    b.style.cssText = "white-space:normal;text-align:left;direction:ltr;";
    b.textContent = sent.replace(/\*\*/g, "");
    p.appendChild(b); return p;
  };
  for (const x of lib.f) root.appendChild(mk("f", x));
  for (const x of lib.i) root.appendChild(mk("i", x));
  if (r !== "generic") {
    const h2 = document.createElement("p"); h2.style.cssText = "margin:.5rem 0 .3rem;opacity:.7;";
    h2.textContent = LANG === "en" ? "General:" : "عام:";
    root.appendChild(h2);
    for (const x of PHRASE_LIB.generic.f) root.appendChild(mk("f", x));
    for (const x of PHRASE_LIB.generic.i) root.appendChild(mk("i", x));
  }
}
const TPL_SEEDS = [
  { id: "s-brain-n", region: "brain", name: "Brain — normal", nameAr: "الدماغ — طبيعي", f: [
    "The **brain parenchyma** shows preserved gray-white matter differentiation with no focal lesion, mass effect, or abnormal enhancement.",
    "The **ventricular system** and **basal cisterns** are normal in caliber and configuration; no hydrocephalus or midline shift.",
    "The **extra-axial spaces** are clear; no subdural or epidural collection.",
    "The **brainstem**, **cerebellum** and **deep gray nuclei** are unremarkable; major **vascular flow voids** are preserved."], i: [
    "No acute intracranial abnormality; no pathological contrast enhancement."] },
  { id: "s-brain-p", region: "brain", name: "Brain — post-op residual/recurrence", nameAr: "الدماغ — بقايا/نكس بعد جراحة", f: [
    "Post-surgical changes at the **operative site** with expected local encephalomalacia and gliosis.",
    "Avid, thick, irregular, nodular enhancement along the **surgical cavity margins** suggests residual/recurrent viable tumor.",
    "Surrounding **vasogenic edema** with mild local mass effect and effacement of adjacent **cortical sulci**.",
    "No significant **midline shift** or acute intracranial hemorrhage; the **ventricular system** is unremarkable."], i: [
    "Enhancement along the surgical bed is highly suspicious for residual/recurrent disease; compare with the prior study.",
    "Urgent multidisciplinary oncology and neurosurgical consultation is recommended."] },
  { id: "s-spine-n", region: "spine", name: "Spine — normal", nameAr: "العمود الفقري — طبيعي", f: [
    "**Vertebral alignment** is maintained with normal vertebral body heights and marrow signal.",
    "The **intervertebral discs** show preserved height and signal with no significant bulge or herniation.",
    "The **spinal cord** and **conus medullaris** are normal in caliber and signal; no canal stenosis.",
    "The **paraspinal soft tissues** are unremarkable."], i: [
    "No significant spinal canal or neural foraminal stenosis."] },
  { id: "s-spine-p", region: "spine", name: "Spine — post-op lumbar (laminectomy + fixation)", nameAr: "العمود الفقري — بعد جراحة قطنية", f: [
    "Post-operative changes of lower lumbar **laminectomy** and posterior instrumentation (pedicle screws/rods) with susceptibility artifacts.",
    "Enhancing **epidural fibrosis** at the surgical bed wraps around the **nerve roots** with **neural foraminal narrowing**.",
    "Multi-level lumbar **disc desiccation** with residual posterior **disc bulges** indenting the ventral **thecal sac**.",
    "The **conus medullaris** is normal; no post-operative **fluid collection**, seroma, or pseudomeningocele."], i: [
    "Post-op changes with enhancing epidural fibrosis; no fluid collection or pseudomeningocele.",
    "DDx discogenic pain versus radiculopathy; clinical correlation recommended."] },
  { id: "s-msk-n", region: "msk", name: "Knee/MSK — normal", nameAr: "الركبة/المفاصل — طبيعي", f: [
    "The **distal femur**, **proximal tibia** and **patella** show normal marrow signal with no fracture or bone marrow edema.",
    "The **medial** and **lateral menisci** are normal in shape and signal with no tear.",
    "The **ACL**, **PCL**, **MCL** and **LCL** are intact; the **articular cartilage** is preserved.",
    "No significant **joint effusion**, loose body, or periarticular soft tissue abnormality."], i: [
    "No acute internal derangement of the knee."] },
  { id: "s-msk-p", region: "msk", name: "Knee — meniscal tear + ACL sprain + effusion", nameAr: "الركبة — تمزق غضروف + التواء ACL + انصباب", f: [
    "Abnormal linear hyperintense signal within the **posterior horn of the medial meniscus** is highly suspicious for a partial tear; the **lateral meniscus** is unremarkable.",
    "The **ACL** is thickened with intrasubstance high signal though fibers grossly continuous — sprain/low-grade partial tear; the **PCL** is intact.",
    "The **MCL** and **LCL** are intact; the **quadriceps** and **patellar tendons** demonstrate normal thickness and signal.",
    "**Bone marrow edema** in the **proximal tibia** correlates with the history of recent trauma.",
    "Moderate **knee joint effusion** with fluid extending into the **suprapatellar bursa**."], i: [
    "Suspected partial tear involving the posterior horn of the medial meniscus.",
    "Sprain/low-grade partial tear of the ACL; bone marrow edema of the proximal tibia.",
    "Moderate knee joint effusion."] },
  { id: "s-chest-n", region: "chest", name: "Chest — normal", nameAr: "الصدر — طبيعي", f: [
    "The **lungs** are clear with no focal consolidation, mass, or nodule.",
    "The **mediastinum** and **hila** are unremarkable; no significant lymphadenopathy.",
    "The **pleural spaces** are clear; no effusion or pneumothorax.",
    "The **cardiac silhouette** is within normal limits; the **visualized bones** show no aggressive lesion."], i: [
    "No acute cardiopulmonary process."] },
  { id: "s-chest-p", region: "chest", name: "Chest — pneumonia + parapneumonic effusion", nameAr: "الصدر — التهاب رئوي + انصباب", f: [
    "A focal **consolidation** with air bronchograms is noted in the affected lobe, consistent with pneumonia.",
    "A small **pleural effusion** blunts the ipsilateral costophrenic angle.",
    "The **mediastinum** is central; no significant **lymphadenopathy**; no **pneumothorax**.",
    "The **visualized bones** are unremarkable."], i: [
    "Lobar pneumonia with a small parapneumonic effusion; recommend follow-up to resolution."] },
  { id: "s-abd-n", region: "abdomen", name: "Abdomen — normal", nameAr: "البطن — طبيعي", f: [
    "The **liver**, **spleen**, **pancreas** and **adrenal glands** show no focal lesion.",
    "The **gallbladder** and **biliary tree** are unremarkable; no stone or ductal dilatation.",
    "The **kidneys** enhance symmetrically with no hydronephrosis or stone.",
    "The **bowel loops** are normal in caliber; no free fluid, free air, or significant **lymphadenopathy**."], i: [
    "No acute intra-abdominal process."] },
  { id: "s-abd-p", region: "abdomen", name: "Abdomen — acute calculous cholecystitis", nameAr: "البطن — التهاب مرارة حصوي حاد", f: [
    "The **gallbladder** is distended with wall thickening and pericholecystic fluid; multiple **stones** including an impacted **neck stone**.",
    "The **biliary tree** shows no significant dilatation; the **liver** and **pancreas** are otherwise unremarkable.",
    "No free fluid or free air; no significant **lymphadenopathy**."], i: [
    "Acute calculous cholecystitis; surgical consultation recommended."] }
];
function tplAll() {
  let custom = [];
  try { custom = JSON.parse(localStorage.getItem("rrai-tpl-custom") || "[]"); } catch (e) {}
  return TPL_SEEDS.concat(Array.isArray(custom) ? custom : []);
}
function archiveLoad() {
  try { const a = JSON.parse(localStorage.getItem("rrai-archive") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function archiveStore(a) {
  try { localStorage.setItem("rrai-archive", JSON.stringify(a.slice(0, 300))); } catch (e) {}
}
function archiveSave(study, comp, info) {
  const meta = (study && study.meta) || {};
  const e = {
    id: (info && info.hash) ? "h" + info.hash.slice(0, 16) : "t" + Date.now(),
    ts: (info && info.at) || new Date().toISOString(),
    status: (info && info.status) || "draft",
    patient: meta.patientName || (study && study.patient) || "—",
    sex: meta.sex || "—", age: meta.age || "—", studyDate: meta.studyDate || "",
    modality: (study && study.modality) || "CR",
    exam: (comp && comp.exam) || "", indication: (comp && comp.indication) || "",
    technique: (comp && comp.technique) || ((study && study.report && study.report.technique) || ""),
    findings: reportLinesText(comp?.findings), impression: reportLinesText(comp?.impression),
    studyUid: study?.uid || "",
    notes: (comp && comp.notes) || "",
    signer: (info && info.signer) || "", license: (info && info.license) || "", hash: (info && info.hash) || "",
    fuMonths: (info && typeof info.fuMonths === "number") ? info.fuMonths : (() => { try { const el = document.getElementById("fu-months"); return el ? (parseInt(el.value, 10) || 0) : 0; } catch (e2) { return 0; } })()
  };
  const a = archiveLoad();
  const ix = a.findIndex((x) => x.id === e.id);
  if (ix >= 0) a[ix] = e; else a.unshift(e);
  archiveStore(a);
  try { if (typeof aiExtraImgs !== "undefined" && aiExtraImgs && aiExtraImgs.length) attachPut(e.id, aiExtraImgs.slice(0, 2)); } catch (e2) {}
  return e;
}
function archiveExport(e) {
  const review=reportReview(e);
  if(review.length&&!window.confirm(review.map(x=>x[LANG==="en"?"en":"ar"]).join("\n")+"\n"+(LANG==="en"?"Continue after physician review?":"المتابعة بعد مراجعة الطبيب؟")))return;
  const study = { meta: { patientName: e.patient, sex: e.sex, age: e.age, studyDate: e.studyDate }, modality: e.modality, patient: e.patient,
    report: { exam: e.exam, indication: e.indication, findings: e.findings, impression: e.impression, technique: e.technique, notes: e.notes },
    signedBy: e.signer, license: e.license, docHash: e.hash };
  const comp = { exam: e.exam, indication: e.indication, technique: e.technique,
    findings: reportLinesText(e.findings).split("\n").filter(Boolean), impression: reportLinesText(e.impression).split("\n").filter(Boolean) };
  let org = { ar: "مؤسسة صحية", en: "Health Facility" };
  try { org = Object.assign(org, JSON.parse(localStorage.getItem("rrai-org") || "{}")); } catch (err) {}
  const d = { ar: "", en: "" };
  const bytes = buildDocxReportEn(study, d, { signer: e.signer || "—", license: e.license, org: org, at: e.ts, hash: e.hash || "archived" }, comp);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const el = document.createElement("a");
  el.href = URL.createObjectURL(blob);
  el.download = "rrai-archived-" + safeFilePart(e.patient) + ".docx";
  document.body.appendChild(el); el.click();
  setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 400);
}
function fuDue(e) {
  if (!e || !e.fuMonths) return null;
  const t = Date.parse(e.ts || ""); if (isNaN(t)) return null;
  const d = new Date(t); d.setMonth(d.getMonth() + e.fuMonths); return d;
}
function renderArchive() {
  const root = $("archive-list");
  if (!root) return;
  const q = (($("archive-q") && $("archive-q").value) || "").trim().toLowerCase();
  const a = archiveLoad().filter((e) => !q || String(e.patient + " " + e.exam + " " + e.hash).toLowerCase().includes(q));
  const sum = $("archive-sum");
  if (sum) sum.textContent = (LANG === "en" ? "Saved reports archive (" : "أرشيف التقارير المحفوظة (") + archiveLoad().length + ")";
  const dueNow = Date.now();
  const dueN = archiveLoad().filter((e) => { const d = fuDue(e); return d && d.getTime() <= dueNow; }).length;
  if (sum && dueN) sum.textContent += (LANG === "en" ? " — due follow-ups: " : " — متابعات مستحقة: ") + dueN;
  root.textContent = "";
  if (!a.length) {
    const p = document.createElement("p"); p.style.cssText = "opacity:.7;margin:.4rem 0;";
    p.textContent = LANG === "en" ? "No saved reports yet — exports are archived automatically." : "لا تقارير محفوظة بعد — يُحفظ كل تصدير Word تلقائيًا هنا.";
    root.appendChild(p); return;
  }
  updatePurgeWarn();
  for (const e of a) {
    const row = document.createElement("p");
    row.style.cssText = "margin:0 0 .4rem;padding:.5rem;border:1px solid #334155;border-radius:.5rem;background:#0b1220;";
    const h = document.createElement("span");
    h.style.cssText = "display:block;font-size:.8rem;opacity:.95;";
    h.textContent = e.patient + " — " + (e.exam || e.modality) + " — " + String(e.ts).slice(0, 10) + " " + (e.status === "signed" ? (LANG === "en" ? "[signed]" : "[موقع]") : (LANG === "en" ? "[draft]" : "[مسودة]"));
    const due = fuDue(e);
    if (due) {
      const ds = due.toISOString().slice(0, 10);
      const overdue = due.getTime() <= Date.now();
      const fb = document.createElement("span");
      fb.style.cssText = "display:inline-block;margin-inline-start:.4rem;font-size:.7rem;padding:.05rem .45rem;border-radius:1rem;background:" + (overdue ? "#7c2d12;color:#fed7aa;" : "#1e3a5f;color:#bfdbfe;");
      fb.textContent = (overdue ? (LANG === "en" ? "⏰ follow-up due " : "⏰ متابعة مستحقة ") : (LANG === "en" ? "follow-up " : "متابعة ")) + ds;
      h.appendChild(fb);
      if (overdue) row.style.borderColor = "#b45309";
    }
    row.appendChild(h);
    const bar = document.createElement("span");
    bar.style.cssText = "display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem;";
    const mk = (txt, fn) => { const b = document.createElement("button"); b.className = "ghost"; b.style.cssText = "padding:.2rem .6rem;font-size:.75rem;"; b.textContent = txt; b.addEventListener("click", fn); return b; };
    bar.appendChild(mk(LANG === "en" ? "Open in composer" : "فتح في المحرر", () => {
      if(!current||(e.studyUid?e.studyUid!==current.uid:String(e.patient||'').toUpperCase()!==String(current.meta?.patientName||current.patient||'').toUpperCase())){
        setStatus(LANG==='en'?'Open the matching study in the worklist before loading this archived report.':'افتح الدراسة المطابقة من القائمة قبل تحميل هذا التقرير المؤرشف.',true);return;
      }
      const f = $("rep-findings"), im = $("rep-impression"), ex = $("rep-exam"), ind = $("rep-indication"), nn = $("rep-notes");
      if (f && f.value.trim() && !window.confirm(LANG === "en" ? "Replace current composer content with this archived report?" : "استبدال محتوى المحرر الحالي بهذا التقرير المؤرشف؟")) return;
      reportExportEdited();$("composer-set").open=true;
      if($("rep-technique"))$("rep-technique").value=e.technique||"";
      if (ex) ex.value = e.exam || ""; if (ind) ind.value = e.indication || "";
      if (f) f.value = reportLinesText(e.findings); if (im) im.value = reportLinesText(e.impression); if (nn) nn.value = e.notes || "";
      if (current) { current.report = { exam: ex.value.trim(), indication: ind.value.trim(), findings: f.value.trim(), impression: im.value.trim(), technique: e.technique || "", notes: nn.value.trim() }; putStudy(current); }
      setStatus(LANG === "en" ? "Archived report loaded into the composer." : "فُتح التقرير المؤرشف في المحرر.", false);
    }));

    bar.appendChild(mk(LANG === "en" ? "Delete" : "حذف", () => { archiveStore(archiveLoad().filter((x) => x.id !== e.id)); attachDel(e.id); renderArchive(); }));
    row.appendChild(bar);
    attachGet(e.id).then((th) => {
      if (!th || !th.length) return;
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:flex;gap:.3rem;margin-top:.3rem;flex-wrap:wrap;";
      for (const t of th) {
        const im = document.createElement("img");
        im.src = t; im.alt = "لقطة مرفقة";
        im.style.cssText = "height:36px;border-radius:.3rem;border:1px solid #334155;cursor:pointer;";
        im.title = LANG === "en" ? "Attached screenshot — click to view" : "لقطة مرفقة بالتقرير — اضغط للعرض";
        im.addEventListener("click", () => {
          const w = window.open("", "_blank"); if (!w) return;
          w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>RRai attach</title><style>body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;}img{max-width:100%;}</style></head><body>' + th.map((x) => '<img src="' + x + '">').join("") + "</body></html>");
          w.document.close();
        });
        wrap.appendChild(im);
      }
      row.appendChild(wrap);
    });
    root.appendChild(row);
  }
}
function retentionSignedDays() { let d = 365; try { const v = parseInt(localStorage.getItem("rrai-retention-signed-days") || "365", 10); if (!isNaN(v)) d = v; } catch (e) {} return d; }
function setRetentionSignedDays(d) { try { localStorage.setItem("rrai-retention-signed-days", String(d)); } catch (e) {} }
function retentionDays() {
  let d = 90;
  try { const v = parseInt(localStorage.getItem("rrai-retention-days") || "90", 10); if (!isNaN(v)) d = v; } catch (e) {}
  return d;
}
function setRetentionDays(d) { try { localStorage.setItem("rrai-retention-days", String(d)); } catch (e) {} }
async function purgeOld() {
  const days = retentionDays();
  const sdays = retentionSignedDays();
  if ((!days || days <= 0) && (!sdays || sdays <= 0)) return { arch: 0, studies: 0 };
  const now = Date.now();
  let arch = 0;
  const a1 = archiveLoad().filter((e) => {
    const t = Date.parse(e.ts || ""); if (isNaN(t)) return true;
    const dd = e.status === "signed" ? sdays : days;
    if (!dd || dd <= 0) return true;
    if (t >= now - dd * 86400000) return true;
    arch++; return false;
  });
  const cutoff = now - days * 86400000;
  if (arch) { for (const e of archiveLoad()) { if (!a1.some((x) => x.id === e.id)) attachDel(e.id); } archiveStore(a1); }
  let studies = 0;
  try {
    const all = days > 0 ? await allStudies() : [];
    for (const st of all) {
      if (!st.createdAt) { st.createdAt = Date.now(); await putStudy(st); continue; }
      if (st.createdAt < cutoff) { await txDel(st.uid); if (current && current.uid === st.uid) current = null; studies++; }
    }
    if (studies) { try { await refresh(); } catch (e) {} }
  } catch (e) {}
  return { arch, studies };
}
async function computeStats() {
  const out = $("stats-out"); if (!out) return;
  try {
    const all = await allStudies();
    const urg = all.filter((s) => (s.triage && s.triage.priority === "urgent") || s.consult).length;
    const a = archiveLoad();
    const signed = a.filter((e) => e.status === "signed").length;
    const now = Date.now();
    const age = (e) => now - Date.parse(e.ts || now);
    const w1 = a.filter((e) => age(e) <= 7 * 86400000).length;
    const w0 = a.filter((e) => age(e) > 7 * 86400000 && age(e) <= 14 * 86400000).length;
    const m30 = a.filter((e) => age(e) <= 30 * 86400000).length;
    const dueN = a.filter((e) => { const d = fuDue(e); return d && d.getTime() <= now; }).length;
    const kb = Math.round(JSON.stringify(a).length / 1024);
    const trend = w1 > w0 ? "↑" : (w1 < w0 ? "↓" : "—");
    out.textContent =
      (LANG === "en" ? "Studies on device: " : "دراسات على الجهاز: ") + all.length + (LANG === "en" ? " (urgent/consult: " : " (حرج/استشارة: ") + urg + ")\n" +
      (LANG === "en" ? "Saved reports: " : "تقارير محفوظة: ") + a.length + (LANG === "en" ? " (signed: " : " (موقّع: ") + signed + (LANG === "en" ? ", drafts: " : "، مسودات: ") + (a.length - signed) + ")\n" +
      (LANG === "en" ? "Last 7 days: " : "آخر 7 أيام: ") + w1 + (LANG === "en" ? " (previous 7: " : " (السبعة السابقة: ") + w0 + ") " + trend + "\n" +
      (LANG === "en" ? "Avg reports/day (30d): " : "متوسط التقارير/يوم (30 يومًا): ") + (m30 / 30).toFixed(2) + "\n" +
      (LANG === "en" ? "Follow-ups due now: " : "متابعات مستحقة الآن: ") + dueN + "\n" +
      (LANG === "en" ? "Archive size: ~" : "حجم الأرشيف: ~") + kb + (LANG === "en" ? " KB" : " ك.ب");
  } catch (e) { out.textContent = String((e && e.message) || e); }
}
function a4Body() {
  const st = current; const meta = (st && st.meta) || {};
  const gv = (id) => { const el = $(id); return el ? el.value : ""; };
  let tech = gv("rep-technique");
  if (!tech && st) { try { tech = (st.report && st.report.technique) || techniqueFor(st); } catch (e) { tech = ""; } }
  const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bullets = String(gv("rep-impression")).split("\n").map((x) => x.trim()).filter(Boolean);
  const findings = String(gv("rep-findings")).split("\n").map((x) => x.trim()).filter(Boolean);
  const signer = gv("signer") || "—"; const lic = gv("signer-license") || "";
  let org = { ar: "", en: "" };
  try { org = Object.assign(org, JSON.parse(localStorage.getItem("rrai-org") || "{}")); } catch (e2) {}
  const orgLine = (org.en || org.ar) ? '<p style="text-align:center;color:#444;font-size:12px;margin:0 0 10px;">' + esc(org.en || "") + (org.ar && org.en ? " — " : "") + esc(org.ar || "") + "</p>" : "";
  return "<h1>MEDICAL RADIOLOGY REPORT</h1>" + orgLine +
    "<p><b>Patient Name:</b> " + esc(meta.patientName || (st && st.patient) || "—") + "<br><b>Sex:</b> " + esc(meta.sex || "—") + " <b>Age:</b> " + esc(meta.age || "—") + "<br><b>Exam Date:</b> " + esc(meta.studyDate || "") + "<br><b>Exam:</b> " + esc(gv("rep-exam")) + (gv("rep-indication") ? "<br><b>Clinical Indication:</b> " + esc(gv("rep-indication")) : "") + "</p>" +
    '<p class="sec">TECHNIQUE:</p><p>' + esc(tech) + "</p>" +
    '<p class="sec">FINDINGS:</p>' + findings.map((f) => "<p>" + esc(f) + "</p>").join("") +
    '<p class="sec">IMPRESSION:</p><div class="imp">' + bullets.map((b) => "<div>• " + esc(b) + "</div>").join("") + "</div>" +
    '<p style="text-align:right;margin-top:28px;">Reported by:<br><b>' + esc(signer) + "</b><br>" + esc(lic) + "</p>" +
    '<p class="small">Document SHA-256 is stamped at sign/export. Decision-support output; final clinical responsibility rests with the signing physician.</p>';
}
function a4Html() {
  return '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>RRai A4 preview</title><style>@page{size:A4;margin:18mm;}body{font-family:Calibri,Arial,sans-serif;color:#111;margin:0;padding:26px;max-width:210mm;}h1{color:#1f4e79;text-align:center;font-size:20px;letter-spacing:1px;margin:0 0 14px;}.sec{color:#1f4e79;font-weight:700;margin:12px 0 4px;}p{margin:4px 0;font-size:13px;line-height:1.45;}.imp{background:#efeaf5;padding:8px 10px;}.small{color:#777;font-size:10px;margin-top:18px;}button{margin:0 0 12px;padding:6px 14px;font-size:13px;border:1px solid #999;border-radius:6px;background:#fff;cursor:pointer;}@media print{button{display:none;}}</style></head><body><button onclick="window.print()">🖨 Print / طباعة</button>' + a4Body() + "</body></html>";
}
function ovPref(k) { try { return localStorage.getItem(k) !== "0"; } catch (e) { return true; } }
/** Same, with a real default for keys never set: the diagnostics layer is off until asked for. */
function ovPrefD(k, def) { try { const v = localStorage.getItem(k); if (v === null) return !!def; return v !== "0"; } catch (e) { return !!def; } }
function applyOverlayPrefs() {
  applyDxFoot();
  const sb = $("scan-btn");
  if (sb) {
    sb.style.display = ovPrefD("rrai-ov-diag", false) ? "inline-block" : "none";
    if (!sb.__wired) { sb.__wired = true; sb.addEventListener("click", () => scanSeries()); }
  }
  const vn = $("viewer-name"); if (vn) vn.style.display = ovPref("rrai-ov-name") ? "block" : "none";
  const mt = $("meta"); if (mt) mt.style.display = ovPref("rrai-ov-meta") ? "block" : "none";
}
function measureColor() { try { return localStorage.getItem("rrai-measure-color") || "#38bdf8"; } catch (e) { return "#38bdf8"; } }
function measureUnit() { try { return localStorage.getItem("rrai-measure-unit") || "mm"; } catch (e) { return "mm"; } }
function perfSmooth() { try { return localStorage.getItem("rrai-perf-smooth") !== "0"; } catch (e) { return true; } }
function pacsAuth() { const t=$("pacs-token")?.value.trim()||"";return t?{Authorization:"Bearer "+t}:{}; }
function critOnly() { try { return localStorage.getItem("rrai-crit-only") === "1"; } catch (e) { return false; } }
function anonName(nm) { let h = 5381; const s2 = String(nm); for (let i = 0; i < s2.length; i++) h = ((h << 5) + h + s2.charCodeAt(i)) | 0; return "ANON-" + (h >>> 0).toString(16).slice(0, 8).toUpperCase(); }
function critBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { const c = new AC(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { try { o.stop(); c.close(); } catch (e2) {} }, 250); }
    if (navigator.vibrate) navigator.vibrate([160, 90, 160]);
  } catch (e) {}
}
function applyTheme(t) {
  try { localStorage.setItem("rrai-theme", t); } catch (e) {}
  document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
}
function refreshStorage() {
  const out = $("storage-out"); if (!out) return;
  const mb = (x) => ((x || 0) / 1048576).toFixed(1);
  try {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((es) => {
        out.textContent = (LANG === "en" ? "Used locally: " : "المستخدم محليًا: ") + mb(es.usage) + " MB" + (es.quota ? (LANG === "en" ? " of ~" : " من ~") + mb(es.quota) + " MB" : "");
      }).catch(() => { out.textContent = LANG === "en" ? "Storage estimate unavailable." : "تعذّر تقدير المساحة."; });
    } else out.textContent = LANG === "en" ? "Storage estimate unavailable." : "تعذّر تقدير المساحة.";
  } catch (e) {}
}
function updDrawer() {
  const b = $("drawer-critical");
  if (b) {
    allStudies().then((all) => {
      const n = all.filter((s3) => (s3.triage && s3.triage.priority === "urgent") || s3.consult).length;
      b.textContent = (LANG === "en" ? "🚨 Critical cases only (" : "🚨 الحالات الحرجة فقط (") + n + ") — " + (critOnly() ? (LANG === "en" ? "ON" : "مفعّل") : (LANG === "en" ? "off" : "متوقف"));
    }).catch(() => {});
  }
  const stt = $("drawer-status");
  if (stt) stt.textContent = navigator.onLine ? (LANG === "en" ? "🟢 Browser reports online" : "🟢 المتصفح يُبلغ عن اتصال") : (LANG === "en" ? "⚪ Browser reports offline — local tools only" : "⚪ دون اتصال — أدوات محلية فقط");
}
let pacsAutoLast = 0;
function pacsAutoTick() {
  try {
    const mins = parseInt(localStorage.getItem("rrai-pacs-auto") || "0", 10) || 0;
    if (!mins) return;
    const now = Date.now();
    if (pacsAutoLast && now - pacsAutoLast < mins * 60000) return;
    pacsAutoLast = now;
    const base = (($("pacs-url") && $("pacs-url").value) || "").trim();
    if (!base) return;
    pacsFetch(relay(base + "/studies?limit=100"), { headers: Object.assign({ Accept: "application/dicom+json" }, pacsAuth()) })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j) => {
        if (!j || !Array.isArray(j)) return;
        const local = await allStudies();
        const luids = new Set(local.map((s4) => s4.uid));
        const news = j.filter((x) => x && x.StudyInstanceUID && !luids.has(x.StudyInstanceUID)).length;
        if (news > 0 && confirm((LANG === "en" ? "PACS has " : "في PACS ") + news + (LANG === "en" ? " new study(ies). Pull the first match now?" : " دراسة جديدة. سحب أول مطابقة الآن؟"))) { const pp = $("pacs-pull"); if (pp) pp.click(); }
      })
      .catch(() => {});
  } catch (e) {}
}
if (typeof window !== "undefined") setInterval(() => { try { pacsAutoTick(); } catch (e) {} }, 60000);
function applyDefaultExport() {
  const field=$('default-export-sel');if(field){field.value='word';field.disabled=true;}
  try{localStorage.setItem('rrai-default-export','word');}catch(e){}
}
function setupMenuSettings() {
  try { applyTheme(localStorage.getItem("rrai-theme") || "dark"); } catch (e) {}
  applyDefaultExport();
  document.addEventListener("keydown", (e) => {
    try {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      let map = {};
      try { map = JSON.parse(localStorage.getItem("rrai-keys") || "{}"); } catch (e2) {}
      const k = e.key;
      if (k === (map.next || "ArrowRight")) {
        if (mprOn) { mprSetIndex(mprFocus, mprIndex(mprFocus) + 1); }
        else { const sl = $("slice"); if (sl) { sl.value = String(Math.min(Number(sl.max), Number(sl.value) + 1)); sl.dispatchEvent(new Event("input")); } }
      }
      else if (k === (map.prev || "ArrowLeft")) {
        if (mprOn) { mprSetIndex(mprFocus, mprIndex(mprFocus) - 1); }
        else { const sl = $("slice"); if (sl) { sl.value = String(Math.max(0, Number(sl.value) - 1)); sl.dispatchEvent(new Event("input")); } }
      }
      else if (k === (map.fit || "f")) { const z = $("zoom-reset"); if (z) z.click(); }
      else if (k === (map.measure || "m")) { vsOpen(); const mm = $("measure"); if (mm) mm.click(); }
      else if (k === (map.zoomIn || "+") || (!map.zoomIn && k === "=")) {
        const f0 = curFrame();
        if (f0) { vst({ type: "zoomBy", factor: 1.25 }); vk = (vState && vState.zoom) || vk; centerOn(f0.w / 2, f0.h / 2); }
      }
      else if (k === (map.zoomOut || "-")) {
        const f0 = curFrame();
        if (f0) { vst({ type: "zoomBy", factor: 1 / 1.25 }); vk = (vState && vState.zoom) || vk; centerOn(f0.w / 2, f0.h / 2); }
      }
      else if (k === (map.invert || "i")) { vsOpen(); const b = $("orient-invert"); if (b) b.click(); }
      else if (k === (map.rotate || "r")) { vsOpen(); const b = $("orient-rotate"); if (b) b.click(); }
      else if (k === (map.flipH || "h")) { vsOpen(); const b = $("orient-fliph"); if (b) b.click(); }
      else if (k === (map.flipV || "v")) { vsOpen(); const b = $("orient-flipv"); if (b) b.click(); }
      else if (k === (map.contrast || "c")) {
        const ps = $("preset");
        if (ps && ps.options.length > 1) { ps.selectedIndex = (ps.selectedIndex + 1) % ps.options.length; ps.dispatchEvent(new Event("change")); }
      }
    } catch (e2) {}
  });
  for (const [iid, def] of [["ks-next", "ArrowRight"], ["ks-prev", "ArrowLeft"], ["ks-fit", "f"], ["ks-measure", "m"], ["ks-zoom-in", "+"], ["ks-zoom-out", "-"], ["ks-contrast", "c"]]) {
    const el = $(iid);
    if (!el) continue;
    let map0 = {};
    try { map0 = JSON.parse(localStorage.getItem("rrai-keys") || "{}"); } catch (e2) {}
    const keyName = iid === "ks-next" ? "next" : iid === "ks-prev" ? "prev" : iid === "ks-fit" ? "fit" : iid === "ks-measure" ? "measure" : iid === "ks-zoom-in" ? "zoomIn" : iid === "ks-zoom-out" ? "zoomOut" : "contrast";
    el.value = map0[keyName] || def;
    el.addEventListener("keydown", (ev) => {
      ev.preventDefault();
      el.value = ev.key;
      let mp = {};
      try { mp = JSON.parse(localStorage.getItem("rrai-keys") || "{}"); } catch (e2) {}
      mp[keyName] = ev.key;
      try { localStorage.setItem("rrai-keys", JSON.stringify(mp)); } catch (e2) {}
      setStatus(LANG === "en" ? "Shortcut saved." : "حُفظ الاختصار.", false);
    });
  }
  const dw = $("drawer");
  const openDw = (on) => { if (dw) dw.style.display = on ? "block" : "none"; if (on) updDrawer(); };
  const mb = $("menu-btn"); if (mb) mb.addEventListener("click", () => openDw(true));
  const dcl = $("drawer-close"); if (dcl) dcl.addEventListener("click", () => openDw(false));
  if (dw) dw.addEventListener("click", (e) => { if (e.target === dw) openDw(false); });
  const sm = $("settings-modal");
  const openSm = (on) => { if (sm) sm.style.display = on ? "block" : "none"; if (on) refreshStorage(); };
  const sb = $("settings-btn"); if (sb) sb.addEventListener("click", () => openSm(true));
  const scl = $("settings-close"); if (scl) scl.addEventListener("click", () => openSm(false));
  if (sm) sm.addEventListener("click", (e) => { if (e.target === sm) openSm(false); });
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
  bind("drawer-worklist", () => { openDw(false); const el = $("h-worklist"); if (el) el.scrollIntoView({ behavior: "smooth" }); });
  bind("drawer-critical", () => { const on = !critOnly(); try { localStorage.setItem("rrai-crit-only", on ? "1" : "0"); } catch (e) {} updDrawer(); refresh(); openDw(false); });
  bind("drawer-archive", () => { openDw(false); const a = $("archive-set"); if (a) { a.open = true; renderArchive(); a.scrollIntoView({ behavior: "smooth" }); } });
  bind("drawer-data", () => { openDw(false); const d = $("data-mgmt"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth" }); } });
  bind("drawer-ai", () => { openDw(false); const c = $("composer-set"); if (c) { c.open = true; c.scrollIntoView({ behavior: "smooth" }); } });
  bind("drawer-settings", () => { openDw(false); openSm(true); });
  bind("drawer-install", () => { openDw(false); setStatus(LANG === "en" ? "From the browser menu ⋮ choose \"Add to Home screen\" to install." : "من قائمة المتصفح ⋮ اختر «إضافة إلى الشاشة الرئيسية» للتثبيت.", false); });
  bind("drawer-help", () => { openDw(false); setStatus((LANG === "en" ? "Radiology report AI — " : "تطبيق تقرير الأشعة بالمساعد الذكي — ") + APP_BUILD + (LANG === "en" ? " — local viewer and reports; cloud AI/PACS require network access. Reports require physician review and sign-off." : " — العارض والتقارير محلية؛ AI السحابي وPACS يحتاجان اتصالًا. التقارير تتطلب مراجعة الطبيب وتوقيعه."), false); });
  const pu = $("pacs-url-s");
  if (pu) { pu.value = ($("pacs-url") && $("pacs-url").value) || ""; pu.addEventListener("change", () => { const m = $("pacs-url"); if (m) m.value = pu.value.trim(); }); }
  const pt = $("pacs-token");
  if(pt){
    const remember=$("pacs-token-remember");
    try{remember.checked=localStorage.getItem("rrai-pacs-token-remember")==="1";if(remember.checked)pt.value=localStorage.getItem("rrai-pacs-token")||"";else localStorage.removeItem("rrai-pacs-token");}catch(e){}
    const save=()=>{try{if(remember.checked){localStorage.setItem("rrai-pacs-token-remember","1");localStorage.setItem("rrai-pacs-token",pt.value.trim());}else{localStorage.removeItem("rrai-pacs-token");localStorage.removeItem("rrai-pacs-token-remember");}}catch(e){remember.checked=false;setStatus("تعذر حفظ الرمز / Token storage unavailable",true);}};
    pt.addEventListener("input",save);remember.addEventListener("change",save);
    $("credentials-clear").onclick=()=>{
      for(const id of ["ai-key","pacs-token","ai-service-token","pacs-relay-token"]){const e=$(id);if(e)e.value="";}
      $("ai-key-remember").checked=false;remember.checked=false;
      let failed=false;for(const key of ["rrai-ai-key","rrai-ai-key-remember","rrai-pacs-token","rrai-pacs-token-remember"]){try{localStorage.removeItem(key);}catch(e){failed=true;}}
      setStatus(failed?(LANG==="en"?"Session fields cleared, but saved credentials could not be removed: check browser storage permissions.":"مُسحت حقول الجلسة، لكن تعذر مسح المفاتيح المحفوظة؛ راجع صلاحيات تخزين المتصفح."):(LANG==="en"?"Connection credentials cleared; local studies unchanged.":"مُسحت مفاتيح الاتصال؛ الدراسات المحلية لم تتغير."),failed);
    };
  }
  bind("pacs-test", async () => {
    const base = (( $("pacs-url") && $("pacs-url").value) || "").trim();
    if (!base) { setStatus(LANG === "en" ? "Enter the PACS URL first." : "أدخل عنوان PACS أولًا.", true); return; }
    try {
      const r = await pacsFetch(relay(base + "/studies?limit=1"), { headers: Object.assign({ Accept: "application/dicom+json" }, pacsAuth()) });
      setStatus(r.ok ? (LANG === "en" ? "PACS connection OK." : "اتصال PACS ناجح.") : (LANG === "en" ? "PACS replied with status " + r.status : "ردّ PACS بالحالة " + r.status), !r.ok);
    } catch (e) { setStatus(LANG === "en" ? "PACS unreachable: " + (e && e.message ? e.message : e) : "تعذّر الوصول إلى PACS: " + (e && e.message ? e.message : e), true); }
  });
  const pa = $("pacs-auto");
  if (pa) { try { pa.value = localStorage.getItem("rrai-pacs-auto") || "0"; } catch (e) {} pa.addEventListener("change", () => { try { localStorage.setItem("rrai-pacs-auto", pa.value); } catch (e) {} pacsAutoLast = 0; setStatus(LANG === "en" ? "Auto-fetch setting saved." : "حُفظ إعداد السحب التلقائي.", false); }); }
  const ca = $("crit-alert");
  if (ca) { try { ca.checked = localStorage.getItem("rrai-crit-alert") === "1"; } catch (e) {} ca.addEventListener("change", () => { try { localStorage.setItem("rrai-crit-alert", ca.checked ? "1" : "0"); } catch (e) {} if (ca.checked) critBeep(); }); }
  const an = $("anon-exp");
  if (an) { try { an.checked = localStorage.getItem("rrai-anon") === "1"; } catch (e) {} an.addEventListener("change", () => { try { localStorage.setItem("rrai-anon", an.checked ? "1" : "0"); } catch (e) {} }); }
  const th = $("theme-sel");
  if (th) { try { th.value = localStorage.getItem("rrai-theme") || "dark"; } catch (e) {} th.addEventListener("change", () => applyTheme(th.value)); }
  bind("free-images", async () => {
    if (!confirm(LANG === "en" ? "Delete DICOM images of studies whose reports are already archived? Reports stay." : "حذف صور DICOM للدراسات المحفوظة تقاريرها في الأرشيف؟ تبقى التقارير.")) return;
    const a = archiveLoad();
    const keys = new Set(a.map((e) => String(e.patient || "").toUpperCase() + "|" + String(e.studyDate || "")));
    const all = await allStudies();
    let n = 0;
    for (const st of all) {
      const k = String(((st.meta && st.meta.patientName) || st.patient || "").toUpperCase()) + "|" + String((st.meta && st.meta.studyDate) || "");
      if (keys.has(k)) { await txDel(st.uid); if (current && current.uid === st.uid) current = null; n++; }
    }
    await refresh(); refreshStorage();
    setStatus((LANG === "en" ? "Freed images of " : "حُررت صور ") + n + (LANG === "en" ? " archived study(ies); reports kept." : " دراسة مؤرشفة؛ بقيت التقارير."), false);
  });
  const ls = $("lang-sel");
  if (ls) { ls.value = LANG; ls.addEventListener("change", () => applyLang(ls.value)); }
  const so = $("sort-sel");
  if (so) { try { so.value = localStorage.getItem("rrai-sort") || "urgent"; } catch (e) {} so.addEventListener("change", () => { worklistSessionSort=so.value;try { localStorage.setItem("rrai-sort", so.value); } catch (e) {} refresh(); }); }
  const dwi = $("default-win-sel");
  if (dwi) { try { dwi.value = localStorage.getItem("rrai-default-win") || "auto"; } catch (e) {} dwi.addEventListener("change", () => { try { localStorage.setItem("rrai-default-win", dwi.value); } catch (e) {} if ($("preset")) $("preset").value = dwi.value; if (current) show(sliceIdx()); }); }
  const ov1 = $("ov-name-chk");
  if (ov1) { ov1.checked = ovPref("rrai-ov-name"); ov1.addEventListener("change", () => { try { localStorage.setItem("rrai-ov-name", ov1.checked ? "1" : "0"); } catch (e) {} applyOverlayPrefs(); }); }
  const ov2 = $("ov-meta-chk");
  if (ov2) { ov2.checked = ovPref("rrai-ov-meta"); ov2.addEventListener("change", () => { try { localStorage.setItem("rrai-ov-meta", ov2.checked ? "1" : "0"); } catch (e) {} applyOverlayPrefs(); }); }
  for (const [cid, key, def] of [["ov-seq-chk", "rrai-ov-seq", true], ["ov-tech-chk", "rrai-ov-tech", true], ["ov-diag-chk", "rrai-ov-diag", false]]) {
    const el = $(cid);
    if (!el) continue;
    el.checked = ovPrefD(key, def);
    el.addEventListener("change", () => { try { localStorage.setItem(key, el.checked ? "1" : "0"); } catch (e) {} try { drawAnnot(); } catch (e2) {} });
  }
  try {
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { try { drawAnnot(); } catch (e) {} }, 180); });
  } catch (e) {}
  const mcol = $("measure-color");
  if (mcol) { try { mcol.value = localStorage.getItem("rrai-measure-color") || "#38bdf8"; } catch (e) {} mcol.addEventListener("change", () => { try { localStorage.setItem("rrai-measure-color", mcol.value); } catch (e) {} if (current) drawOverlay(); }); }
  const mun = $("measure-unit");
  if (mun) { try { mun.value = localStorage.getItem("rrai-measure-unit") || "mm"; } catch (e) {} mun.addEventListener("change", () => { try { localStorage.setItem("rrai-measure-unit", mun.value); } catch (e) {} if (current) drawOverlay(); }); }
  const ps2 = $("perf-smooth");
  if (ps2) { ps2.checked = perfSmooth(); ps2.addEventListener("change", () => { try { localStorage.setItem("rrai-perf-smooth", ps2.checked ? "1" : "0"); } catch (e) {} if (current) show(sliceIdx()); }); }
  const ao = $("auto-open-chk");
  if (ao) { try { ao.checked = localStorage.getItem("rrai-auto-open") === "1"; } catch (e) {} ao.addEventListener("change", () => { try { localStorage.setItem("rrai-auto-open", ao.checked ? "1" : "0"); } catch (e) {} }); }
  const gz = $("gzip-chk");
  if (gz) { try { gz.checked = localStorage.getItem("rrai-gzip") === "1"; } catch (e) {} gz.addEventListener("change", () => { try { localStorage.setItem("rrai-gzip", gz.checked ? "1" : "0"); } catch (e) {} }); }
  const de = $("default-export-sel");
  if (de) { try { de.value = "word";de.disabled=true; } catch (e) {} de.addEventListener("change", () => { try { localStorage.setItem("rrai-default-export", de.value); } catch (e) {} applyDefaultExport(); }); }
  const ae = $("pacs-ae");
  if (ae) { try { ae.value = localStorage.getItem("rrai-pacs-ae") || ""; } catch (e) {} ae.addEventListener("change", () => { try { localStorage.setItem("rrai-pacs-ae", ae.value.trim()); } catch (e) {} }); }
  const po = $("pacs-port");
  if (po) { try { po.value = localStorage.getItem("rrai-pacs-port") || ""; } catch (e) {} po.addEventListener("change", () => { try { localStorage.setItem("rrai-pacs-port", po.value.trim()); } catch (e) {} }); }
  const rd = $("set-retention-days");
  if (rd) { rd.value = String(retentionDays()); rd.addEventListener("change", () => { setRetentionDays(parseInt(rd.value, 10) || 0); const m = $("retention-days"); if (m) m.value = rd.value; setStatus(LANG === "en" ? "Retention updated." : "حُدّثت مدة الاحتفاظ.", false); }); }
  const rsd2 = $("set-retention-signed");
  if (rsd2) { rsd2.value = String(retentionSignedDays()); rsd2.addEventListener("change", () => { setRetentionSignedDays(parseInt(rsd2.value, 10) || 0); const m = $("retention-signed-days"); if (m) m.value = rsd2.value; setStatus(LANG === "en" ? "Signed retention updated." : "حُدّثت مدة احتفاظ الموقّع.", false); }); }
  bind("rebuild-cache", async () => {
    if (!navigator.onLine) { setStatus(LANG === "en" ? "Go online first to rebuild the offline cache." : "اتصل بالإنترنت أولًا لإعادة بناء المخبأ.", true); return; }
    if (!confirm(LANG === "en" ? "Rebuild offline cache now? The app will reload." : "إعادة بناء المخبأ الآن؟ سيُعاد تحميل التطبيق.")) return;
    try { const ks = await caches.keys(); for (const k of ks) await caches.delete(k); } catch (e) {}
    location.reload();
  });
  bind("clear-db", async () => {
    if (!confirm(LANG === "en" ? "Delete ALL studies from this device? Archived reports stay." : "حذف كل الدراسات من هذا الجهاز؟ تبقى التقارير المؤرشفة.")) return;
    const all = await allStudies();
    for (const st of all) await txDel(st.uid);
    current = null; await refresh(); refreshStorage();
    setStatus(LANG === "en" ? "Local study database emptied." : "أُفرغت قاعدة الدراسات المحلية.", false);
  });
  fillAbout();
}
function fillAbout() {
  const v = $("about-ver"); if (v) v.textContent = (LANG === "en" ? "Version: " : "الإصدار: ") + APP_BUILD;
  const c = $("about-conn"); if(c)c.textContent=(navigator.onLine?(LANG==="en"?"🟢 Browser reports online. ":"🟢 المتصفح يُبلغ عن اتصال. "):(LANG==="en"?"⚪ Browser reports offline. ":"⚪ المتصفح يُبلغ عن انقطاع الاتصال. "))+(LANG==="en"?"Local viewing/reporting can work after app assets and needed decoders are available. Cloud AI/PACS need a connection; content leaves the device when you use those services.":"العارض والتقارير يعملان محليًا بعد توفر ملفات التطبيق وفك الترميز اللازم. AI السحابي وPACS يحتاجان اتصالًا؛ استخدامهما قد ينقل محتوى خارج الجهاز.");
}
function setupFilePickers() {
  const fb = $("files-btn");
  if (fb) fb.addEventListener("click", () => { const f = $("files"); if (f) f.click(); });
  const ab = $("ai-extra-btn");
  if (ab) ab.addEventListener("click", () => { const f = $("ai-extra"); if (f) f.click(); });
  const f1 = $("files"); if (f1) f1.addEventListener("change", () => fileLbl("files", "files-lbl"));
  const f2 = $("ai-extra"); if (f2) f2.addEventListener("change", () => fileLbl("ai-extra", "ai-extra-lbl"));
  fileLbl("files", "files-lbl"); fileLbl("ai-extra", "ai-extra-lbl");
}
function setupExtras() {
  const micB = $("mic-imp");
  if (micB) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const lbl = () => { micB.textContent = LANG === "en" ? "🎤 Dictate" : "🎤 إملاء"; };
    if (!SR) { micB.disabled = true; micB.title = LANG === "en" ? "Dictation not supported in this browser" : "الإملاء غير مدعوم في هذا المتصفح"; }
    else {
      let rec = null;
      micB.addEventListener("click", () => {
        const ta = $("rep-impression"); if (!ta) return;
        if (rec) { try { rec.stop(); } catch (e) {} rec = null; lbl(); return; }
        rec = new SR(); rec.lang = LANG === "en" ? "en-US" : "ar-SA"; rec.interimResults = false; rec.continuous = true;
        rec.onresult = (ev) => { let add = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) add += ev.results[i][0].transcript + " "; if (add) ta.value = (ta.value ? ta.value.replace(/\s*$/, "") + "\n" : "") + add.trim(); };
        rec.onend = () => { rec = null; lbl(); };
        rec.onerror = () => { rec = null; lbl(); setStatus(LANG === "en" ? "Dictation stopped/error." : "توقف الإملاء أو حدث خطأ.", true); };
        micB.textContent = LANG === "en" ? "⏹ Stop" : "⏹ إيقاف";
        try { rec.start(); } catch (e) { rec = null; lbl(); }
      });
    }
  }
  const pv = $("preview-a4");
  if (pv) pv.addEventListener("click", () => { const box = $("a4-prev"); const set = $("a4-set"); if (box) box.innerHTML = a4Body(); if (set) set.open = true; setStatus(LANG === "en" ? "A4 preview ready in the composer." : "المعاينة A4 جاهزة داخل المحرر.", false); });
  const pr = $("print-a4");
  if (pr) pr.addEventListener("click", () => { const w = window.open("", "_blank"); if (!w) { setStatus(LANG === "en" ? "Popup blocked — use the in-app A4 preview." : "المتصفح منع النافذة — استخدم المعاينة الداخلية A4.", true); return; } w.document.write(a4Html()); w.document.close(); });
  const stSet = $("stats-set");
  if (stSet) stSet.addEventListener("toggle", () => { if (stSet.open) computeStats(); });
  const sr = $("stats-refresh"); if (sr) sr.addEventListener("click", () => computeStats());
  const scv = $("stats-csv");
  if (scv) scv.addEventListener("click", async () => {
    try {
      const all = await allStudies();
      const a = archiveLoad();
      const now = Date.now();
      const day = 86400000;
      const rows = [["Metric", "Value"]];
      rows.push(["Studies on device", all.length]);
      rows.push(["Urgent/consult", all.filter((s3) => (s3.triage && s3.triage.priority === "urgent") || s3.consult).length]);
      rows.push(["Saved reports", a.length]);
      rows.push(["Signed", a.filter((e) => e.status === "signed").length]);
      rows.push(["Drafts", a.filter((e) => e.status !== "signed").length]);
      for (let d7 = 6; d7 >= 0; d7--) {
        const d0 = new Date(now - d7 * day); d0.setHours(0, 0, 0, 0);
        const d1 = d0.getTime() + day;
        rows.push(["Reports " + d0.toISOString().slice(0, 10), a.filter((e) => { const t = Date.parse(e.ts || ""); return t >= d0.getTime() && t < d1; }).length]);
      }
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
      const el = document.createElement("a");
      el.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
      el.download = "stats-" + new Date().toISOString().slice(0, 10) + ".csv";
      el.click(); URL.revokeObjectURL(el.href);
      setStatus(LANG === "en" ? "Stats exported as CSV." : "صُدّرت الإحصاءات ملف CSV.", false);
    } catch (e) { setStatus(LANG === "en" ? "Stats export failed." : "فشل تصدير الإحصاءات.", true); }
  });
  const rsd = $("retention-signed-days");
  if (rsd) { rsd.value = String(retentionSignedDays()); rsd.addEventListener("change", () => { setRetentionSignedDays(parseInt(rsd.value, 10) || 0); setStatus(LANG === "en" ? "Signed-report retention set." : "ضُبطت مدة احتفاظ التقارير الموقّعة.", false); }); }
  const bk = $("archive-backup");
  if (bk) bk.addEventListener("click", () => {
    const payload = { app: "rrai-archive-backup", v: 1, at: new Date().toISOString(), retention: { days: retentionDays(), signedDays: retentionSignedDays() }, entries: archiveLoad() };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    a.download = "rrai-archive-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click(); URL.revokeObjectURL(a.href);
    setStatus(LANG === "en" ? "Archive backup file downloaded to this device." : "نُزّلت نسخة احتياطية من الأرشيف على جهازك.", false);
  });
  const rb = $("archive-restore"); const rf = $("archive-restore-file");
  if (rb && rf) {
    rb.addEventListener("click", () => rf.click());
    rf.addEventListener("change", async () => {
      const f = rf.files && rf.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const list = Array.isArray(j) ? j : (j.entries || []);
        const cur = archiveLoad(); const ids = new Set(cur.map((x) => x.id));
        let added = 0;
        for (const e of list) { if (e && e.id && !ids.has(e.id)) { cur.push(e); ids.add(e.id); added++; } }
        if (added) { archiveStore(cur); renderArchive(); }
        setStatus((LANG === "en" ? "Restored " : "استُعيد ") + added + (LANG === "en" ? " archived report(s)." : " تقرير مؤرشف."), false);
      } catch (e) { setStatus(LANG === "en" ? "Backup file unreadable." : "ملف النسخة الاحتياطية غير مقروء.", true); }
      rf.value = "";
    });
  }
}
async function updatePurgeWarn() {
  const el = $("purge-warn"); if (!el) return;
  try {
    const now = Date.now(); const W7 = 7 * 86400000;
    const days = retentionDays(); const sdays = retentionSignedDays();
    let arch = 0;
    for (const e of archiveLoad()) {
      const t = Date.parse(e.ts || ""); if (isNaN(t)) continue;
      const dd = e.status === "signed" ? sdays : days; if (!dd || dd <= 0) continue;
      const left = t + dd * 86400000 - now;
      if (left >= 0 && left <= W7) arch++;
    }
    let stN = 0;
    if (days > 0) {
      const all = await allStudies();
      for (const s2 of all) { const c = s2.createdAt || 0; if (!c) continue; const left = c + days * 86400000 - now; if (left >= 0 && left <= W7) stN++; }
    }
    if (!arch && !stN) { el.style.display = "none"; el.textContent = ""; return; }
    el.style.display = "block"; el.style.cursor = "pointer";
    el.textContent = (LANG === "en" ? "⚠ Within 7 days auto-retention will remove: " : "⚠ خلال ٧ أيام سيحذف الاحتفاظ التلقائي: ") + arch + (LANG === "en" ? " report(s) and " : " تقريرًا و") + stN + (LANG === "en" ? " study(ies). Tap to take a backup now, or adjust retention." : " دراسة. اضغط لأخذ نسخة احتياطية الآن، أو عدّل المدة.");
    el.onclick = () => { const b = $("archive-backup"); if (b) b.click(); };
  } catch (e) {}
}
let purgedOnce = false;
function purgeOnceSoon() {
  if (purgedOnce) return;
  purgedOnce = true;
  setTimeout(() => { purgeOld().then((r) => { if (r.arch || r.studies) { setStatus((LANG === "en" ? "Auto-retention: removed " : "الحذف التلقائي: حُذف ") + r.arch + (LANG === "en" ? " archived report(s), " : " تقرير مؤرشف و") + r.studies + (LANG === "en" ? " study(ies) older than the retention period." : " دراسة أقدم من مدة الاحتفاظ."), false); } renderArchive(); }); }, 1200);
}
function setupArchive() {
  const setEl = $("archive-set");
  if (!setEl) return;
  setEl.addEventListener("toggle", () => { if (setEl.open) renderArchive(); });
  const q = $("archive-q");
  if (q) q.addEventListener("input", () => renderArchive());
  const rd = $("retention-days");
  if (rd) {
    rd.value = String(retentionDays());
    rd.addEventListener("change", () => {
      setRetentionDays(parseInt(rd.value, 10) || 0);
      purgeOld().then((r) => { renderArchive(); setStatus(LANG === "en" ? "Retention set — removed " + r.arch + " report(s), " + r.studies + " study(ies)." : "ضُبطت مدة الاحتفاظ — حُذف " + r.arch + " تقرير و" + r.studies + " دراسة.", false); });
    });
  }
  const pn = $("purge-now");
  if (pn) pn.addEventListener("click", () => {
    purgeOld().then((r) => { renderArchive(); setStatus(LANG === "en" ? "Purge done — removed " + r.arch + " report(s), " + r.studies + " study(ies)." : "تم التنظيف — حُذف " + r.arch + " تقرير و" + r.studies + " دراسة.", false); });
  });
  const sv = $("archive-save");
  if (sv) sv.addEventListener("click", () => {
    if (!current) { setStatus(LANG === "en" ? "Open a study first." : "افتح دراسة أولًا.", true); return; }
    const comp = readComposer() || {};
    archiveSave(current, Object.assign({}, comp, { technique: comp.technique || (current.report && current.report.technique) || "" }),
      { signer: $("signer")?.value.trim()||"", license: $("signer-license")?.value.trim()||"", hash: "", status: "draft", at: new Date().toISOString() });
    renderArchive();
    setStatus(LANG === "en" ? "Report saved to the archive." : "حُفظ التقرير في الأرشيف.", false);
  });
  renderArchive();
}
function setupTemplates() {
  const openBtn = $("tpl-open");
  const setEl = $("tpl-set");
  if (openBtn && setEl) openBtn.addEventListener("click", () => { setEl.open = !setEl.open; renderTplList(); });
  const list = $("tpl-list");
  if (!list) return;
  const saveCustom = (arr) => { try { localStorage.setItem("rrai-tpl-custom", JSON.stringify(arr)); } catch (e) {} };
  list.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
    if (!b) return;
    const id = b.getAttribute("data-tpl");
    const t = tplAll().find((x) => x.id === id);
    if (!t) return;
    if (b.hasAttribute("data-tpl-ins")) {
      reportExportEdited();
      const f = $("rep-findings"), im = $("rep-impression");
      if (f) f.value = (f.value.trim() ? f.value.trim() + "\n" : "") + (t.f || []).join("\n");
      if (im) im.value = (im.value.trim() ? im.value.trim() + "\n" : "") + (t.i || []).join("\n");
      for (const el of [f, im]) if (el) el.dispatchEvent(new Event("input"));
      setStatus(LANG === "en" ? "Template inserted into the composer — review and adapt." : "أُدرج القالب في لوحة التأليف — راجع وعدّل.", false);
    } else if (b.hasAttribute("data-tpl-edit")) {
      $("tpl-name").value = t.name || "";
      $("tpl-region").value = t.region || "generic";
      $("tpl-findings").value = (t.f || []).join("\n");
      $("tpl-impression").value = (t.i || []).join("\n");
      $("tpl-edit-set").open = true;
      $("tpl-save").setAttribute("data-edit-id", t.id.startsWith("c") ? t.id : "");
      if (!t.id.startsWith("c")) $("tpl-save").setAttribute("data-copy-from", t.id);
    } else if (b.hasAttribute("data-tpl-del")) {
      if (!id.startsWith("c")) return;
      saveCustom(JSON.parse(localStorage.getItem("rrai-tpl-custom") || "[]").filter((x) => x.id !== id));
      renderTplList();
    }
  });
  const sv = $("tpl-save");
  if (sv) sv.addEventListener("click", () => {
    const name = ($("tpl-name").value || "").trim() || (LANG === "en" ? "Custom template" : "قالب مخصص");
    const obj = { id: sv.getAttribute("data-edit-id") || ("c" + Date.now()), region: $("tpl-region").value || "generic", name: name, nameAr: name,
      f: $("tpl-findings").value.split("\n").map((x) => x.trim()).filter(Boolean), i: $("tpl-impression").value.split("\n").map((x) => x.trim()).filter(Boolean) };
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem("rrai-tpl-custom") || "[]"); } catch (e) {}
    const ix = custom.findIndex((x) => x.id === obj.id);
    if (ix >= 0) custom[ix] = obj; else custom.push(obj);
    saveCustom(custom);
    sv.removeAttribute("data-edit-id");
    $("tpl-edit-set").open = false;
    renderTplList();
  });
  renderTplList();
}
function renderTplList() {
  const list = $("tpl-list");
  if (!list) return;
  list.textContent = "";
  for (const t of tplAll()) {
    const row = document.createElement("p");
    row.style.cssText = "margin:0 0 .35rem;display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;";
    const lbl = document.createElement("span");
    lbl.style.cssText = "flex:1;min-width:9rem;opacity:.9;";
    lbl.textContent = (LANG === "ar" && t.nameAr ? t.nameAr : t.name) + " [" + t.region + "]";
    row.appendChild(lbl);
    const mk = (attr, txt) => { const b = document.createElement("button"); b.className = "ghost"; b.style.cssText = "padding:.2rem .6rem;font-size:.75rem;"; b.setAttribute("data-tpl", t.id); b.setAttribute(attr, "1"); b.textContent = txt; return b; };
    row.appendChild(mk("data-tpl-ins", LANG === "en" ? "Insert" : "إدراج"));
    row.appendChild(mk("data-tpl-edit", LANG === "en" ? "Edit/copy" : "تعديل/نسخ"));
    if (t.id.startsWith("c")) row.appendChild(mk("data-tpl-del", LANG === "en" ? "Delete" : "حذف"));
    list.appendChild(row);
  }
}
function normalizeDownloadUrl(raw) {
  let s = String(raw || "").replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  if (!s) return "";
  const m = s.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (m) return m[0];
  const b = s.match(/(?:^|\s)([\w.-]+\.[a-z]{2,}\/\S*)/i);
  if (b) return "https://" + b[1];
  return "";
}
function setupPacs() {
  const btn = $("pacs-pull");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const base = String($("pacs-url").value || "").trim().replace(/\/+$/, "");
    const q = String($("pacs-q").value || "").trim();
    const st = $("pacs-status");
    const say = (t, bad) => { if (st) { st.textContent = t; st.dataset.status=bad?"warning":"info"; st.style.color = bad ? "#fca5a5" : "#86efac"; } setStatus(t, !!bad); };
    if (!base) { say("أدخل عنوان DICOMweb الأساسي أولًا (مثل https://pacs.example/dicom-web).", true); return; }
    const isPrivate = /^http:\/\/(127\.|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base);
    const relay = (t) => (isPrivate ? t : location.origin + "/api/dicomweb?url=" + encodeURIComponent(t));
    try {
      say("استعلام QIDO-RS…");
      const qr = await pacsFetch(relay(base + "/studies?limit=10" + (q ? "&PatientID=" + encodeURIComponent(q) : "")), { headers: Object.assign({ Accept: "application/dicom+json" }, pacsAuth()) });
      if (!qr.ok) throw new Error("QIDO http " + qr.status);
      const list = await qr.json();
      if (!Array.isArray(list) || !list.length) { say("لا دراسات مطابقة في الأرشيف.", true); return; }
      const uid = (list[0]["0020,000D"] || {}).Value?.[0];
      if (!uid) throw new Error("StudyInstanceUID مفقود في رد QIDO");
      say("سحب WADO-RS للدراسة " + uid.slice(-12) + "…");
      const wr = await pacsFetch(relay(base + "/studies/" + uid), { headers: Object.assign({ Accept: "multipart/related; type=application/dicom" }, pacsAuth()) });
      if (!wr.ok) throw new Error("WADO http " + wr.status);
      const buf = await wr.arrayBuffer();
      const parts = parseMultipartRelated(buf, wr.headers.get("content-type") || "");
      if (!parts.length) throw new Error("استجابة WADO بلا أجزاء DICOM");
      const files = parts.map((b, i) => new File([b], "pacs-" + (i + 1) + ".dcm", { type: "application/dicom" }));
      await ingestFiles(files);
      say("سُحبت " + files.length + " شريحة من PACS ودخلت قائمة العمل.");
    } catch (e) {
      say("فشل السحب من PACS: " + (e && e.message ? e.message : e), true);
    }
  });
  const dl = $("pacs-dl");
  if (dl) dl.addEventListener("click", async () => {
    const st = $("pacs-status");
    const say = (t, bad) => { if (st) { st.textContent = t; st.dataset.status=bad?"warning":"info"; st.style.color = bad ? "#fca5a5" : "#86efac"; } setStatus(t, !!bad); };
    let url = normalizeDownloadUrl(($("pacs-dl-url") || {}).value);
    if (!url) url = normalizeDownloadUrl(($("pacs-url") || {}).value);
    if (!url) {
      const asked = window.prompt(LANG === "en" ? "Paste the download link (WeTransfer / ZIP / DICOM):" : "الصق رابط التنزيل هنا (WeTransfer أو ZIP أو DICOM):");
      const p = normalizeDownloadUrl(asked || "");
      if (p) { url = p; const ff = $("pacs-dl-url"); if (ff) ff.value = p; }
    }
    if (!url) { say(LANG === "en" ? "No link added: paste it into the \"Download link\" field, or into the paste window that opens automatically." : "لم يُضَف أي رابط: الصقه في حقل «رابط التنزيل» أو في نافذة اللصق التي تفتح تلقائيًا.", true); return; }
    { const ff2 = $("pacs-dl-url"); if (ff2 && !ff2.value) ff2.value = url; }
    const isPriv = /^http:\/\/(127\.|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url);
    const via = (t, opts) => isPriv && t === url ? fetch(t, { ...opts, headers:{...pacsAuth(),...opts?.headers} }) : pacsFetch(location.origin + "/api/dicomweb?url=" + encodeURIComponent(t), opts);
    try {
      let direct = url;
      if (/we\.tl\//i.test(url) || /wetransfer\.com\//i.test(url))throw new Error(LANG==="en"?"Sharing-site resolution is disabled: download locally, then Choose files.":"فض روابط المشاركة عبر الخادم معطل: نزّل الملف محليًا ثم اختر الملفات.");
      say("تنزيل الحزمة…");
      const r = await via(direct);
      if (!r.ok) throw new Error("http " + r.status);
      const buf = await r.arrayBuffer();
      let files;
      const magic = new Uint8Array(buf.slice(0, 2));
      if (magic[0] === 0x50 && magic[1] === 0x4b) {
        const parts = await unzipDicom(buf);
        files = parts.map((b2, i) => new File([b2], "dl-" + (i + 1) + ".dcm", { type: "application/dicom" }));
      } else {
        files = [new File([buf], "dl-1.dcm", { type: "application/dicom" })];
      }
      if (!files.length) throw new Error("لا ملفات DICOM داخل الحزمة");
      await ingestFiles(files);
      say("سُحبت " + files.length + " شريحة من الرابط ودخلت قائمة العمل.");
    } catch (e) {
      say("فشل السحب من الرابط: " + (e && e.message ? e.message : e) + " — البديل المضمون: نزّل الحزمة وافتحها عبر «اختيار الملفات».", true);
    }
  });
}
let LANG = "ar";
const PRI = { urgent: ["حرج", "URGENT"], consult: ["استشارة", "CONSULT"], routine: ["روتيني", "ROUTINE"] };
const priLabel = (k) => (PRI[k] || PRI.routine)[LANG === "en" ? 1 : 0];
const I18N = {
  "report-approval-text":["راجعت الصور ونص التقرير وأعتمد هذه النسخة","I reviewed the images and report text and approve this version"],
  "report-export-title": ["تنزيل التقرير — Word إنجليزي", "Download report — English Word"],
  "report-export-note": ["يراجع الطبيب نص المحرر ويعتمده، ثم يُنزَّل ملف .docx واحد. لا تنزيل تلقائي عند التوليد أو فتح الأرشيف.", "Review and approve the composer text, then download one .docx file. Generating or opening a report never downloads it automatically."],
  "report-signer-label": ["اسم الطبيب", "Physician name"],
  "report-license-label": ["رقم الترخيص / النقابة (اختياري)", "License / registration (optional)"],
  "report-download-again": ["تنزيل نفس الملف مجددًا", "Download the same file again"],
  "report-download-help": ["ستجده عادةً في «ملفاتي ← التنزيلات». إشعار النظام يعتمد على المتصفح؛ هذه الرسالة لا تؤكد حفظ الملف على الجهاز.", "Usually found in Files → Downloads. System notifications depend on your browser; this message does not confirm that the device saved the file."],

  "geometry-diagnostic-summary": ["تشخيص خطوط المستوى", "Geometry diagnostics"],
  "geometry-diagnostic-note": ["يُصدّر الموضع والاتجاه والتباعد فقط؛ بلا صور أو أسماء أو معرّفات DICOM. تبقى هندسة الدراسة بيانات ينبغي مشاركتها مع جهة موثوقة فقط.", "Exports position, orientation and spacing only; no images, names or DICOM identifiers. Study geometry is still data to share only with a trusted recipient."],
  "geometry-export": ["تصدير تقرير هندسي", "Export geometry diagnostic"],
  "spatial-sync-summary": ["المزامنة المكانية (اختيارية)", "Spatial sync (optional)"],
  "spatial-sync-label": ["تفعيل المزامنة المكانية للسلاسل المتوافقة فقط", "Enable spatial sync for compatible series only"],
  "export-png": ["PNG — الصورة الأصلية / المستويات", "PNG — source image / planes"],
  "all-toggle": ["عرض شامل: كل السلاسل × ٣ مستويات", "All series × 3 planes"],
  "session-slice-label": ["شرائح الدراسة", "Study slices"],
  "series-preview-summary": ["السلاسل — إظهار المصغّرات", "Series thumbnails"],
  "scan-btn": ["فحص السلسلة", "Scan series"],
  "mpr-lab-axial": ["محوري", "Axial"],
  "mpr-lab-coronal": ["إكليلي", "Coronal"],
  "mpr-lab-sagittal": ["سهمي", "Sagittal"],
  "lbl-rep-technique": ["التقنية — راجع الصبغة", "Technique — verify contrast"],
  "report-review": ["تدقيق اتساق التقرير", "Review report consistency"],
  "lbl-signoff": ["راجعت الصور ونص التقرير وأعتمد هذه النسخة", "I reviewed the images and report text and approve this version"],
  "cmp-side-btn": ["جنبًا إلى جنب", "Side by side"],
  "compare-heading": ["مقارنة مع دراسة سابقة", "Compare with a previous study"],
  "compare-current-caption": ["الحالية", "Current"],
  "compare-prior-caption": ["السابقة/الأخرى", "Previous / other"],
  "compare-difference-caption": ["خريطة الفرق (أحمر = ساخن)", "Difference map (red = hot)"],
  "import-report-btn": ["نسخ تقرير آخر استيراد", "Copy last import report"],

  "text-pacs-remember": ["حفظ رمز PACS المباشر على هذا الجهاز", "Remember direct PACS token on this device"],
  "lbl-pacs-relay-token": ["رمز وسيط المؤسسة — للجلسة فقط", "Institution relay access token — session only"],
  "credentials-clear": ["مسح مفاتيح الاتصال دون الدراسات", "Clear credentials, keep studies"],
  "text-ai-remember": ["حفظ مفتاح AI على هذا الجهاز", "Remember AI key on this device"],
  "ai-key-clear": ["مسح المفتاح", "Clear key"],
  "credential-storage-note": ["الحفظ اختياري وغير مشفّر؛ تجنّبه على جهاز مشترك.", "Optional, unencrypted local storage; avoid on shared devices."],
  "lbl-ai-service-token": ["رمز وصول ذكاء المؤسسة — للجلسة فقط", "Institution AI access token — session only"],
  "relay-security-note": ["الوسيط السحابي للقراءة فقط؛ يتطلب رمزًا ووجهات HTTPS مصرحًا بها، ولا يصل للشبكات الخاصة. روابط المشاركة: نزّل ثم افتح محليًا.", "Relay is read-only and requires an access token and approved HTTPS destinations; private networks are blocked. Download sharing links locally."],
  "about-standalone-link": ["فتح نسخة الملف الواحد", "Open single-file edition"],
  "about-diagnostics-link": ["تشخيص", "Diagnostics"],
  "wl-options-title": ["البحث والتصفية والفرز", "Search, filter and sort"],
  "lbl-wl-query": ["بحث في الدراسات", "Search studies"],
  "lbl-wl-modality": ["نوع الفحص", "Modality"],
  "lbl-wl-priority": ["الأولوية", "Priority"],
  "lbl-wl-state": ["التوقيع", "Sign-off"],
  "lbl-wl-sort": ["ترتيب القائمة", "Sort studies"],
  "wl-clear": ["مسح البحث والتصفية", "Clear search and filters"],
  "wl-help": ["البحث محلي بالاسم أو المعرّف أو وصف الفحص أو السلسلة أو تاريخ الدراسة. لا يُحفظ نص البحث ولا تُحذف دراسات بالتصفية.", "Search locally by name, ID, exam/series description or study date. Search text is not saved; filtering never deletes studies."],
  subtitle: ["نسخة المتصفح — عارض وتقارير محلية؛ الخدمات السحابية اختيارية", "Browser edition — local viewer and reports; optional cloud services"],
  "h-upload": ["رفع دراسات DICOM", "Upload DICOM studies"],
  "h-worklist": ["قائمة الدراسات", "Study worklist"],
  "h-viewer": ["العارض", "Viewer"],
  "vr-open": ["عرض حجمي 3D — CT", "3D volume rendering — CT"],
  "vr-title": ["عرض حجمي محلي — CT فقط", "Local volume rendering — CT only"],
  "vr-close": ["إغلاق", "Close"],
  "vr-reset": ["إعادة ضبط المجسم", "Reset 3D view"],
  "vr-threshold-label": ["حد الإظهار التقريبي (HU)", "Approximate threshold (HU)"],
  "vr-opacity-label": ["الكثافة البصرية", "Opacity"],
  "vr-cut-label": ["قص عبر محور شرائح السلسلة", "Clip along series slice axis"],
  "vr-preset-label": ["إعداد الإظهار", "Display preset"],
  "vr-bone": ["عظام — كثافة عالية", "Bone — high density"],
  "vr-soft": ["كثافات أقل", "Lower densities"],
  "vr-custom": ["مخصص", "Custom"],
  "mpr-toggle": ["MPR: محوري / إكليلي / سهمي", "MPR: axial / coronal / sagittal"],
  "cine-toggle": ["عرض متحرك", "Cine"],
  "series-open": ["السلاسل ▾", "Series ▾"],
  "series-sheet-title": ["سلاسل الدراسة", "Study series"],
  "id-toggle": ["إخفاء الهوية", "Hide identity"],
  "redraw-btn": ["إعادة الرسم", "Redraw"],
  "th-patient": ["المريض", "Patient"], "th-mod": ["النوع", "Modality"], "th-date": ["التاريخ", "Study date"], "th-pri": ["الأولوية", "Priority"], "th-slices": ["الشرائح", "Slices"],
  "opt-study": ["تاريخ الدراسة", "Study date"],
  upload: ["رفع وتحليل", "Upload & analyze"], demo: ["توليد ديمو", "Generate demo"],
  "clear-all": ["حذف جميع الدراسات من الجهاز", "Delete all studies from device"],
  measure: ["قياس", "Measure"], "gen-report": ["توليد مسودة التقرير (ع/EN)", "Draft report (AR/EN)"],
  "copy-report": ["نسخ المسودة", "Copy draft"], "sign-export": ["توقيع وتصدير PDF", "Sign & export PDF"],
  "sign-export-word": ["توقيع وتصدير Word", "Sign & export Word"], "sign-export-word-en": ["تنزيل التقرير Word — EN", "Download report Word — EN"],
  "org-sum": ["إعدادات ترويسة المؤسسة", "Organization letterhead"], "org-save": ["حفظ الترويسة", "Save letterhead"],
  "lbl-slice": ["الشريحة", "Slice"],
  "pacs-sum": ["سحب من PACS (DICOMweb)", "Pull from PACS (DICOMweb)"],
  "pacs-pull": ["سحب أول دراسة مطابقة", "Pull first matching study"],
  "pacs-dl": ["سحب من رابط تنزيل (WeTransfer/ZIP/DICOM)", "Pull from download link (WeTransfer/ZIP/DICOM)"],
  "pick-dir": ["اختيار مجلد DICOM كامل بدل اختيار الملفات واحدًا واحدًا", "Pick a whole DICOM folder instead of file-by-file"],
  "lbl-ai-provider": ["المزوّد (كلها بلا بطاقة ائتمان)", "Provider (all card-free)"],
  "lbl-ai-key": ["مفتاح API (للجلسة افتراضيًا)", "API key (session only by default)"],
  "ai-test": ["اختبار اتصال AI — بدون بيانات المريض", "Test AI connection — no patient data"],
  "ai-diagnostics-title": ["تشخيص الاتصال التقني (بلا بيانات المريض أو المفتاح)", "Technical diagnostics (no patient data or key)"],
  "ai-cancel": ["إلغاء طلب AI", "Cancel AI request"],
  "ai-gen": ["توليد بمساعدة AI (مسودة للمراجعة)", "AI-assisted draft (for review)"],
  "lbl-ai-extra": ["لقطات شاشة إضافية للفحص (اختياري — حتى 2، تُرسل مع نفس الموافقة)", "Extra screenshots of the study (optional — up to 2, sent under the same consent)"],
  "ai-hint": ["اختياري وبإذنك لكل طلب: تُرسل حتى 6 لقطات مصغّرة + إحصاءات رقمية فقط (لا DICOM خام) إلى المزوّد المختار؛ المسودة تدخل لوحة التأليف لتحررها وتوقّعها. أسهل مفتاح بلا بطاقة: console.groq.com ← API Keys ← Create (أو openrouter.ai/keys لنماذج :free).", "Optional, per-request consent: up to 6 downscaled renders + numeric stats (never raw DICOM) go to the chosen provider; the draft lands in the composer for you to edit and sign. Easiest card-free key: console.groq.com → API Keys → Create (or openrouter.ai/keys for :free models)."],
  "lbl-retention": ["الحذف التلقائي بعد:", "Auto-delete after:"],
  "purge-now": ["تنظيف الآن", "Purge now"],
  "archive-sum": ["أرشيف التقارير المحفوظة (0)", "Saved reports archive (0)"],
  "archive-save": ["💾 حفظ التقرير الحالي في الأرشيف", "💾 Save current report to archive"],
  "lbl-archive-q": ["بحث في الأرشيف (مريض/فحص/بصمة)", "Search archive (patient/exam/hash)"],
  "tpl-open": ["⚙ قوالب الطبيعي والمرضيات (إعدادات)", "⚙ Normal & pathology templates (settings)"],
  "tpl-sum": ["قوالب جاهزة حسب المنطقة — إدراج/تعديل/حذف", "Ready templates per region — insert/edit/delete"],
  "tpl-edit-sum": ["إضافة/تعديل قالب مخصص (يُحفظ على جهازك)", "Add/edit custom template (stored on your device)"],
  "tpl-save": ["حفظ القالب", "Save template"],
  "composer-sum": ["تأليف التقرير التشخيصي (نمط تقرير المستشفى)", "Compose the diagnostic report (hospital-report style)"],
  "lbl-rep-exam": ["اسم الفحص (Exam)", "Exam name"],
  "lbl-rep-indication": ["الدلالة السريرية (Clinical Indication)", "Clinical Indication"],
  "lbl-rep-findings": ["الوصف (FINDINGS) — سطر لكل جملة، و**بين نجمتين** للغامق", "FINDINGS — one sentence per line, **double stars** for bold"],
  "lbl-rep-notes": ["ملاحظات خام / إملاء (مصدر أولي للتحويل إلى تقرير)", "Raw notes / dictation (primary source for report conversion)"],
  "lbl-rep-impression": ["الانطباع (IMPRESSION) — سطر لكل نقطة", "IMPRESSION — one bullet per line"],
  "bank-sum": ["بنك الصياغات المهنية — اضغط الجملة لإدراجها", "Professional phrase bank — tap a sentence to insert it"],
  "composer-hint": ["النص الذي تؤلفه هنا هو ما يدخل تقرير Word الموقع بصيغة المستشفى؛ تبقى بصمة SHA-256 وإخلاء المسؤولية مرفقين دائمًا.", "The text you compose here is what enters the signed Word report in the hospital format; the SHA-256 stamp and the disclaimer always stay attached."],
  "pick-hint": ["يدعم أيضًا: تحديد عدة ملفات دفعة واحدة من «اختيار الملفات»، أو ضغط المجلد إلى ZIP واختياره وحده.", "Also supported: multi-select many files at once, or zip the folder and pick the ZIP alone."],
  "lbl-dl-url": ["رابط التنزيل (WeTransfer / ZIP / DICOM)", "Download link (WeTransfer / ZIP / DICOM)"],
  "pacs-dl-hint": ["الصق الرابط في الحقل أعلاه ثم اضغط الزر؛ وإن تركته فارغًا ستفتح نافذة لصق تلقائية.", "Paste the link in the field above then press the button; left empty, a native paste window opens."],
  "empty": ["لا توجد دراسات — ارفع DICOM أو اضغط \"توليد ديمو\".", "No studies — upload DICOM or press \"Generate demo\"."],
  "files-btn": ["اختيار الملفات", "Choose files"], "ai-extra-btn": ["اختيار الملفات", "Choose files"],
  "export-csv": ["تصدير جميع الدراسات CSV", "Export all studies CSV"],
  "zoom-reset": ["ملاءمة", "Fit"], "fs-toggle": ["ملء الشاشة", "Fullscreen"],
  "vs-fold": ["\u2699 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0639\u0627\u0631\u0636", "\u2699 Viewer settings"],
  "vs-hint": ["\u0643\u0644 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0639\u0627\u0631\u0636 \u0641\u064a \u0645\u0643\u0627\u0646 \u0648\u0627\u062d\u062f \u2014 \u062a\u064f\u0637\u0648\u0649 \u0644\u064a\u0623\u062e\u0630 \u0627\u0644\u062a\u0634\u0631\u064a\u062d \u0627\u0644\u0634\u0627\u0634\u0629.",
               "Every viewer setting in one place - folded away so the anatomy keeps the screen."],
  "orient-invert": ["قلب اللون", "Invert"],
  "orient-fliph": ["قلب أفقي", "Flip H"],
  "orient-flipv": ["قلب رأسي", "Flip V"],
  "orient-reset": ["الوضع الأصلي", "Reset view"],
  "mic-imp": ["🎤 إملاء", "🎤 Dictate"],
  "lbl-fu": ["خطة متابعة:", "Follow-up plan:"],
  "preview-a4": ["معاينة A4", "A4 preview"], "print-a4": ["🖨 طباعة A4", "🖨 Print A4"],
  "a4-sum": ["المعاينة الداخلية A4", "In-app A4 preview"],
  "lbl-retention-signed": ["الموقّع يُحذف بعد:", "Signed reports deleted after:"],
  "archive-backup": ["⬇ نسخة احتياطية (ملف)", "⬇ Backup (file)"], "archive-restore": ["⬆ استيراد نسخة", "⬆ Restore backup"],
  "stats-sum": ["📊 إحصاءات الجهاز", "📊 Device statistics"],
  "stats-refresh": ["تحديث الإحصاءات", "Refresh stats"], "stats-csv": ["تصدير الإحصاءات CSV", "Export stats CSV"],
  "export-consult": ["تصدير حزمة استشارة", "Export consult package"],
  "import-consult": ["استيراد حزمة استشارة", "Import consult package"],
  "import-consult-clip": ["استيراد من الحافظة", "Import from clipboard"],
  "import-consult-last": ["استيراد آخر حزمة مصدّرة", "Import last exported package"],
  "compare-btn": ["مقارنة", "Compare"], "measure-clear": ["مسح القياسات", "Clear measurements"],
  "lbl-win": ["النافذة:", "Window:"],
  "drawer-title": ["القائمة", "Menu"], "drawer-worklist": ["📋 قائمة العمل الرئيسية", "📋 Main worklist"],
  "drawer-archive": ["📑 الأرشيف وسجل التقارير", "📑 Reports archive"], "drawer-data": ["📥 إدارة البيانات (استيراد/تصدير)", "📥 Data management (import/export)"],
  "drawer-ai": ["🤖 إعدادات الذكاء الاصطناعي والقوالب", "🤖 AI & template settings"], "drawer-settings": ["⚙ الإعدادات العامة", "⚙ General settings"],
  "drawer-install": ["📱 تثبيت التطبيق (PWA)", "📱 Install app (PWA)"], "drawer-help": ["❓ حول والمساعدة", "❓ About & help"],
  "data-mgmt-sum": ["إدارة البيانات ▾", "Data management ▾"],
  "settings-title": ["⚙ الإعدادات", "⚙ Settings"],
  "set-pacs-sum": ["خادم الأشعة (PACS / DICOMweb)", "PACS / DICOMweb server"],
  "set-ai-sum": ["🤖 الذكاء الاصطناعي والتنبيهات", "🤖 AI & alerts"],
  "set-store-sum": ["🗄 التخزين والخصوصية", "🗄 Storage & privacy"],
  "set-ui-sum": ["🎨 العرض واللغة", "🎨 Display & language"],
  "lbl-pacs-url-s": ["عنوان الخادم (URL):", "Server URL:"],
  "lbl-pacs-token": ["رمز PACS المباشر (للجلسة افتراضيًا):", "Direct PACS token (session only by default):"],
  "lbl-pacs-auto": ["السحب التلقائي:", "Auto-fetch:"], "pacs-test": ["اختبار الاتصال", "Test connection"],
  "lbl-crit-alert": ["تنبيه صوتي واهتزاز عند اكتشاف حالة حرجة جديدة", "Sound + vibration alert on new critical case"],
  "set-ai-note": ["المعالجة الأساسية محلية دائمًا؛ الذكاء السحابي اختياري بموافقتك لكل طلب.", "Core processing is always on-device; cloud AI is optional with per-request consent."],
  "free-images": ["تفريغ صور الدراسات المؤرشفة تقاريرها", "Free images of archived-report studies"],
  "lbl-anon": ["إخفاء هوية المريض في حزم الاستشارة المصدّرة", "Anonymize patient in exported consult packages"],
  "lbl-theme": ["المظهر:", "Theme:"],
  "lbl-lang": ["لغة الواجهة:", "Interface language:"],
  "set-view-sum": ["🖥 تفضيلات العارض", "🖥 Viewer preferences"],
  "set-work-sum": ["📋 إعدادات قائمة العمل", "📋 Worklist settings"],
  "set-keys-sum": ["⌨ اختصارات لوحة المفاتيح", "⌨ Keyboard shortcuts"],
  "set-io-sum": ["📤 الاستيراد والتصدير", "📤 Import & export"],
  "set-priv-sum": ["🔒 الخصوصية والأمان", "🔒 Privacy & security"],
  "set-about-sum": ["ℹ حول التطبيق", "ℹ About the app"],
  "lbl-default-win": ["النافذة الافتراضية:", "Default window:"],
  "lbl-ov-name": ["إظهار اسم المريض وبياناته فوق الصورة", "Show patient name & details over the image"],
  "lbl-ov-meta": ["إظهار سطر معلومات الشريحة أسفل العارض", "Show slice info line under the viewer"],
  "lbl-ov-seq": ["طبقة معلومات على الصورة: نوع الفحص والتسلسل (T1/T2/FLAIR…)", "On-image info layer: exam type and sequence (T1/T2/FLAIR…)"],
  "lbl-ov-tech": ["إظهار TE/TR داخل طبقة المعلومات (علامة ~ تعني مشتقًا من القياسات لا من الوسم)", "Show TE/TR in the info layer (a ~ mark means inferred from timings, not from the tag)"],
  "lbl-ov-diag": ["طبقة تشخيص على الصورة (الإصدار، السلسلة، الأبعاد، النافذة، المدى، التباين) — مفيدة عند طلب الدعم", "On-image diagnostics (build, series, size, window, range, contrast) — useful when asking for support"],
  "dx-foot-text": ["هذا العارض أداة عرض ومسودة تقرير؛ غير معتمد للتشخيص النهائي. القرار السريري يبقى للطبيب المختص.", "This viewer is a display and drafting tool; it is not certified for final diagnosis. Clinical judgement stays with the physician."],
  "dx-foot-ok": ["إخفاء", "Confirm and hide"],
  "seq-unknown": ["التسلسل غير مذكور في الملف", "Sequence not stated in the file"],
  "lbl-measure-color": ["لون أدوات القياس:", "Measurement tools color:"],
  "lbl-measure-unit": ["الوحدة:", "Unit:"],
  "lbl-perf-smooth": ["تنعيم الصور (تعطيله يسرّع الشرائح الكثيفة)", "Image smoothing (disable for speed on heavy studies)"],
  "lbl-sort": ["الفرز الافتراضي:", "Default sorting:"],
  "lbl-auto-open": ["فتح أول دراسة تلقائيًا بعد الرفع", "Auto-open first study after upload"],
  "keys-hint": ["اضغط داخل الحقل ثم اضغط المفتاح المطلوب لتعيينه.", "Click a field then press the desired key to assign it."],
  "ks-next-lbl": ["شريحة تالية:", "Next slice:"], "ks-prev-lbl": ["شريحة سابقة:", "Previous slice:"],
  "ks-fit-lbl": ["ملاءمة:", "Fit:"], "ks-measure-lbl": ["قياس:", "Measure:"],
  "ks-zoomin-lbl": ["تكبير:", "Zoom in:"], "ks-zoomout-lbl": ["تصغير:", "Zoom out:"], "ks-contrast-lbl": ["تبديل التباين:", "Cycle contrast:"],
  "lbl-default-export": ["تنسيق التصدير الافتراضي:", "Default export format:"],
  "lbl-gzip": ["ضغط حزم الاستشارة (gzip)", "Compress consult packages (gzip)"],
  "lbl-pacs-ae": ["AE Title (لأنظمة DICOM القديمة — لا يستخدمه DICOMweb):", "AE Title (legacy DICOM — unused by DICOMweb):"],
  "lbl-pacs-port": ["منفذ اختياري يُضاف للعنوان:", "Optional port appended to URL:"],
  "lbl-set-retention": ["حذف تلقائي للمسودات/الدراسات بعد:", "Auto-delete drafts/studies after:"],
  "lbl-set-retention-signed": ["الموقّع بعد:", "Signed after:"],
  "rebuild-cache": ["إعادة بناء مخبأ الأوفلاين", "Rebuild offline cache"],
  "clear-db": ["تفريغ قاعدة الدراسات المحلية", "Empty local study database"],
  "about-disclaimer": ["إخلاء المسؤولية الطبية: التقارير الناتجة دعمٌ للقرار السريري وتتطلب مراجعة أخصائي الأشعة وتوقيعه؛ لا تُعد تشخيصًا نهائيًا ولا تُستخدم في أبحاث دون موافقة أخلاقية.", "Medical disclaimer: outputs are clinical decision support requiring radiologist review and sign-off; not a final diagnosis, and not for research without ethical approval."],
  "about-privacy": ["الصور والدراسات تُخزّن محليًا في المتصفح. AI السحابي يرسل المحتوى الموافق عليه إلى المزوّد المختار؛ ذكاء المؤسسة يرسل الملاحظات وسياق الفحص دون صور. PACS والتنزيل يتصلان بالخادم الذي تختاره، وقد تتضمن سجلاته معرّفات. إخفاء الهوية ليس تلقائيًا.", "Studies and images are stored locally in your browser. Cloud AI sends approved content to the selected provider; institution AI sends notes and study context without images. PACS and downloads contact the chosen server, whose logs may contain identifiers. De-identification is not automatic."],
  "about-licenses": ["المكونات والتراخيص: راجع ملفات الترخيص في المستودع. بعض صيغ الصور المضغوطة تحتاج مكونات فك ترميز إضافية قد تتطلب تنزيلًا أوليًا.", "Components and licenses: see the repository license files. Some compressed image formats need additional decoders that may require an initial download."],
  "about-support": ["الدعم: عبر مسؤول النظام بالقسم، أو مستودع التطبيق الخاص على GitHub (Radiology-report-AI).", "Support: via your department system admin, or the private GitHub repository (Radiology-report-AI)."],
  "hint-main": ["⚙ الاستيراد والعارض والتقارير محلية. AI السحابي اختياري بموافقتك؛ PACS والتنزيل يتصلان بخدمات خارجية. من قائمة المتصفح ⋮ ← \"إضافة إلى الشاشة الرئيسية\" لتثبيتها كتطبيق.", "⚙ Import, viewing and reports are local. Cloud AI is optional with consent; PACS and downloads contact external services. From the browser menu ⋮ choose \"Add to Home screen\" to install it as an app."]
};
const PRESET_L = { auto: ["تلقائي", "Auto"], soft: ["نسيج رخو", "Soft tissue"], lung: ["رئة", "Lung"], mediastinum: ["منصف", "Mediastinum"], bone: ["عظم", "Bone"], brain: ["دماغ", "Brain"] };
const OPTS_L = {
  "wl-priority": {"": ["كل الأولويات", "All priorities"], "urgent": ["حرج", "Urgent"], "consult": ["استشارة", "Consultation"], "routine": ["روتيني", "Routine"]},
  "wl-state": {"": ["الكل", "All"], "signed": ["موقّع", "Signed"], "unsigned": ["غير موقّع", "Unsigned"]},
  "retention-days": { "30": ["30 يوم", "30 days"], "90": ["3 أشهر (90 يوم)", "3 months (90 days)"], "180": ["6 أشهر", "6 months"], "365": ["سنة", "1 year"], "0": ["بدون حذف تلقائي", "No auto-delete"] },
  "retention-signed-days": { "90": ["3 أشهر", "3 months"], "180": ["6 أشهر", "6 months"], "365": ["سنة", "1 year"], "730": ["سنتان", "2 years"], "0": ["بدون حذف", "No delete"] },
  "fu-months": { "0": ["بدون متابعة", "No follow-up"], "3": ["مراجعة بعد 3 أشهر", "Review in 3 months"], "6": ["مراجعة بعد 6 أشهر", "Review in 6 months"], "12": ["مراجعة بعد سنة", "Review in 1 year"] },
  "ai-provider": { "groq": ["Groq — مجاني بلا بطاقة (افتراضي)", "Groq — free, no card (default)"], "openrouter": ["OpenRouter — نماذج :free بلا بطاقة", "OpenRouter — :free models, no card"], "gemini": ["Google Gemini — إن قبل حسابك التسجيل بلا فوترة", "Google Gemini — if your account allows no-billing signup"], "server": ["سيرفر المؤسسة (Vercel) — المفتاح عند القسم لا على الجهاز", "Institution server (Vercel) — key held by the department, not the device"] },
  "measure-mode": {"seg":["قطع","Segment"],"angle":["زاوية","Angle"],"roi":["قطع ناقص","Ellipse ROI"],"rect":["مستطيل","Rectangle ROI"],"probe":["قيمة البكسل","Pixel value"]},
  "compare-sel": { "seg": ["قطع", "Segment"], "angle": ["زاوية", "Angle"], "roi": ["ROI", "ROI"] },
  "pacs-auto": { "0": ["معطّل", "Disabled"], "5": ["كل 5 دقائق", "Every 5 min"], "15": ["كل 15 دقيقة", "Every 15 min"], "30": ["كل 30 دقيقة", "Every 30 min"] },
  "theme-sel": { "dark": ["داكن طبي عالي التباين", "High-contrast medical dark"], "light": ["فاتح سماوي طبي", "Medical cyan light"] },
  "sort-sel": { "urgent": ["الحرج أولًا", "Urgent first"], "date": ["الأحدث إضافةً", "Newest added"], "name": ["أبجديًا بالاسم", "By patient name"] },
  "measure-unit": { "mm": ["مليمتر (مم)", "Millimeters (mm)"], "cm": ["سنتيمتر (سم)", "Centimeters (cm)"] },
  "default-export-sel": { "word": ["Word — قالب إنجليزي (.docx)", "Word — English template (.docx)"], "pdf": ["PDF", "PDF"] },
  "lang-sel": { "ar": ["العربية", "Arabic"], "en": ["English", "English"] }
};
OPTS_L["sort-sel"].study=["تاريخ الدراسة (DICOM)","Study date (DICOM)"];
OPTS_L["wl-sort"]=OPTS_L["sort-sel"];
OPTS_L["default-win-sel"] = PRESET_L;
for (const pl of ["axial", "coronal", "sagittal"]) OPTS_L["mpr-preset-" + pl] = PRESET_L;
OPTS_L["set-retention-days"] = OPTS_L["retention-days"];
OPTS_L["set-retention-signed"] = OPTS_L["retention-signed-days"];
const REASON_EN = {
  "نوع الفحص غير محدد — طُبّقت قاعدة عامة محافظة": "Exam type undetermined — conservative default rule applied",
  "بؤرة عالية الكثافة داخل قحفية — يُشتبه نزف حاد": "Hyperdense intracranial focus — acute hemorrhage suspected",
  "منطقة واسعة منخفضة الكثافة — يُشتبه وذمة/احتشاء": "Broad hypodense region — edema/infarct suspected",
  "عدم تناصف نصفيّ ملحوظ — يُشتبه انزياح خط منتصف": "Marked hemispheric asymmetry — midline shift suspected",
  "لا علامة حادة بمعايير الدماغ المتاحة": "No acute sign by available brain criteria",
  "ليست صورة رمادية — لا فرز": "Not a grayscale image — no triage",
  "لا معيار كسور حاد متاح بعد — بروتوكول العظم قيد التطوير (v0.5+)": "No acute fracture criterion yet — bone protocol in development (v0.5+)"
};
const PLACE_L = { "tpl-name":["اسم القالب","Template name"],"tpl-findings":["FINDINGS — سطر لكل جملة","FINDINGS — one sentence per line"],"tpl-impression":["IMPRESSION — سطر لكل نقطة","IMPRESSION — one item per line"], "wl-query":["اسم، معرّف، فحص، سلسلة أو تاريخ…","Name, ID, exam, series or date…"], "rep-notes": ["مثال: مريض بعد تثبيت قطني قبل 6 سنوات، ألم أسفل الظهر مع اعتلال جذري أيمن…", "e.g. patient after lumbar fixation 6 years ago, low back pain with right radiculopathy…"], "pacs-dl-url": ["https://we.tl/t-… أو https://…/study.zip أو https://…/study.dcm", "https://we.tl/t-… or https://…/study.zip or https://…/study.dcm"], "pacs-url": ["https://pacs.hospital.local/dicom-web", "https://pacs.hospital.local/dicom-web"], "pacs-q": ["معرف المريض (اختياري)", "Patient ID (optional)"] };
function fileLbl(inp, lbl) {
  const el = document.getElementById(inp), lb = document.getElementById(lbl);
  if (!el || !lb) return;
  const n = (el.files || []).length;
  lb.textContent = n ? (LANG === "en" ? n + " file(s) selected" : "تم اختيار " + n + " ملف") : (LANG === "en" ? "No file chosen" : "لم يتم اختيار أي ملف");
}
const ATTR_L = {
  "menu-btn": {
    "title": [
      "القائمة",
      "Menu"
    ]
  },
  "settings-btn": {
    "title": [
      "الإعدادات",
      "Settings"
    ]
  },
  "vs-fold": {
    "title": [
      "إعدادات العارض: القياس، الشريحة، النافذة، التدوير، السلاسل",
      "Viewer settings: measurement, slice, window, rotation and series"
    ]
  },
  "fs-fold": {
    "title": [
      "الإعدادات",
      "Settings"
    ]
  },
  "fs-exit": {
    "title": [
      "خروج من ملء الشاشة",
      "Exit fullscreen"
    ]
  },
  "orient-invert": {
    "title": [
      "قلب الأبيض والأسود",
      "Invert grayscale"
    ]
  },
  "orient-rotate": {
    "title": [
      "تدوير ٩٠°",
      "Rotate 90°"
    ]
  },
  "orient-fliph": {
    "title": [
      "قلب أفقي",
      "Flip horizontal"
    ]
  },
  "orient-flipv": {
    "title": [
      "قلب رأسي",
      "Flip vertical"
    ]
  },
  "orient-reset": {
    "title": [
      "عودة إلى وضع التصوير الأصلي",
      "Reset view"
    ]
  },
  "pane-selector": {
    "aria-label": [
      "اختيار نافذة الأدوات",
      "Choose tool pane"
    ]
  },
  "dual-frame": {
    "aria-label": [
      "الصورة الثانية",
      "Second pane image"
    ]
  },
  "dual-slice": {
    "aria-label": [
      "شرائح النافذة الثانية",
      "Second pane slices"
    ]
  },
  "series-overview": {
    "aria-label": [
      "جميع السلاسل",
      "All series"
    ]
  },
  "cmp-close": {
    "aria-label": [
      "إغلاق",
      "Close"
    ]
  },
  "series-sheet-close": {
    "aria-label": [
      "إغلاق",
      "Close"
    ]
  },
  "mic-imp": {
    "title": [
      "إملاء صوتي عبر محرك المتصفح (قد يتطلب إنترنت وفق سياسة المتصفح)",
      "Dictate with the browser speech engine (may require internet under browser policy)"
    ]
  },
  "export-consult": {
    "title": [
      "حزمة موقّعة SHA-256: لقطة + فرز + تقرير + ملاحظات",
      "SHA-256 stamped package: snapshot, triage, report and notes"
    ]
  },
  "import-consult-clip": {
    "title": [
      "يلصق حزمة منسوخة دون المرور بمنتقي الملفات",
      "Paste a copied package without a file picker"
    ]
  },
  "signer": {
    "placeholder": [
      "اسم الأخصائي",
      "Specialist name"
    ]
  },
  "signer-license": {
    "placeholder": [
      "رقم الترخيص/النقابة",
      "License / registration number"
    ]
  },
  "org-ar": {
    "placeholder": [
      "اسم المستشفى (عربي)",
      "Hospital name (Arabic)"
    ]
  },
  "ai-key": {
    "placeholder": [
      "gsk_… (Groq) أو sk-or-… (OpenRouter) أو AIza… (Gemini)",
      "gsk_… (Groq) or sk-or-… (OpenRouter) or AIza… (Gemini)"
    ]
  },
  "measure-mode": {
    "aria-label": [
      "أداة القياس",
      "Measurement tool"
    ]
  }
};
ATTR_L["import-consult-last"]={title:["يعيد إدخال آخر حزمة بُنيت على هذا الجهاز — بلا منتقي ملفات","Re-import the last package built on this device without a file picker"]};
function applyInterfaceText(){
  for (const [id, pair] of Object.entries(I18N)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const txt = pair[LANG === "en" ? 1 : 0];
    // Translate only owned text nodes, retaining select/input identity, state and listeners.
    if (!el.children.length) el.textContent=txt;
    else {
      const nodes=[...el.childNodes].filter(n=>n.nodeType===3&&n.nodeValue.trim());
      if(nodes.length){nodes[0].nodeValue=txt+' ';for(const n of nodes.slice(1))n.nodeValue='';}
    }
  }
  for (const [pid, pl] of Object.entries(PLACE_L)) { const pe = document.getElementById(pid); if (pe) pe.placeholder = pl[LANG === "en" ? 1 : 0]; }
  const pre = document.getElementById("preset");
  if (pre) for (const o of pre.options) { const pl = PRESET_L[o.value]; if (pl) o.textContent = pl[LANG === "en" ? 1 : 0]; }
  for (const [sid, mp] of Object.entries(OPTS_L)) { const se = document.getElementById(sid); if (se) for (const o of se.options) { const pl = mp[o.value]; if (pl) o.textContent = pl[LANG === "en" ? 1 : 0]; } }
  for(const [id,attrs] of Object.entries(ATTR_L)){
    const el=$(id);if(!el)continue;
    for(const [attr,pair] of Object.entries(attrs))el.setAttribute(attr,pair[LANG==='en'?1:0]);
  }
}
function viewerStateLabels(){
 const en=LANG==='en',dual=$('dual-toggle'),all=$('all-toggle'),mpr=$('mpr-toggle'),link=$('mpr-link-view');
 if(dual)dual.textContent=en?(dualOn?'Single pane':'Split view'):(dualOn?'نافذة واحدة':'نافذتان');
 if(all)all.textContent=en?(allOn?'Single view':'All series × 3 planes'):(allOn?'عرض مفرد':'عرض شامل: كل السلاسل × ٣ مستويات');
 if(mpr)mpr.textContent=en?(mprOn?'Single view':'MPR: axial / coronal / sagittal'):(mprOn?'عرض مفرد':'MPR: محوري / إكليلي / سهمي');
 if(link){const linked=link.getAttribute('aria-pressed')==='true';link.textContent=en?(linked?'MPR linked zoom / pan ✓':'MPR independent zoom / pan'):(linked?'MPR تكبير/تحريك متزامن ✓':'MPR تكبير/تحريك مستقل');}
 cineLabel();vsLabel();
 const identity=$('id-toggle');if(identity)identity.textContent=en?(vState?.identityHidden?'Identity hidden':'Hide identity'):(vState?.identityHidden?'الهوية مخفية':'إخفاء الهوية');
 updatePaneTools();
}
function applyLang(lang) {
  LANG = lang === "en" ? "en" : "ar";
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "en" ? "ltr" : "rtl";
  applyInterfaceText();
  fileLbl("files", "files-lbl"); fileLbl("ai-extra", "ai-extra-lbl");
  try { updDrawer();fillAbout(); } catch (e) {}
  try { cmpText(); } catch (e) {}   /* v147: the compare sheet is bilingual too */
  setStatus(LANG === "en" ? "Language set to English." : "ضُبطت اللغة على العربية.", false);
  try { renderArchive();renderTplList(); } catch (e) {}
  try { const ss = document.getElementById("stats-set"); if (ss && ss.open) computeStats(); } catch (e) {}
  try { if (current) openStudy(current); } catch (e) {}
  try { refresh(); } catch (e) {}
  const lt = document.getElementById("lang-toggle");
  if (lt) lt.textContent = LANG === "en" ? "ع" : "EN";
  if($("lang-sel"))$("lang-sel").value=LANG;
  try { localStorage.setItem("rrai-lang", LANG); } catch (e) {}
  if (typeof refresh === "function") refresh().catch(() => {});
  /* the rotate button carries the current angle and the fold its arrow, so
     both are written here too */
  try { orientLabels(); } catch (e) {}
  try { vsLabel();viewerStateLabels();reportDownloadLabels(); } catch (e) {}
}
function swSelfHeal() {
  if (!("serviceWorker" in navigator)) return;
  const cc = () => {
    try {
      const k = "rrai-cc-" + APP_BUILD;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
      setTimeout(() => location.reload(), 400);
    } catch (e) { location.reload(); }
  };
  navigator.serviceWorker.ready.then((reg) => {
    navigator.serviceWorker.addEventListener("controllerchange", cc);
    const poke = () => { try { if (reg && reg.update) reg.update().catch(() => {}); } catch (e) {} };
    setInterval(poke, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poke(); });
  }).catch(() => {});
}
export async function init() {
  swSelfHeal();
  try { releaseWatch(); } catch (e) {}
  try {
  stage("error-listeners");
  window.addEventListener("unhandledrejection", (ev) => {
    const m = (ev.reason && ev.reason.message) ? ev.reason.message : String(ev.reason);
    if (/ServiceWorker|service worker|sw\.js/i.test(m)) { console.warn("sw-silenced:", m); return; }
    setStatus("خطأ غير متوقع: " + m, true);
  });
  window.addEventListener("error", (ev) => {
    setStatus("خطأ: " + (ev.message || "غير معروف"), true);
  });
  stage("module-load");
  await loadAllModules();
  stage("storage-boot");
  try {
    openDb().then(async (d) => {
      db = d;
      await refresh();
    }).catch((e) => {
      setStatus("تعذر فتح تخزين الجهاز: " + (e && e.message ? e.message : e) + " — سيعمل التطبيق بذاكرة الجلسة فقط (البيانات لن تبقى بعد الإغلاق).", true);
    });
  } catch (e) {
    setStatus("تعذر بدء التخزين: " + (e && e.message ? e.message : e) + " — ذاكرة الجلسة فقط.", true);
  }
  stage("viewer-listeners");
  let showRaf = 0, cmpT = 0;
$("slice").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  if (showRaf) cancelAnimationFrame(showRaf);
  showRaf = requestAnimationFrame(() => { showRaf = 0; show(v); });
  clearTimeout(cmpT); cmpT = setTimeout(() => drawCompare(), 180);
});
  { const ps = $("preset"); if (ps) ps.addEventListener("change", () => show(sliceIdx())); }
  const dirIn = $("files-dir");
  const pickDir = $("pick-dir");
  if (pickDir && dirIn) {
    pickDir.addEventListener("click", () => dirIn.click());
    dirIn.addEventListener("change", async () => {
      const fs = Array.from(dirIn.files || []);
      dirIn.value = "";
      if (!fs.length) return;
      setStatus(LANG === "en" ? "Reading " + fs.length + " files from the folder…" : "قراءة " + fs.length + " ملفًا من المجلد…");
      try {
        const r = await ingestFiles(fs);
        const badMsg = (r.bad ? (LANG === "en"
          ? " Warning: " + r.bad + " file(s) carry no readable pixel data and were not stored."
          : " تحذير: " + r.bad + " ملفًا لا تحمل بيانات بكسل قابلة للعرض ولم تُخزّن.") : "");
        if (!r.added) {
          const why = ingestRefusal(r, LANG);
          const dup = await openDuplicateIfAny(r);
          setStatus((LANG === "en" ? "Nothing was added from the folder: " : "لم تُضف أي دراسة من المجلد: ")
            + (why.length ? why.join(LANG === "en" ? ", " : "، ") : (LANG === "en" ? "no readable study in the selection" : "لا دراسة مقروءة في الملفات المختارة")) + "."
            + (dup ? (LANG === "en" ? " Opened the copy already on this device." : " فُتحت النسخة الموجودة مسبقًا على الجهاز.") : ""), true);
          showImportReport();
        } else {
          setStatus(LANG === "en" ? "Added " + r.added + " studies from the folder" + (r.skipped ? " (skipped " + r.skipped + " non-DICOM files)" : "") + (r.dups ? " (" + r.dups + " duplicate(s) already on device — skipped)" : "") + "." : "أُضيفت " + r.added + " دراسة من المجلد" + (r.skipped ? " (تُخطّي " + r.skipped + " ملفًا غير DICOM)" : "") + (r.dups ? " — تُخطّي " + r.dups + " دراسة مكررة موجودة مسبقًا" : "") + badMsg + ".");
        }
      try { if (localStorage.getItem("rrai-auto-open") === "1" && r.added > 0) { const all2 = await allStudies(); if (all2.length) await openStudy(all2[0]); } } catch (e2) {}
      } catch (e) {
        setStatus(LANG === "en" ? "Folder read failed: " + (e && e.message ? e.message : e) : "فشلت قراءة المجلد: " + (e && e.message ? e.message : e), true);
      }
    });
  }
  $("upload").addEventListener("click", async () => {
    const input = $("files");
    if (!input.files.length) {
      setStatus(LANG==="en"?"Choose DICOM files first, then Upload & analyze.":"اختر ملفات DICOM أولًا ثم اضغط رفع وتحليل.", true);
      return;
    }
    let r;
    try {
      r = await ingestFiles(input.files);
      const badMsg2 = (r && r.bad ? (LANG === "en"
        ? " تحذير: " + r.bad + " ملفًا بلا بيانات بكسل قابلة للعرض."
        : " تحذير: " + r.bad + " ملفًا بلا بيانات بكسل قابلة للعرض.") : "");
    } catch (e) {
      setStatus("فشل الرفع: " + (e && e.message ? e.message : e), true);
      input.value = "";
      return;
    }
    if (r.added === 0) {
      const en = LANG === "en";
      const why = ingestRefusal(r, LANG);
      const hint = (r.dups && !r.skipped && !r.bad)
        ? (en ? " Open it from the worklist — importing the same study twice stores nothing new."
              : " افتحها من قائمة العمل — إعادة استيراد الدراسة نفسها لا يخزّن شيئًا جديدًا.")
        : ((r.skipWhy && Object.keys(r.skipWhy).some((k) => k.indexOf("decode:") === 0))
          ? (en ? " Compressed files need their decoder once: connect to the internet for the first import and it is cached for offline use after that."
                : " الملفات المضغوطة تحتاج مفكّها مرة واحدة: اتصل بالإنترنت عند أول استيراد، ثم يُحفظ المفكّ للعمل دون إنترنت.")
          : "");
      const dup = await openDuplicateIfAny(r);
      setStatus(
        (en ? "No study was added: " : "لم تُضف أي دراسة: ")
        + (why.length ? why.join(en ? ", " : "، ") : (en ? "no readable study in the selection" : "لا دراسة مقروءة في الملفات المختارة"))
        + "." + hint
        + (dup ? (en ? " Opened the copy already on this device." : " فُتحت النسخة الموجودة مسبقًا على الجهاز.") : ""),
        true
      );
      showImportReport();
    } else {
      setStatus(
        "تمت إضافة " + r.added + " دراسات" + (r.skipped ? " — تم تجاهل " + r.skipped + " ملفات غير مدعومة" : "") + badMsg2 + ".",
        false
      );
    }
    input.value = "";
  });
  stage("upload-demo-listeners");
  $("demo").addEventListener("click", async () => {
    try {
      await seedDemo();
      setStatus("ديمو جاهز: دراستان في القائمة.", false);
    } catch (e) {
      setStatus("فشل توليد ديمو: " + (e && e.message ? e.message : e), true);
    }
  });
  stage("setups");
  setupConsultUI();
  setupSignExport();
  setupMeasureUI();
  mprWire();
  vrWire();
  try { if (localStorage.getItem("rrai-mpr-on") === "1" && current) mprToggle(true); } catch (e) {}
  setupCompareUI();
  $("gen-report").addEventListener("click", () => {
    if(!current)return;
    $("composer-set").open=true;
    setStatus(LANG==='en'?'Edit and review the report, then use Download report Word — EN.':'حرّر التقرير وراجعه ثم استخدم «تنزيل التقرير Word — EN».',false);
  });
  $("copy-report").addEventListener("click", () => {
    const t = $("report-ar").textContent + "\n\n" + $("report-en").textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t);
  });
  const plBtn = $("prior-line");
  if (plBtn) plBtn.addEventListener("click", async () => {
    const uid = plBtn.dataset.uid; if (!uid) return;
    const all = await allStudies();
    const t = all.find((x) => x.uid === uid); if (t) openStudy(t);
  });
  $("export-csv").addEventListener("click", async () => {
    try {
    const list = await allStudies();
    const rows = [["Patient", "Modality", "Slices", "Priority", "Status", "StudyDate", "AddedAt"]];
    for (const s2 of list) rows.push([(s2.meta && s2.meta.patientName) || s2.patient || "", s2.modality, s2.frames.length, (s2.triage && s2.triage.priority) || "routine", s2.signedBy ? "signed" : (s2.consult ? "consult" : "draft"), (s2.meta && s2.meta.studyDate) || "", new Date(s2.createdAt || s2.created || Date.now()).toISOString()]);
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = "worklist-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click(); URL.revokeObjectURL(a.href);
    setStatus(LANG === "en" ? "Worklist exported as CSV to this device." : "صُدّرت قائمة العمل ملف CSV على جهازك.", false);
    } catch (e) { setStatus((LANG === "en" ? "CSV export failed: " : "فشل تصدير CSV: ") + e.message, true); }
  });
  $("clear-all").addEventListener("click", async () => {
    if (!confirm(LANG==="en"?"Delete ALL studies from this device, including those hidden by filters?":"حذف جميع الدراسات من هذا الجهاز، بما فيها الدراسات المخفية بالتصفية؟")) return;
    await txClear();
    current = null;
    await refresh();
  });
  const vp = $("viewport");
  const ptrs = new Map();
  let pinch0 = 0, k0 = 1, moved = false, swAccum = 0;
  vp.addEventListener("pointerdown", (e) => {
    vp.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false; swAccum = 0;
    if (ptrs.size === 2) {
      const v = [...ptrs.values()];
      pinch0 = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]);
      k0 = vk;
    }
  });
  vp.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const v = [...ptrs.values()];
      const d = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]);
      if (pinch0 > 0) {
      vst({ type: "setZoom", zoom: (k0 * d) / pinch0 });
      const k1 = (vState && vState.zoom) || Math.max(0.5, Math.min(8, (k0 * d) / pinch0));
      const cx = (v[0][0] + v[1][0]) / 2, cy = (v[0][1] + v[1][1]) / 2;
      const r = $("vwrap").getBoundingClientRect();
      const Ox = r.width / (2 * vk), Oy = r.height / (2 * vk);
      vx += (k1 - vk) * (Ox - (cx - r.left) / vk);
      vy += (k1 - vk) * (Oy - (cy - r.top) / vk);
      vk = k1; moved = true; applyView();
    }
    } else if (ptrs.size === 1 && vk <= 1.01 && fsNow()) {
      swAccum -= e.clientY - prev[1];
      const sl = $("slice");
      let idx = Number(sl.value || 0);
      let chg = false;
      while (swAccum >= 60 && idx < Number(sl.max)) { idx += 1; swAccum -= 60; chg = true; }
      while (swAccum <= -60 && idx > 0) { idx -= 1; swAccum += 60; chg = true; }
      if (chg) { moved = true; sl.value = String(idx); show(idx); }
    } else if (ptrs.size === 1 && vk > 1.01) {
      vx += e.clientX - prev[0]; vy += e.clientY - prev[1]; moved = true; vst({ type: "panBy", dx: e.clientX - prev[0], dy: e.clientY - prev[1] }); clampPan(); applyView();
    } else if (ptrs.size === 1 && Math.hypot(e.clientX - prev[0], e.clientY - prev[1]) > 4) {
      moved = true;
    }
  });
  const vpUp = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = 0;
    if (!moved && ptrs.size === 0 && fsNow()) fsArm();
    if (!moved && measureMode && ptrs.size === 0) {
      const p = secondaryImagePoint(e.clientX,e.clientY,$("frame").getBoundingClientRect(),curFrame(),orientNow());
      if(!p)return;
      mPts.push(p);
      const need = mMode === "angle" ? 3 : (mMode === "probe" ? 1 : 2);
      if (mPts.length >= need) {
        if (mMode === "seg") {
          const f = curFrame();
          const sp = validMeasurementSpacing(f);
          mItems.segments.push({
            a: mPts[0], b: mPts[1],
            px: Math.hypot(mPts[1][0] - mPts[0][0], mPts[1][1] - mPts[0][1]),
            mm: segMm(mPts[0], mPts[1], sp),
          });
        } else if (mMode === "angle") {
          const sp=validMeasurementSpacing(curFrame()),pts=sp?mPts.map(p=>[p[0]*sp[1],p[1]*sp[0]]):mPts;
          mItems.angles.push({ p1: mPts[0], v: mPts[1], p2: mPts[2], deg: angleDeg(...pts),calibrated:!!sp });
        } else if (mMode === "rect") {
          /* v147 — every pixel of the box, min and max included: a rectangle is
             what goes over a vertebra or an adrenal, not an ellipse. */
          const f = curFrame();
          const st = f && rectStats ? rectStats(f, mPts[0], mPts[1]) : null;
          if (st) mItems.rects.push({ a: mPts[0], b: mPts[1], mean: st.mean, std: st.std, min: st.min, max: st.max, n: st.n, unit: st.unit });
        } else if (mMode === "probe") {
          /* v147 — the value under the finger, in the unit the file declares. */
          const f = curFrame();
          if (f && grayAt) {
            const x = Math.max(0, Math.min(f.w - 1, Math.round(mPts[0][0])));
            const y = Math.max(0, Math.min(f.h - 1, Math.round(mPts[0][1])));
            mProbe = { p: [x, y], v: grayAt(f, x, y), unit: f.hu ? "HU" : "gray" };
          }
        } else {
          const f = curFrame();
          const rx = Math.max(2, Math.abs(mPts[1][0] - mPts[0][0])), ry = Math.max(2, Math.abs(mPts[1][1] - mPts[0][1]));
          const st = f ? ellipseStats(f, mPts[0], rx, ry) : null;
          if (st) mItems.rois.push(Object.assign({ c: mPts[0], rx, ry }, st));
        }
        mPts = [];
        commitMeasurements();
      }
      drawOverlay();
      measureOut();
    }
  };
  vp.addEventListener("pointerup", vpUp);
  vp.addEventListener("pointercancel", e=>{ptrs.delete(e.pointerId);pinch0=0;moved=true;mPts=[];drawOverlay();});
  vp.addEventListener("dblclick", (e) => {
    if (vk > 1.01) { viewKey = ""; resetView(true, curFrame() || undefined); }
    else { const pt = imgPoint(e); vst({ type: "setZoom", zoom: 2 }); vk = (vState && vState.zoom) || 2; centerOn(pt[0], pt[1]); setStatus("\u062a\u0643\u0628\u064a\u0631 \u00d72 \u2014 \u0646\u0642\u0631\u0629 \u0645\u0632\u062f\u0648\u062c\u0629 \u062b\u0627\u0646\u064a\u0629 \u0623\u0648 \u0632\u0631 \u0645\u0644\u0627\u0621\u0645\u0629 \u064a\u0639\u064a\u062f\u0627\u0646 \u0627\u0644\u0635\u0648\u0631\u0629 \u0644\u0644\u0634\u0627\u0634\u0629."); }
  });
  { let rsz = 0;
    const refit = () => { if (rsz) return; rsz = requestAnimationFrame(() => { rsz = 0; if (current) resetView(true); }); };
    window.addEventListener("resize", refit);
    document.addEventListener("fullscreenchange", refit);
  }
  $("zoom-reset").addEventListener("click", () => resetView(true));
  $("fs-toggle").addEventListener("click", () => {
    const card = $("viewer-card");
    if (document.fullscreenElement) { try { document.exitFullscreen().catch(() => {}); } catch (e) {} return; }
    if (card && card.requestFullscreen) { card.requestFullscreen().catch(() => card.classList.toggle("fs-fake")); }
    else if (card) card.classList.toggle("fs-fake");
    fsSetFold(true);
    try { if (current) resetView(true); } catch (e) {}
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) { fsArm(); fsSetFold(true); }
    else fsBarShow(true);
    const b = $("fs-toggle");
    if (b) b.textContent = document.fullscreenElement ? (LANG === "ar" ? "خروج من ملء الشاشة" : "Exit fullscreen") : (LANG === "ar" ? "ملء الشاشة" : "Fullscreen");
  });
  $("measure").addEventListener("click", () => {
    /* v147: one tool is live at a time, and the state says which. */
    vst({ type: "setTool", tool: (vState && vState.tool === "measure") ? "scroll" : "measure" });
    measureMode = !!(vState && vState.tool === "measure");
    mPts = [];
    if(measureMode&&current)mItems=frameMeasures(1);
    drawOverlay();
    measureOut();
    $("measure").style.color = measureMode ? "var(--accent)" : "";
    $("measure").style.borderColor = measureMode ? "var(--accent)" : "";
  });
  applyLang(localStorage.getItem("rrai-lang") || "ar");
  const ltBtn = $("lang-toggle");
  if (ltBtn) ltBtn.addEventListener("click", () => applyLang(LANG === "ar" ? "en" : "ar"));
  setupPacs();
  setupComposer();
  setupTemplates();
  setupArchive();
setupExtras();
setupFilePickers();
setupWorklist();
setupMenuSettings();
  setupAi();
  applyInterfaceText();viewerStateLabels();
  stage("update-sw");
  checkUpdate();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
  stage("ready");
  } catch (e) { bootBanner(e); }
}

/* ---- teleradiology consult wiring (v0.5.2) ---- */
function setupConsultUI() {
  const exp = document.createElement("button");
  exp.className = "ghost";
  exp.id = "export-consult";
  exp.textContent = LANG === "en" ? "Export consult package" : "تصدير حزمة استشارة";
  exp.title = "حزمة موقّعة SHA-256: لقطة + فرز + تقرير + ملاحظات";
  /* v147 (2): it used to be dropped next to «ملاءمة», which put an export
     button in the one row that stays on screen. It is a setting like the rest. */
  const row = ($("measure") && $("measure").parentNode) || ($("zoom-reset") && $("zoom-reset").parentNode);
  if (row) row.appendChild(exp);
  exp.onclick = () => exportConsult();
  const imp = document.createElement("button");
  imp.className = "ghost";
  imp.id = "import-consult";
  imp.textContent = LANG === "en" ? "Import consult package" : "استيراد حزمة استشارة";
  const ca = $("clear-all");
  if (ca && ca.parentNode) ca.parentNode.insertBefore(imp, ca);
  const fi = document.createElement("input");
  fi.type = "file";
  fi.style.display = "none";
  fi.id = "consult-file";
  document.body.appendChild(fi);
  imp.onclick = () => { setStatus(LANG === "en" ? "Choose the package file (usually in Downloads)." : "اختر ملف الحزمة (عادة في مجلد التنزيلات).", false); fi.click(); };
  const imp2 = document.createElement("button");
  imp2.className = "ghost";
  imp2.id = "import-consult-clip";
  imp2.textContent = LANG === "en" ? "Import from clipboard" : "استيراد من الحافظة";
  imp2.title = "يلصق حزمة منسوخة دون المرور بمنتقي الملفات";
  if (ca && ca.parentNode) ca.parentNode.insertBefore(imp2, ca);
  const imp3 = document.createElement("button");
  imp3.className = "ghost";
  imp3.id = "import-consult-last";
  imp3.textContent = LANG === "en" ? "Import last exported package" : "استيراد آخر حزمة مصدّرة";
  imp3.title = "يعيد إدخال آخر حزمة بُنيت على هذا الجهاز — بلا منتقي ملفات";
  if (ca && ca.parentNode) ca.parentNode.insertBefore(imp3, ca);
  imp3.onclick = async () => {
    const t = localStorage.getItem("rrai-last-pkg");
    if (!t) { setStatus(LANG === "en" ? "No exported package stored on this device yet — export one first." : "لا حزمة مصدّرة محفوظة على هذا الجهاز بعد — صدّر واحدة أولًا.", true); return; }
    await importConsultText(t);
  };
  imp2.onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.trim()) { setStatus(LANG === "en" ? "Clipboard is empty — copy the package first on the sending device." : "الحافظة فارغة — انسخ الحزمة أولًا من جهاز الإرسال.", true); return; }
      await importConsultText(t);
    } catch (e) { setStatus((LANG === "en" ? "Could not read clipboard: " : "تعذّرت قراءة الحافظة: ") + (e && e.message ? e.message : e), true); }
  };
  fi.onchange = async () => {
    const f = fi.files && fi.files[0];
    fi.value = "";
    if (f) await importConsult(f);
  };
}

async function snapshotFrame() {
  try { return $("frame").toDataURL("image/png"); } catch (e) { return ""; }
}

async function exportConsult() {
  if (!current) { setStatus("افتح دراسة أولًا قبل تصدير استشارة.", true); return; }
  const isReply = !!current.consult;
  let studyForPkg = current;
  try { if (!isReply && localStorage.getItem("rrai-anon") === "1") { const an2 = anonName((current.meta && current.meta.patientName) || current.patient || ""); studyForPkg = Object.assign({}, current, { patient: an2, meta: Object.assign({}, current.meta, { patientName: an2 }) }); } } catch (e2) {}
  const note = prompt(isReply ? "ردّ المستشار (انطباع/توصية):" : "ملاحظتك السريرية أو سؤالك للمستشار:", "") || "";
  let actor = current.signedBy || "";
  if (!actor) actor = prompt("اسمك (يُسجل في الحزمة):", "") || "unknown";
  const reportText = ($("report-ar").textContent || "").trim() || draftReport(current).ar;
  const pkg = await buildPackage({
    reply: isReply,
    actor,
    note,
    study: isReply ? null : studyForPkg,
    refUid: isReply ? ((current.consult && current.consult.refUid) || current.uid) : "",
    refHash: isReply ? (current.consult && current.consult.hash) : "",
    triage: current.triage || null,
    reportText,
    measurePts: (typeof mPts !== "undefined" ? mPts : []) || [],
    measurements: current.measurements || null,
    measurementFrames: current.measurementFrames || null,
    snapshotPng: await snapshotFrame(),
  });
  const fname = (isReply ? "rrai-reply-" : "rrai-consult-") + (current.patient || "study") + ".json";
  let gzOk = false;
  try {
    if (localStorage.getItem("rrai-gzip") === "1" && typeof CompressionStream !== "undefined") {
      const cs = new CompressionStream("gzip");
      const stream = new Blob([JSON.stringify(pkg)]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([buf], { type: "application/gzip" }));
      a2.download = fname + ".gz";
      document.body.appendChild(a2); a2.click();
      setTimeout(() => { URL.revokeObjectURL(a2.href); a2.remove(); }, 400);
      gzOk = true;
    }
  } catch (e2) {}
  if (!gzOk) downloadJson(pkg, fname);
  let copied = false;
  try { await navigator.clipboard.writeText(JSON.stringify(pkg)); copied = true; } catch (e) {}
  try { localStorage.setItem("rrai-last-pkg", JSON.stringify(pkg)); } catch (e) {}
  current.consultLog = current.consultLog || [];
  current.consultLog.push({ at: new Date().toISOString(), actor, action: isReply ? "reply-export" : "consult-export", hash: pkg.hash });
  try { await putStudy(current); } catch (e) {}
  setStatus((isReply ? (LANG === "en" ? "Consult reply exported: " : "صُدّر رد الاستشارة: ") : (LANG === "en" ? "Consult package exported: " : "صُدّرت حزمة الاستشارة: ")) + fname + (LANG === "en" ? " in Downloads" : " في التنزيلات") + (copied ? (LANG === "en" ? " + copied to clipboard (can be sent as text)." : " + منسوخة في الحافظة (يمكن إرسالها نصًا).") : "."), false);
}

async function pngToFrame(dataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  const rgb = new Uint8Array(c.width * c.height * 3);
  for (let i = 0; i < c.width * c.height; i++) {
    rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
  }
  return { kind: "rgb", w: c.width, h: c.height, data: rgb };
}

async function importConsult(file) {
  let text;
  try {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b && typeof DecompressionStream !== "undefined") {
      const ds = new DecompressionStream("gzip");
      const stream = new Blob([buf]).stream().pipeThrough(ds);
      text = await new Response(stream).text();
    } else text = new TextDecoder().decode(u8);
  } catch (e) { setStatus(LANG === "en" ? "File unreadable — import rejected (fail-closed)." : "تعذّرت قراءة الملف — رُفض الاستيراد (فشل مغلق).", true); return; }
  return importConsultText(text);
}

async function importConsultText(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch (e) {
    const t2 = text || "";
    if (t2.slice(0, 4) === "DICM" || t2.indexOf("\0") >= 0) {
      setStatus(LANG === "en" ? "The picked file is DICOM, not a consult package — package files are named rrai-consult-….json in Downloads, or use Import from clipboard / Import last exported package." : "الملف المحدد DICOM وليس حزمة استشارة — الحزمة اسمها rrai-consult-….json وتكون في مجلد التنزيلات Downloads، أو استخدم «استيراد من الحافظة» / «استيراد آخر حزمة مصدّرة».", true);
    } else {
      setStatus("المحتوى ليس JSON صالحًا — رُفض الاستيراد (فشل مغلق). أوله: " + JSON.stringify(t2.slice(0, 40)), true);
    }
    return;
  }
  const v = await validatePackage(pkg);
  if (!v.ok) { setStatus("رُفضت الحزمة: " + v.errors.join("؛ "), true); return; }
  setStatus("البصمة سليمة — جارٍ بناء الدراسة…", false);
  const p = pkg.payload;
  if (v.isReply) {
    const all = await allStudies();
    const target = all.find((s) => s.uid === p.refUid || (s.consult && s.consult.hash === p.refHash));
    if (!target) { setStatus("لا دراسة مطابقة لهذه المرجعية على هذا الجهاز.", true); return; }
    target.consultLog = target.consultLog || [];
    target.consultLog.push({ at: p.createdAt, actor: p.actor, action: "reply-import", note: p.note, hash: pkg.hash });
    target.consultReply = { actor: p.actor, note: p.note, at: p.createdAt };
    try { await putStudy(target); } catch (e) {}
    await refresh();
    setStatus("وصل رد المستشار " + p.actor + " وأُرفق بدراسة " + target.patient + ".", false);
    return;
  }
  let frames = [];
  if (p.snapshotPng) { try { frames = [await pngToFrame(p.snapshotPng)]; } catch (e) { setStatus("فشل فك لقطة الصورة: " + (e && e.message ? e.message : e), true); } }
  if (!frames.length) { setStatus("الحزمة سليمة لكن بلا لقطة صورة — رُفضت (فشل مغلق).", true); return; }
  const study = {
    uid: (p.study.uid || "consult") + "::c" + Date.now(),
    patient: p.study.patient || "CONSULT",
    modality: p.study.modality || "?",
    description: "استشارة واردة من " + p.actor,
    bodyPart: p.study.bodyPart || "",
    frames,
    triage: p.triage || null,
    created: Date.now(),
    consult: { from: p.actor, note: p.note, hash: pkg.hash, report: p.reportText || "", measurePts: p.measurePts || [], refUid: p.study.uid || "" },
    consultLog: [{ at: p.createdAt, actor: p.actor, action: "consult-import", hash: pkg.hash }],
  };
  try { await putStudy(study); } catch (e) {}
  await refresh();
  setStatus("استُوردت استشارة " + study.patient + " من " + p.actor + " — راجعها وصدّر ردّك.", false);
}

/* ---- v147: one English Word report, explicit download only ---- */
let reportExportBusy=false,reportFile=null,reportStudyUid=null;
const reportWordMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function reportExportSay(ar,en,bad=false){
 const text=LANG==='en'?en:ar,el=$('report-export-status');
 if(el){el.textContent=text;el.style.color=bad?'#fca5a5':'var(--text)';}
 setStatus(text,bad);
}
function clearReportFile(){
 if(reportFile){URL.revokeObjectURL(reportFile.url);reportFile=null;}
 const box=$('report-download-result');if(box)box.hidden=true;
 const link=$('report-download-again');if(link){link.removeAttribute('href');link.removeAttribute('download');}
 const name=$('report-download-name');if(name)name.textContent='';
}
function reportExportEdited(){
 clearReportFile();if($('signoff'))$('signoff').checked=false;
 if($('report-export-status'))$('report-export-status').textContent='';
}
function reportExportStudyChanged(study){
 if(reportStudyUid!==study?.uid){
  reportExportEdited();reportStudyUid=study?.uid||null;
  if($('signer')&&study?.signedBy)$('signer').value=study.signedBy;
  if($('signer-license')&&study?.license)$('signer-license').value=study.license;
 }
}
function reportDownloadLabels(){
 if(!reportFile)return;
 const box=$('report-download-result'),link=$('report-download-again');
 box.hidden=false;$('report-download-name').textContent=reportFile.name;
 $('report-download-message').textContent=LANG==='en'?'The English Word file is ready and was sent to the browser download flow.':'ملف Word الإنجليزي جاهز وأُرسل لمسار تنزيل المتصفح.';
 link.href=reportFile.url;link.download=reportFile.name;
}
function reportDownloadExisting(){
 if(!reportFile)return;
 reportDownloadLabels();
 const a=document.createElement('a');a.href=reportFile.url;a.download=reportFile.name;
 document.body.appendChild(a);a.click();a.remove();
 reportExportSay('أُرسل ملف Word للتنزيل؛ استخدم رابط نفس الملف أدناه إن لم يظهر إشعار.','Word sent to the browser download flow; use the same-file link below if no notification appears.');
}
function reportExportInputs(){
 const report=readComposer();
 const study=current?{uid:current.uid,patient:current.patient,modality:current.modality,meta:structuredClone(current.meta||{})}:null;
 let org={ar:'مؤسسة صحية',en:'Health Facility'};
 try{org={...org,...JSON.parse(localStorage.getItem('rrai-org')||'{}')};}catch(e){}
 const signer=$('signer')?.value.trim()||'',license=$('signer-license')?.value.trim()||'';
 return {report,study,signer,license,org,key:JSON.stringify({study,report,signer,license,org})};
}
async function downloadReviewedWord(){
 if(reportExportBusy)return;
 const input=reportExportInputs(),{report,study,signer,license,org,key}=input;
 if(!current||!study){reportExportSay('افتح دراسة أولًا.','Open a study first.',true);return;}
 if(!report?.exam||!report?.technique||!report.findings?.length||!report.impression?.length){
  reportExportSay('أكمل اسم الفحص والتقنية والوصف والخلاصة في المحرر قبل تنزيل Word؛ لن تُستبدل بمسودة فرز آلي.','Complete Exam, Technique, Findings and Impression in the composer before downloading Word; no automated triage draft will be substituted.',true);return;
 }
 if(!signer){reportExportSay('اكتب اسم الطبيب قبل التنزيل.','Enter the physician name before downloading.',true);$('signer').focus();return;}
 if(!$('signoff').checked){reportExportSay('راجع الصور ونص التقرير ثم فعّل اعتماد هذه النسخة.','Review the images and report text, then approve this version.',true);$('signoff').focus();return;}
 const issues=reportReview(report);
 if(issues.length){
  showReportReview();
  const message=issues.map(x=>x[LANG==='en'?'en':'ar']).join('\n')+'\n\n'+(LANG==='en'?'Continue after physician review? Cancel to edit.':'المتابعة بعد مراجعة الطبيب؟ اختر إلغاء لتعديل التقرير.');
  if(!window.confirm(message))return;
 }
 if(reportFile?.key===key){reportDownloadExisting();return;}
 const button=$('sign-export-word-en'),record=current;reportExportBusy=true;button.disabled=true;
 let pendingUrl=null;
 try{
  reportExportSay('جارٍ تجهيز ملف Word من نص المحرر…','Preparing Word from the composer text…');
  const at=new Date().toISOString();
  // Bind the content stamp to this actual composer snapshot, not to generic triage prose.
  const hash=await signedDocHash(study,{ar:'',en:JSON.stringify({schema:'rrai-composer-word-en-v1',source:study,report,org})},{signer,license,at});
  const bytes=buildDocxReportEn(study,{ar:'',en:''},{signer,license,org,at,hash},report);
  if(current!==record||reportExportInputs().key!==key||!$('signoff').checked)throw Error(LANG==='en'?'The study or report changed while preparing the file. Review and try again.':'تغيّرت الدراسة أو بيانات التقرير أثناء التجهيز؛ راجع النسخة ثم أعد المحاولة.');
  const stored={...report,findings:reportLinesText(report.findings),impression:reportLinesText(report.impression)};
  record.report=stored;record.signedBy=signer;record.signedAt=at;record.license=license;record.docHash=hash;
  record.signedHistory=record.signedHistory||[];record.signedHistory.push({at,signer,license,hash});
  await putStudy(record);
  if(current!==record||reportExportInputs().key!==key||!$('signoff').checked)throw Error(LANG==='en'?'The study or report changed. Review the current version before downloading.':'تغيّرت الدراسة أو بيانات التقرير؛ راجع النسخة الحالية قبل التنزيل.');
  archiveSave(record,stored,{signer,license,hash,status:'signed',at});renderArchive();
  pendingUrl=URL.createObjectURL(new Blob([bytes],{type:reportWordMime}));
  clearReportFile();reportFile={key,uid:study.uid,url:pendingUrl,name:'rrai-report-EN-'+safeFilePart(study.patient)+'.docx'};pendingUrl=null;
  reportDownloadExisting();refresh({worklistOnly:true});
 }catch(e){
  if(pendingUrl)URL.revokeObjectURL(pendingUrl);
  reportExportSay('تعذّر تجهيز ملف Word: '+(e?.message||e),'Could not prepare Word: '+(e?.message||e),true);
 }finally{reportExportBusy=false;button.disabled=false;}
}
function setupSignExport(){
 const button=$('sign-export-word-en');if(!button||button.__reportExport)return;button.__reportExport=true;
 button.addEventListener('click',downloadReviewedWord);
 $('org-save').addEventListener('click',()=>{
  try{localStorage.setItem('rrai-org',JSON.stringify({ar:$('org-ar').value.trim(),en:$('org-en').value.trim()}));reportExportEdited();reportExportSay('حُفظت الترويسة للتقارير القادمة.','Letterhead saved for subsequent reports.');}
  catch(e){reportExportSay('تعذّر حفظ الترويسة على هذا الجهاز.','Could not save letterhead on this device.',true);}
 });
 try{const org=JSON.parse(localStorage.getItem('rrai-org')||'{}');$('org-ar').value=org.ar||'';$('org-en').value=org.en||'';}catch(e){}
 for(const id of ['rep-exam','rep-indication','rep-technique','rep-findings','rep-impression','rep-notes','signer','signer-license','org-ar','org-en'])$(id)?.addEventListener('input',reportExportEdited);
 $('report-download-again').addEventListener('click',ev=>{if(!reportFile)ev.preventDefault();});
 window.addEventListener('pagehide',clearReportFile);
}

/* ---- v1.0.3 measure suite UI ---- */
function setupMeasureUI() {
  const m = $("measure");
  if (!m || $("measure-mode")) return;
  const sel = document.createElement("select");
  sel.id = "measure-mode";
  sel.className = "ghost";
  sel.style.padding = ".3rem .4rem";
  for (const [v, t] of [["seg", "قطع"], ["angle", "زاوية"], ["roi", "قطع ناقص"], ["rect", "مستطيل"], ["probe", "قيمة البكسل"]]) {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  sel.onchange = () => { mMode = sel.value; mPts = []; drawOverlay(); measureOut(); };
  const clr = document.createElement("button");
  clr.className = "ghost";
  clr.id = "measure-clear";
  clr.textContent = "مسح القياسات";
  clr.onclick = () => { mItems = { segments: [], angles: [], rois: [], rects: [] }; mPts = []; mProbe = null; commitMeasurements(); drawOverlay(); measureOut(); };
  m.parentNode.insertBefore(sel, m.nextSibling);
  m.parentNode.insertBefore(clr, sel.nextSibling);
}

/** Intersection of the source DICOM plane with the target image rectangle.
 * Pixel Spacing is [row, column]; IOP's first vector advances columns. */
export function referenceSegment(source,target){
 const a=source?.geometry,b=target?.geometry,sp=target?.spacing;
 if(!a||!b||!a.frameOfReferenceUid||a.frameOfReferenceUid!==b.frameOfReferenceUid||!sp||sp.length!==2||!sp.every(v=>Number.isFinite(v)&&v>0))return null;
 const dot=(x,y)=>x.reduce((n,v,i)=>n+v*y[i],0);
 const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 for(const g of [a,b]){if(!g.ipp||g.ipp.length!==3||!g.iop||g.iop.length!==6||![...g.ipp,...g.iop].every(Number.isFinite))return null;const u=g.iop.slice(0,3),v=g.iop.slice(3);if(Math.abs(Math.hypot(...u)-1)>.01||Math.abs(Math.hypot(...v)-1)>.01||Math.abs(dot(u,v))>.01)return null;}
 if(!(target.w>1&&target.h>1))return null;
 const n=cross(a.iop.slice(0,3),a.iop.slice(3)),u=b.iop.slice(0,3),v=b.iop.slice(3);
 const A=dot(n,u)*sp[1],B=dot(n,v)*sp[0],C=dot(n,b.ipp.map((x,i)=>x-a.ipp[i]));
 if(Math.hypot(A,B)<1e-6)return null;
 const points=[],w=target.w-1,h=target.h-1;
 const add=(x,y)=>{if(x>=-1e-6&&x<=w+1e-6&&y>=-1e-6&&y<=h+1e-6&&!points.some(p=>Math.hypot(p[0]-x,p[1]-y)<1e-5))points.push([Math.max(0,Math.min(w,x)),Math.max(0,Math.min(h,y))]);};
 if(Math.abs(B)>1e-8){add(0,-C/B);add(w,(-C-A*w)/B);}
 if(Math.abs(A)>1e-8){add(-C/A,0);add((-C-B*h)/A,h);}
 if(points.length<2)return null;
 return [points[0],points[1]];
}
/** Raw-pixel stroke width for a 1.2 CSS-pixel reference line.
 * Uses the visible image rectangle, NEVER the detached compositor's DOM size. */
export function referenceStrokeWidth(w,h,rect,rotation=0){
 if(![w,h,rect?.width,rect?.height,rotation].every(Number.isFinite)||w<=0||h<=0||rect.width<=0||rect.height<=0)return null;
 const turned=((rotation%360)+360)%360,swap=turned===90||turned===270;
 const scale=Math.min(rect.width/(swap?h:w),rect.height/(swap?w:h));
 return scale>0&&Number.isFinite(scale)?1.2/scale:null;
}
export function paintReference(canvas,segment,color,visibleRect=null,rotation=0){
 if(!canvas||!segment)return;
 const width=referenceStrokeWidth(canvas.width,canvas.height,visibleRect||canvas.getBoundingClientRect(),rotation);
 if(width===null)return; // Hidden/unlaid-out images are not a one-pixel viewport.
 const ctx=canvas.getContext("2d");ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=.48;
 ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...segment[0]);ctx.lineTo(...segment[1]);ctx.stroke();ctx.restore();
}
function renderReferences(){
 const overlay=$("reference-overlay");if(!overlay)return;
 const primary=activeFrames()[sliceIdx()];
 overlay.width=primary?.w||1;overlay.height=primary?.h||1;
 const status=$("reference-status");if(status)status.hidden=!dualOn||!current;
 if(!dualOn||!current)return;
 const series=ensureSeries(current)[dualSeries],secondary=current.frames[series?.indices?.[dualIndex]];
 const line=referenceSegment(primary,secondary),reverse=referenceSegment(secondary,primary);
 try{secondaryCanvas(line);}catch(e){setStatus(LANG==="en"?"Secondary pane render failed":"تعذر رسم النافذة الثانية",true);}
 paintReference(overlay,reverse,"#38bdf8",null,orientNow().rotate);
 if(status){
   const code=referenceReason(primary,secondary),back=referenceReason(secondary,primary);
   status.textContent=(GEOMETRY_REASON[code]||GEOMETRY_REASON["no-frame"])[LANG==="en"?1:0]+(back!==code?" · "+(GEOMETRY_REASON[back]||GEOMETRY_REASON["no-frame"])[LANG==="en"?1:0]:"");
 }
}
let dualOn=false,dualActive=1,dualSeries=0,dualIndex=0,dualStudy=null;
function dualRender(){
 const panel=$("dual-secondary"),card=$("viewer-card");if(!panel||!card)return;
 card.classList.toggle("dual-on",dualOn && !!current);panel.hidden=!dualOn||!current;
 const toggle=$("dual-toggle");if(toggle){toggle.setAttribute("aria-pressed",String(dualOn));toggle.textContent=LANG==="en"?(dualOn?"Single pane":"Split view"):(dualOn?"نافذة واحدة":"نافذتان");}
 if(!current||!dualOn){requestAnimationFrame(renderReferences);return;}
 const ss=ensureSeries(current);
 if(dualStudy!==current){dualStudy=current;dualSeries=ss.length>1?1:0;dualIndex=0;resetSecondaryView();}
 dualSeries=Math.min(dualSeries,ss.length-1);
 const series=ss[dualSeries];if(!series)return;
 const frames=series.indices.map(i=>current.frames[i]);dualIndex=Math.max(0,Math.min(frames.length-1,dualIndex));
 if(overviewSync && dualActive===1){const match=spatialMatch(activeFrames()[sliceIdx()],frames);if(match>=0)dualIndex=match;}
 try{secondaryCanvas(null);}catch(e){}
 $("dual-label").textContent=(dualActive===2?"✓ ":"")+"2 · "+(series.label||series.description||("Se "+(dualSeries+1)))+" · "+(dualIndex+1)+"/"+frames.length;
 const slider=$("dual-slice");slider.max=String(Math.max(0,frames.length-1));slider.value=String(dualIndex);
 panel.classList.toggle("active-pane",dualActive===2);
 $("viewport").classList.toggle("active-pane",dualActive===1);
 updatePaneTools();
 requestAnimationFrame(renderReferences);
}
function dualStep(amount){
 if(!dualOn||!current)return;
 const n=(ensureSeries(current)[dualSeries]?.indices||[]).length;dualIndex=Math.max(0,Math.min(n-1,dualIndex+amount));secondaryPoints=[];secondaryProbe=null;paneSelect(2);dualRender();
 if(overviewSync){const f=current.frames[ensureSeries(current)[dualSeries].indices[dualIndex]],match=spatialMatch(f,activeFrames());if(match>=0){const sl=$("slice");if(sl)sl.value=String(match);show(match);}}
}
function dualWire(){
 const b=$("dual-toggle"),p=$("dual-secondary"),vp=$("viewport");if(!b||b.__dual)return;b.__dual=1;
 b.onclick=()=>{const want=!dualOn;if(mprOn)mprToggle(false);if(allOn)allToggle(false);if(!want)paneSelect(1);dualOn=want;dualActive=1;dualRender();if(current)resetView(true);};
 $("dual-label").onclick=()=>{paneSelect(2);dualRender();};
 vp.addEventListener("pointerdown",()=>{if(dualOn){paneSelect(1);dualRender();}});
 p.addEventListener("pointerdown",()=>{paneSelect(2);});
 $("dual-slice").oninput=()=>{const wanted=Number($("dual-slice").value);dualStep(wanted-dualIndex);};
 const cv=$("dual-frame");cv.addEventListener("wheel",e=>{e.preventDefault();dualStep(e.deltaY>0?1:-1);},{passive:false});

}
function setupV130(){
 setupReportReview();
 setupGeometryDiagnostics();
 const previews=$("series-preview-fold");
 if(previews&&!previews.__wired){
  previews.__wired=true;
  try{previews.open=localStorage.getItem("rrai-series-preview-open")==="1";}catch(e){}
  previews.addEventListener("toggle",()=>{try{localStorage.setItem("rrai-series-preview-open",previews.open?"1":"0");}catch(e){}});
 }

 dualWire();
 setupPaneTools();
 const syncHost=$("spatial-sync-options");
 if(syncHost&&!$("spatial-sync-toggle")){
  const label=document.createElement("label"), cb=document.createElement("input");
  cb.id="spatial-sync-toggle";cb.type="checkbox";cb.checked=false;
  const text=document.createElement("span");text.id="spatial-sync-label";text.textContent=I18N["spatial-sync-label"][LANG==="en"?1:0];label.append(cb,text);syncHost.append(label);
  cb.onchange=()=>{overviewSync=cb.checked;if(current)renderSeriesOverview(sliceIdx());};
 }
 const row=$("measure-bar");if(row&&!$("export-png")){
  const b=document.createElement("button");b.id="export-png";b.className="ghost";b.textContent="PNG — الصورة الأصلية / المستويات";
  b.onclick=()=>{const sources=mprOn?MPR_PLANES.map(p=>$("mpr-c-"+p)):[$("frame")];const out=document.createElement("canvas");out.width=Math.max(...sources.map(c=>c.width));out.height=sources.reduce((n,c)=>n+c.height,0);const ctx=out.getContext("2d");ctx.fillStyle="#000";ctx.fillRect(0,0,out.width,out.height);let y=0;sources.forEach(c=>{ctx.drawImage(c,0,y);y+=c.height;});out.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="viewer.png";a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);});};row.append(b);
 }
 let zoom=1,x=0,y=0,drag=null,linked=true;const panes=MPR_PLANES.map(p=>$("mpr-c-"+p));
 const apply=target=>panes.forEach(c=>{if(c&&(linked||c===target))c.style.transform=`translate(${x}px,${y}px) scale(${zoom})`;});
 if(row&&!$("mpr-link-view")){const b=document.createElement("button");b.id="mpr-link-view";b.className="ghost";b.setAttribute("aria-pressed",String(linked));b.onclick=()=>{linked=!linked;b.setAttribute("aria-pressed",String(linked));viewerStateLabels();};row.append(b);}
 panes.forEach(c=>{if(!c)return;c.parentElement.style.overflow="hidden";c.addEventListener("wheel",e=>{if(!e.ctrlKey)return;e.preventDefault();zoom=Math.max(.5,Math.min(8,zoom*Math.exp(-e.deltaY*.002)));apply(c);},{passive:false});c.addEventListener("contextmenu",e=>e.preventDefault());c.addEventListener("pointerdown",e=>{if(e.button!==2)return;drag={px:e.clientX,py:e.clientY,x,y};c.setPointerCapture(e.pointerId);});c.addEventListener("pointermove",e=>{if(!drag)return;x=drag.x+e.clientX-drag.px;y=drag.y+e.clientY-drag.py;apply(c);});c.addEventListener("pointerup",()=>drag=null);c.addEventListener("dblclick",()=>{zoom=1;x=y=0;apply(c);});});
}

/** Conservative text checks, not an assessment of the images or clinical truth. */
export function reportReview(report){
 if(!report)return [];
 const flat=x=>(Array.isArray(x)?x.join("\n"):String(x||"")).toLowerCase().replace(/[‐‑–—]/g,"-").replace(/\*+/g,"");
 const e=flat(report.exam),t=flat(report.technique),f=flat(report.findings),im=flat(report.impression);
 const no=x=>/\b(?:without|no)\s+(?:(?:iv|intravenous)\s+)?contrast\b|\bnon[- ]?contrast\b|بدون\s+(?:صبغة|تباين)/.test(x)&&!/\bwith\s+(?:and|&|\/)\s+without/.test(x)&&!/\bwithout\s+and\s+with/.test(x);
 const yes=x=>/\bwith\s+(?:and|&|\/)\s+without[^.]{0,30}contrast|\bwith\s+(?:(?:iv|intravenous)\s+)?contrast\b|\bpost[- ]contrast\b|بعد\s+(?:حقن|الصبغة|التباين)/.test(x);
 const out=[];
 if((no(t)&&(yes(e)||yes(f)||yes(im)))||(no(e)&&(yes(t)||yes(f)||yes(im))))out.push({code:"contrast-conflict",ar:"تعارض محتمل: الفحص أو التقنية يذكر دون صبغة، بينما قسم آخر يذكر الصبغة/ما بعد الحقن. راجع ما أُجري فعليًا.",en:"Possible contrast inconsistency: noncontrast exam/technique versus contrast or post-contrast wording elsewhere. Verify the actual acquisition."});
 if((f||im)&&!t)out.push({code:"missing-technique",ar:"التقنية غير مكتملة؛ تحقّق من طريقة الفحص والصبغة قبل التصدير.",en:"Technique is empty; verify acquisition and contrast before export."});
 if(f&&!im)out.push({code:"missing-impression",ar:"الوصف موجود والخلاصة فارغة.",en:"Findings are present but Impression is empty."});
 if((f||im)&&!e)out.push({code:"missing-exam",ar:"اسم الفحص فارغ.",en:"Exam is empty."});
 return out;
}
function reviewCurrent(){
 const report=readComposer();
 if(report&&!report.technique)report.technique=current?.report?.technique||"";
 return reportReview(report);
}
function showReportReview(){
 const box=$("report-review-output");if(!box)return;
 const results=reviewCurrent();box.replaceChildren();
 const p=document.createElement("p");p.textContent=LANG==="en"?"Text consistency checks only; not clinical validation.":"فحص اتساق نصّي فقط؛ ليس تحققًا من صحة التشخيص.";box.append(p);
 if(!results.length){const p=document.createElement("p");p.textContent=LANG==="en"?"No issues detected by these limited rules.":"لم تكشف القواعد المحدودة تعارضًا؛ تبقى المراجعة الطبية لازمة.";box.append(p);}
 results.forEach(r=>{const p=document.createElement("p");p.textContent="⚠ "+r[LANG==="en"?"en":"ar"];box.append(p);});
 box.hidden=false;return results;
}
function setupReportReview(){
 const b=$("report-review");if(!b||b.__review)return;b.__review=1;b.onclick=showReportReview;
 // Capture delegated export clicks before existing handlers, including dynamically
 // inserted English export. Recheck every action; no persistent bypass consent.
 document.addEventListener("click",ev=>{
   const target=ev.target.closest?.("button");if(!target)return;
   if(!["gen-report","sign-export","sign-export-word","print-a4"].includes(target.id))return;
   const issues=reviewCurrent();if(!issues.length)return;
   showReportReview();
   const msg=issues.map(x=>x[LANG==="en"?"en":"ar"]).join("\n")+"\n\n"+(LANG==="en"?"Continue after physician review? Cancel to edit.":"المتابعة بعد مراجعة الطبيب؟ اختر إلغاء لتعديل التقرير.");
   if(!window.confirm(msg)){ev.preventDefault();ev.stopImmediatePropagation();$("composer-set").open=true;}
 },true);
}

export function referenceReason(source,target){
 if(!source||!target)return "no-frame";
 const a=source.geometry,b=target.geometry;
 if(!a?.frameOfReferenceUid||!b?.frameOfReferenceUid)return "missing-reference";
 if(a.frameOfReferenceUid!==b.frameOfReferenceUid)return "different-reference";
 for(const g of [a,b]){
  if(!Array.isArray(g.ipp)||g.ipp.length!==3||!g.ipp.every(Number.isFinite))return "invalid-position";
  if(!Array.isArray(g.iop)||g.iop.length!==6||!g.iop.every(Number.isFinite))return "invalid-orientation";
  const u=g.iop.slice(0,3),v=g.iop.slice(3);
  if(Math.abs(Math.hypot(...u)-1)>.01||Math.abs(Math.hypot(...v)-1)>.01||Math.abs(u.reduce((n,x,i)=>n+x*v[i],0))>.01)return "invalid-orientation";
 }
 if(!Array.isArray(target.spacing)||target.spacing.length!==2||!target.spacing.every(x=>Number.isFinite(x)&&x>0))return "missing-spacing";
 if(!(target.w>1&&target.h>1))return "invalid-size";
 if(referenceSegment(source,target))return "visible";
 const cross=g=>{const u=g.iop;return [u[1]*u[5]-u[2]*u[4],u[2]*u[3]-u[0]*u[5],u[0]*u[4]-u[1]*u[3]];};
 const n=cross(a),m=cross(b);
 return Math.abs(n.reduce((v,x,i)=>v+x*m[i],0))>.999999?"parallel-planes":"outside-image";
}
const GEOMETRY_REASON={
 "no-frame":["افتح صورتين أولًا","Open two images first"],
 "missing-reference":["معرّف المرجع المكاني غير محفوظ في إحدى الصورتين؛ قد تحتاج إعادة استيراد الملفات الأصلية","Frame of Reference missing in one image; original files may need reimport"],
 "different-reference":["الصورتان تحملان مرجعين مكانيين مختلفين؛ لا يجوز افتراض تطابقهما","Images have different Frames of Reference; registration cannot be assumed"],
 "invalid-position":["موضع الصورة IPP مفقود أو غير صالح","IPP is missing or invalid"],
 "invalid-orientation":["اتجاه الصورة IOP مفقود أو غير صالح","IOP is missing or invalid"],
 "missing-spacing":["تباعد البكسلات للصورة الهدف مفقود أو غير صالح","Target Pixel Spacing is missing or invalid"],
 "invalid-size":["أبعاد الصورة غير صالحة","Invalid image dimensions"],
 "parallel-planes":["المستويان متوازيان؛ لا يوجد خط تقاطع فريد","Parallel planes have no unique intersection line"],
 "outside-image":["تقاطع المستويين خارج حدود الصورة المعروضة","Plane intersection lies outside the image rectangle"],
 "visible":["خط المستوى محسوب ومتاح","Reference segment computed"]
};
export function privateGeometryReport(a,b){
 const numbers=(x,n)=>Array.isArray(x)&&x.length===n?x.map(v=>Number.isFinite(v)?v:null):null;
 const pack=f=>({width:Number.isFinite(f?.w)?f.w:null,height:Number.isFinite(f?.h)?f.h:null,
  position:numbers(f?.geometry?.ipp,3),orientation:numbers(f?.geometry?.iop,6),pixelSpacing:numbers(f?.spacing,2),
  hasFrameOfReference:!!f?.geometry?.frameOfReferenceUid});
 return {schema:"rrai-geometry-diagnostic-1",primary:pack(a),secondary:pack(b),
  matchingReference:!!a?.geometry?.frameOfReferenceUid&&a.geometry.frameOfReferenceUid===b?.geometry?.frameOfReferenceUid,
  primaryOnSecondary:referenceReason(a,b),secondaryOnPrimary:referenceReason(b,a)};
}
function geometryFrames(){
 return [current?activeFrames()[sliceIdx()]:null,current?.frames?.[ensureSeries(current)?.[dualSeries]?.indices?.[dualIndex]]];
}
function setupGeometryDiagnostics(){
 const b=$("geometry-export");if(!b||b.__geo)return;b.__geo=1;
 b.onclick=()=>{
  if(!current||!dualOn){setStatus(LANG==="en"?"Open split mode first.":"افتح وضع النافذتين أولًا.",true);return;}
  const [a,c]=geometryFrames(),report=privateGeometryReport(a,c);
  const box=$("geometry-diagnostic-output");box.textContent=JSON.stringify(report,null,2);box.hidden=false;
  const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="geometry-diagnostic.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
}
/* v147: selection routes controls, never swaps the underlying study state. */
let secondaryView={rotate:0,flipH:false,flipV:false,invert:false,zoom:1,x:0,y:0,preset:'auto',measure:false};
let secondaryPoints=[],secondaryProbe=null,primaryPreset='auto',primaryMeasureContext=null,primaryMeasureKey='',secondaryMeasureContext=null,secondaryMeasureKey='';
const emptyMeasures=()=>({segments:[],angles:[],rois:[],rects:[]});
function secondFrame(){return current?.frames?.[ensureSeries(current)?.[dualSeries]?.indices?.[dualIndex]]||null;}
export function paneMeasurementKey(pane,frameIndex){return String(pane)+':'+String(frameIndex);}
function measurementKey(pane,index){
 const si=pane===2?dualSeries:currentSeries,ix=index===undefined?(pane===2?dualIndex:sliceIdx()):index;
 const globalIndex=ensureSeries(current)?.[si]?.indices?.[ix];
 return globalIndex==null?null:paneMeasurementKey(pane,globalIndex);
}
function frameMeasures(pane,index){
 const key=measurementKey(pane,index);if(!key||!current)return emptyMeasures();
 current.measurementFrames=current.measurementFrames||{};
 return current.measurementFrames[key]||(current.measurementFrames[key]=emptyMeasures());
}
function loadPrimaryMeasures(index){
 if(primaryMeasureContext!==current){
   if(dualActive===2){dualActive=1;const ps=$("preset");if(ps)ps.value=primaryPreset;}
   resetSecondaryView();
 }
 const key=measurementKey(1,index);
 if(primaryMeasureContext!==current||key!==primaryMeasureKey){mPts=[];mProbe=null;}
 primaryMeasureContext=current;primaryMeasureKey=key;mItems=frameMeasures(1,index);
}
function saveSecondMeasures(){try{putStudy(current).catch(()=>{});}catch(e){}}
function resetSecondaryView(){secondaryView={rotate:0,flipH:false,flipV:false,invert:false,zoom:1,x:0,y:0,preset:'auto',measure:false};secondaryPoints=[];secondaryProbe=null;}
function paneSelect(n){
 if(!dualOn)n=1;
 if(n!==dualActive){
  if(n===2)primaryPreset=val('preset','auto');
  dualActive=n;secondaryPoints=[];mPts=[];
  const ps=$('preset');if(ps)ps.value=n===2?secondaryView.preset:primaryPreset;
 }
 updatePaneTools();
}
function updatePaneTools(){
 const second=dualOn&&dualActive===2;
 const badge=$('active-pane-status');if(badge){badge.textContent=(LANG==='en'?'Tools target pane ':'الأدوات للنافذة ')+(second?'2':'1');badge.hidden=!dualOn;}
 for(const n of [1,2]){const b=$('select-pane-'+n);if(b){b.hidden=!dualOn;b.setAttribute('aria-pressed',String(dualActive===n));b.textContent=(dualActive===n?'✓ ':'')+(LANG==='en'?'Pane ':'نافذة ')+n;}}
 $('viewport')?.classList.toggle('active-pane',!second);
 $('dual-secondary')?.classList.toggle('active-pane',second);
 orientLabels();
 const b=$('measure'),on=second?secondaryView.measure:measureMode;
 if(b){b.setAttribute('aria-pressed',String(on));b.style.color=on?'var(--accent)':'';b.style.borderColor=on?'var(--accent)':'';}
 const zs=$('zscale');if(zs)zs.textContent='×'+(second?secondaryView.zoom:vk).toFixed(2);
 const label=$('dual-label');if(label){label.textContent=label.textContent.replace(/^✓ /,'');if(second)label.textContent='✓ '+label.textContent;}
 measureOut();
}
/** Inverse object-fit:content + quarter-turn transform. Rect includes CSS zoom/pan. */
export function secondaryImagePoint(clientX,clientY,rect,frame,o){
 const rot=((Number(o?.rotate)||0)%360+360)%360,sw=rot===90||rot===270;
 const w=frame.w,h=frame.h,dw=sw?h:w,dh=sw?w:h;
 const scale=Math.min(rect.width/dw,rect.height/dh);if(!(scale>0))return null;
 let u=(clientX-rect.left-(rect.width-dw*scale)/2)/scale;
 let v=(clientY-rect.top-(rect.height-dh*scale)/2)/scale;
 if(u<0||v<0||u>dw||v>dh)return null;
 if(o?.flipH)u=dw-u;if(o?.flipV)v=dh-v;
 let p=rot===90?[v,h-u]:rot===180?[w-u,h-v]:rot===270?[w-v,u]:[u,v];
 return [Math.max(0,Math.min(w-1,p[0])),Math.max(0,Math.min(h-1,p[1]))];
}
function secondaryReadout(){
 const out=$('measure-out');if(!out)return;
 if(!secondaryView.measure){out.textContent='';return;}
 const m=frameMeasures(2),n=m.segments.length+m.angles.length+m.rois.length+m.rects.length;
 out.textContent=(LANG==='en'?'Pane 2 · saved on this image: ':'نافذة 2 · محفوظ على هذه الصورة: ')+n;
 if(secondaryProbe)out.textContent+=' · ('+secondaryProbe.p.map(Math.round).join(', ')+') = '+Number(secondaryProbe.v.toFixed(2))+' '+secondaryProbe.unit;
}
function paintSecondaryMeasures(canvas){
 const ctx=canvas.getContext('2d'),m=frameMeasures(2);ctx.save();ctx.strokeStyle=measureColor();ctx.fillStyle=measureColor();ctx.lineWidth=1.5;ctx.font='12px sans-serif';
 const line=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();};
 const label=(text,p)=>{ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeText(text,p[0]+5,p[1]-5);ctx.fillText(text,p[0]+5,p[1]-5);ctx.strokeStyle=measureColor();ctx.lineWidth=1.5;};
 m.segments.forEach(s=>{line([s.a,s.b]);label(s.mm!=null?s.mm.toFixed(1)+' mm':s.px.toFixed(1)+' px',s.a);});
 m.angles.forEach(a=>{line([a.p1,a.v,a.p2]);label(a.deg.toFixed(1)+'°',a.v);});
 m.rects.forEach(r=>{ctx.strokeRect(r.a[0],r.a[1],r.b[0]-r.a[0],r.b[1]-r.a[1]);label('μ'+r.mean.toFixed(1)+' σ'+r.std.toFixed(1)+' '+r.unit,r.a);});
 m.rois.forEach(r=>{ctx.beginPath();ctx.ellipse(...r.c,r.rx,r.ry,0,0,Math.PI*2);ctx.stroke();label('μ'+r.mean.toFixed(1)+' '+r.unit,r.c);});
 secondaryPoints.forEach(p=>{ctx.beginPath();ctx.arc(...p,3,0,Math.PI*2);ctx.fill();});
 if(secondaryProbe){const [x,y]=secondaryProbe.p;line([[x-6,y],[x+6,y]]);line([[x,y-6],[x,y+6]]);label(String(Number(secondaryProbe.v.toFixed(2)))+' '+secondaryProbe.unit,[x,y]);}
 ctx.restore();
}
function secondaryMeasureAt(e){
 const frame=secondFrame(),cv=$('dual-frame');if(!frame||!cv)return;
 const p=secondaryImagePoint(e.clientX,e.clientY,cv.getBoundingClientRect(),frame,secondaryView);if(!p)return;
 secondaryPoints.push(p);const need=mMode==='angle'?3:mMode==='probe'?1:2;
 if(secondaryPoints.length>=need){
  const pts=secondaryPoints,m=frameMeasures(2),spacing=validMeasurementSpacing(frame);
  if(mMode==='seg')m.segments.push({a:pts[0],b:pts[1],px:Math.hypot(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1]),mm:segMm(pts[0],pts[1],spacing)});
  else if(mMode==='angle'){const physical=spacing?pts.map(p=>[p[0]*spacing[1],p[1]*spacing[0]]):pts;m.angles.push({p1:pts[0],v:pts[1],p2:pts[2],deg:angleDeg(...physical),calibrated:!!spacing});}
  else if(mMode==='rect'){const st=rectStats(frame,pts[0],pts[1]);if(st)m.rects.push({a:pts[0],b:pts[1],...st});}
  else if(mMode==='roi'){const rx=Math.max(2,Math.abs(pts[1][0]-pts[0][0])),ry=Math.max(2,Math.abs(pts[1][1]-pts[0][1])),st=ellipseStats(frame,pts[0],rx,ry);if(st)m.rois.push({c:pts[0],rx,ry,...st});}
  else {const x=Math.round(p[0]),y=Math.round(p[1]);secondaryProbe={p:[x,y],v:grayAt(frame,x,y),unit:frame.hu?'HU':'gray'};}
  secondaryPoints=[];saveSecondMeasures();
 }
 requestAnimationFrame(renderReferences);secondaryReadout();
}
function secondaryCanvas(line){
 const f=secondFrame(),cv=$('dual-frame');if(!f||!cv)return;
 const key=measurementKey(2);if(secondaryMeasureContext!==current||secondaryMeasureKey!==key){secondaryPoints=[];secondaryProbe=null;secondaryMeasureContext=current;secondaryMeasureKey=key;}
 const raw=document.createElement('canvas');drawFrame(raw,f,secondaryView.preset,current.modality);
 const rot=secondaryView.rotate,sw=rot===90||rot===270;
 cv.width=sw?f.h:f.w;cv.height=sw?f.w:f.h;
 cv.style.transform=`translate(${secondaryView.x}px,${secondaryView.y}px) scale(${secondaryView.zoom})`;
 const over=document.createElement('canvas');over.width=f.w;over.height=f.h;
 paintReference(over,line,'#fbbf24',cv.getBoundingClientRect(),rot);paintSecondaryMeasures(over);
 const ctx=cv.getContext('2d');ctx.translate(cv.width/2,cv.height/2);ctx.scale(secondaryView.flipH?-1:1,secondaryView.flipV?-1:1);ctx.rotate(rot*Math.PI/180);
 ctx.filter=secondaryView.invert?'invert(1)':'none';ctx.drawImage(raw,-f.w/2,-f.h/2);ctx.filter='none';ctx.drawImage(over,-f.w/2,-f.h/2);
 cv.style.transform=`translate(${secondaryView.x}px,${secondaryView.y}px) scale(${secondaryView.zoom})`;
}
function secondaryFit(){secondaryView.zoom=1;secondaryView.x=0;secondaryView.y=0;requestAnimationFrame(renderReferences);updatePaneTools();}
function setupPaneTools(){
 const b=$('select-pane-1');if(!b||b.__pane)return;b.__pane=1;
 b.onclick=()=>paneSelect(1);$('select-pane-2').onclick=()=>paneSelect(2);
 document.addEventListener('click',ev=>{
  const id=ev.target.closest?.('button')?.id;if(!dualOn||dualActive!==2)return;
  const controls=['orient-invert','orient-rotate','orient-fliph','orient-flipv','orient-reset','zoom-reset','measure','measure-clear'];
  if(!controls.includes(id))return;ev.preventDefault();ev.stopImmediatePropagation();
  if(id==='zoom-reset'){secondaryFit();return;}
  if(id==='measure')secondaryView.measure=!secondaryView.measure;
  else if(id==='measure-clear'){const key=measurementKey(2);if(key&&current?.measurementFrames)current.measurementFrames[key]=emptyMeasures();secondaryPoints=[];secondaryProbe=null;saveSecondMeasures();}
  else {
   if(id==='orient-invert')secondaryView.invert=!secondaryView.invert;
   if(id==='orient-rotate')secondaryView.rotate=(secondaryView.rotate+90)%360;
   if(id==='orient-fliph')secondaryView.flipH=!secondaryView.flipH;
   if(id==='orient-flipv')secondaryView.flipV=!secondaryView.flipV;
   if(id==='orient-reset')Object.assign(secondaryView,{rotate:0,flipH:false,flipV:false,invert:false});
   secondaryFit();
  }
  secondaryPoints=[];requestAnimationFrame(renderReferences);updatePaneTools();
 },true);
 document.addEventListener('change',ev=>{
  if(!dualOn||dualActive!==2)return;
  if(ev.target.id==='preset'){ev.stopImmediatePropagation();secondaryView.preset=ev.target.value;requestAnimationFrame(renderReferences);}
  if(ev.target.id==='measure-mode'){ev.stopImmediatePropagation();mMode=ev.target.value;secondaryPoints=[];requestAnimationFrame(renderReferences);secondaryReadout();}
 },true);
 const cv=$('dual-frame'),points=new Map();let down=null,gesture=null,moved=false;
 cv.addEventListener('wheel',ev=>{if(!ev.ctrlKey)return;ev.preventDefault();ev.stopImmediatePropagation();paneSelect(2);secondaryView.zoom=Math.max(.5,Math.min(8,secondaryView.zoom*Math.exp(-ev.deltaY*.002)));requestAnimationFrame(renderReferences);updatePaneTools();},{capture:true,passive:false});
 cv.addEventListener('pointerdown',ev=>{
  paneSelect(2);points.set(ev.pointerId,[ev.clientX,ev.clientY]);cv.setPointerCapture(ev.pointerId);moved=false;
  down={x:ev.clientX,y:ev.clientY,index:dualIndex,panX:secondaryView.x,panY:secondaryView.y};
  if(points.size===2){const [a,b]=[...points.values()];gesture={distance:Math.hypot(a[0]-b[0],a[1]-b[1]),zoom:secondaryView.zoom,cx:(a[0]+b[0])/2,cy:(a[1]+b[1])/2,x:secondaryView.x,y:secondaryView.y};moved=true;}
 });
 cv.addEventListener('pointermove',ev=>{
  if(!points.has(ev.pointerId)||!down)return;points.set(ev.pointerId,[ev.clientX,ev.clientY]);
  if(points.size===2&&gesture){const [a,b]=[...points.values()];secondaryView.zoom=Math.max(.5,Math.min(8,gesture.zoom*Math.hypot(a[0]-b[0],a[1]-b[1])/Math.max(1,gesture.distance)));secondaryView.x=gesture.x+(a[0]+b[0])/2-gesture.cx;secondaryView.y=gesture.y+(a[1]+b[1])/2-gesture.cy;moved=true;requestAnimationFrame(renderReferences);return;}
  if(Math.hypot(ev.clientX-down.x,ev.clientY-down.y)>5)moved=true;
  if(!moved||secondaryView.measure)return;
  if(gesture)return;
  if(secondaryView.zoom>1.01){secondaryView.x=down.panX+ev.clientX-down.x;secondaryView.y=down.panY+ev.clientY-down.y;requestAnimationFrame(renderReferences);}
  else {const wanted=down.index+Math.trunc((down.y-ev.clientY)/18);if(wanted!==dualIndex)dualStep(wanted-dualIndex);}
 });
 cv.addEventListener('pointerup',ev=>{if(!points.has(ev.pointerId))return;points.delete(ev.pointerId);if(!moved&&!points.size&&secondaryView.measure)secondaryMeasureAt(ev);if(!points.size){down=null;gesture=null;}});
 cv.addEventListener('pointercancel',()=>{points.clear();down=null;gesture=null;moved=true;secondaryPoints=[];});
 cv.addEventListener('dblclick',()=>secondaryFit());
}

function validMeasurementSpacing(f){return Array.isArray(f?.spacing)&&f.spacing.length===2&&f.spacing.every(x=>Number.isFinite(x)&&x>0)?f.spacing:null;}

function persistAiKey(){
 const remember=$("ai-key-remember");if(!remember)return;
 try{if(remember.checked){localStorage.setItem("rrai-ai-key-remember","1");localStorage.setItem("rrai-ai-key",$("ai-key").value.trim());}else{localStorage.removeItem("rrai-ai-key");localStorage.removeItem("rrai-ai-key-remember");}}
 catch(e){remember.checked=false;setStatus("تعذر حفظ المفتاح / Key storage unavailable",true);}
}
function relay(target){
 const u=new URL(target);
 const host=u.hostname,local=host==="localhost"||host==="[::1]"||/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
 return local?u.href:location.origin+"/api/dicomweb?url="+encodeURIComponent(u.href);
}
async function pacsFetch(url,options={}){
 const u=new URL(url,location.origin);
 if(u.origin===location.origin&&u.pathname==="/api/dicomweb"){
   const token=$("pacs-relay-token")?.value.trim();
   if(!token)throw new Error(LANG==="en"?"Relay access token required; use a configured institutional relay or import local files.":"يلزم رمز وسيط المؤسسة؛ اضبط خدمة المؤسسة أو افتح ملفات محلية.");
   const h=new Headers(options.headers||{});h.set("Authorization","Bearer "+token);
   return fetch(u.href,{...options,headers:h});
 }
 return fetch(u.href,options);
}
export function aiServerContext(study){return {modality:study.modality||"",studyDesc:study.meta?.studyDesc||"",bodyPart:study.meta?.bodyPart||"",slices:study.frames?.length||0};}

if(typeof window!=="undefined")for(const event of ["online","offline"])window.addEventListener(event,()=>{fillAbout();updDrawer();});


/* Optional CT volume viewer. No network, archives or source-pixel writes. */
let vrRenderer=null,vrToken=0;
function vrCleanup(){vrToken++;if(vrRenderer){vrRenderer.dispose();vrRenderer=null;}const c=$('vr-canvas');if(c){c.width=8;c.height=8;}}
function vrClose(){vrCleanup();const d=$('vr-dialog');if(d?.open)d.close();}
function vrRefresh(){const b=$('vr-open');if(b)b.hidden=String(current?.modality||'').toUpperCase()!=='CT';}
function vrReason(code){
 const errors={
  'ct-only':['CT only.','هذه الخاصية لحالات CT فقط.'],slices:['At least four slices from one CT series are required.','يلزم أربع شرائح على الأقل من سلسلة CT واحدة.'],
  hu:['Verified HU pixels are unavailable. Older imports without unit metadata and compressed/enhanced or repaired frames are not supported in this first release. Do not delete the saved study.','قيم HU الموثقة غير متاحة. الدراسات القديمة بلا توثيق للوحدات والإطارات المضغوطة أو متعددة الإطارات أو المُصلحة غير مدعومة في الإصدار الأول. لا تحذف الدراسة المحفوظة.'],
  geometry:['Missing or incompatible DICOM position/orientation.','بيانات موضع/اتجاه DICOM ناقصة أو غير متوافقة.'],spacing:['Missing or inconsistent pixel spacing.','تباعد البكسلات ناقص أو غير متسق.'],
  pixels:['The series contains unsupported or invalid pixels/matrices.','تحتوي السلسلة بكسلات أو أبعادًا غير مدعومة.'],mixed:['Mixed series or coordinate systems cannot form one volume.','لا يمكن خلط سلاسل أو أنظمة إحداثيات في مجسم واحد.'],duplicates:['Repeated slice positions; select a single CT acquisition.','مواضع شرائح مكررة؛ اختر اقتناء CT واحدًا.'],irregular:['Irregular spacing/missing slice positions; volume refused.','التباعد غير منتظم أو توجد مواضع ناقصة؛ تعذر بناء المجسم.'],tilt:['In-plane slice shifts / gantry tilt are not supported.','إزاحة الشرائح داخل المستوى / ميل الحامل غير مدعوم.'],flat:['The volume has no intensity range.','لا يوجد تباين كثافة في الحجم.'],webgl:['WebGL 2 is unavailable or its context is lost. The original viewer is unchanged.','WebGL 2 غير متاح أو فُقد سياقه. العارض الأصلي لم يتغير.']
 };return (errors[code]||['3D could not be prepared on this device. The original viewer is unchanged.','تعذر تجهيز 3D على هذا الجهاز. العارض الأصلي لم يتغير.'])[LANG==='en'?0:1];
}
async function vrOpen(){
 if(String(current?.modality||'').toUpperCase()!=='CT')return;
 vrClose();const d=$('vr-dialog');if(!d||!mprApi?.prepareRenderVolume)return;
 const token=++vrToken,study=current;
 const ss=ensureSeries(study),si=dualOn&&dualActive===2?dualSeries:currentSeries;
 const series=ss[si],frames=series?.indices?.map(i=>study.frames[i]).filter(Boolean)||[];
 $('vr-source').textContent=(LANG==='en'?'CT series: ':'سلسلة CT: ')+(seriesRows(study)[si]?seriesRowText(seriesRows(study)[si],LANG==='en',false):String(si+1));
 $('vr-status').textContent=LANG==='en'?'Preparing locally…':'جارٍ التجهيز محليًا…';$('vr-info').textContent='';$('vr-controls').hidden=true;
 d.showModal();await new Promise(r=>setTimeout(r,35));if(token!==vrToken||current!==study||!d.open)return;
 try{
  const v=mprApi.prepareRenderVolume(frames,{modality:study.modality});if(!v.ok)throw new Error(v.reason);
  if(token!==vrToken||current!==study||!d.open)return;
  const c=$('vr-canvas');const size=Math.min(448,Math.max(192,Math.floor(d.clientWidth-40)));c.width=c.height=size;
  vrRenderer=mprApi.createVolumeRenderer(c,v,()=>{$('vr-status').textContent=vrReason('webgl');$('vr-controls').hidden=true;});
  $('vr-controls').hidden=false;vrReset();
  $('vr-info').textContent=`${v.sourceSlices} → ${v.nx} × ${v.ny} × ${v.nz} · ${v.extent.map(x=>x.toFixed(1)).join(' × ')} mm`+(v.downsample?(LANG==='en'?' · reduced preview resolution':' · دقة معاينة مخفضة'):'');
  $('vr-status').textContent=(LANG==='en'?'Local CT volume, acquisition axes (not an anatomical orientation guide). Drag to rotate; pinch or wheel to zoom. Not segmentation or a diagnostic replacement.':'مجسم CT محلي بمحاور الاقتناء (ليس مرجعًا للاتجاه التشريحي). اسحب للتدوير وقَرّب بإصبعين. ليس فصلًا تشريحيًا ولا بديلًا للتشخيص.')+((v.anisotropy>3||v.gaps)?(LANG==='en'?' WARNING: thick/anisotropic or gapped slices may produce stair-step/interpolated structures.':' تنبيه: الشرائح السميكة أو المتباعدة قد تنتج تدرجات وبنى مستوفاة غير حقيقية.'):'');
 }catch(e){if(token===vrToken){$('vr-status').textContent=vrReason(e.message);$('vr-controls').hidden=true;}}
}
function vrReset(){if(!vrRenderer)return;vrRenderer.reset();$('vr-threshold').value='200';$('vr-opacity').value='1';$('vr-cut').value='0';$('vr-preset').value='bone';$('vr-hu').textContent='200 HU';}
function vrWire(){
 const b=$('vr-open');if(!b||b.__vr)return;b.__vr=true;b.onclick=vrOpen;
 $('vr-close').onclick=vrClose;$('vr-reset').onclick=vrReset;
 $('vr-dialog').addEventListener('cancel',()=>vrCleanup());$('vr-dialog').addEventListener('close',()=>{if(!$('vr-dialog').open)vrCleanup();});
 $('vr-threshold').oninput=()=>{vrRenderer?.update({threshold:Number($('vr-threshold').value)});$('vr-hu').textContent=$('vr-threshold').value+' HU';$('vr-preset').value='custom';};
 $('vr-opacity').oninput=()=>vrRenderer?.update({opacity:Number($('vr-opacity').value)});
 $('vr-cut').oninput=()=>vrRenderer?.update({cut:Number($('vr-cut').value)/100});
 $('vr-preset').onchange=()=>{const map={bone:200,soft:-100};if(map[$('vr-preset').value]===undefined)return;const t=map[$('vr-preset').value];$('vr-threshold').value=String(t);$('vr-hu').textContent=t+' HU';vrRenderer?.update({threshold:t});};
 window.addEventListener('pagehide',vrClose);vrRefresh();
}
