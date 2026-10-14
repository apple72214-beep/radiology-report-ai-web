/* Radiology report AI — browser-only worklist, triage and viewer. */
/* v34: dynamic module loading with per-module retry — flaky-network proof. */
let parseDicom, parseMultipartRelated, draftReport, buildSignedDocument, signedDocHash, decodeCompressed, triageCtx;
let buildPackage, validatePackage, downloadJson, buildDocxReport, buildDocxReportEn;
let segMm, angleDeg, ellipseStats, cmpFrameStats, normalize01, diffStats, frameGrayFlat;
const MODULES = [
  ["dicom", "./dicom.v59.js", (m) => { parseDicom = m.parseDicom; parseMultipartRelated = m.parseMultipartRelated; }],
  ["report", "./report.v59.js", (m) => { draftReport = m.draftReport; buildSignedDocument = m.buildSignedDocument; signedDocHash = m.signedDocHash; }],
  ["decode", "./codecs/decode.v59.js", (m) => { decodeCompressed = m.decodeCompressed; }],
  ["triage", "./triage.v59.js", (m) => { triageCtx = m.triage; }],
  ["consult", "./consult.v59.js", (m) => { buildPackage = m.buildPackage; validatePackage = m.validatePackage; downloadJson = m.downloadJson; }],
  ["docx", "./docx.v59.js", (m) => { buildDocxReport = m.buildDocxReport; buildDocxReportEn = m.buildDocxReportEn; }],
  ["measure", "./measure.v59.js", (m) => { segMm = m.segMm; angleDeg = m.angleDeg; ellipseStats = m.ellipseStats; }],
  ["compare", "./compare.v59.js", (m) => { cmpFrameStats = m.frameStats; normalize01 = m.normalize01; diffStats = m.diffStats; frameGrayFlat = m.frameGrayFlat; }],
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
    assign(await loadMod(url));
  }
  stage("modules-done");
}

const APP_BUILD = "v90";

function checkUpdate() {
  fetch("./sw.js?cb=" + Date.now(), { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((t) => {
      const m = t.match(/const BUILD = "([^"]+)"/);
        if (m && m[1] !== APP_BUILD) {
        const b = $("update-banner");
        if (b) {
          b.style.display = "block";
          b.innerHTML =
            'تعمل الآن على ' + APP_BUILD + ' — تحديث متاح (' + m[1] + '): <a href="?v=' + m[1] + '" style="color:var(--accent)">افتح النسخة المحدثة الآن</a>.';
        }
        try {
          const k = "rrai-rw-" + m[1];
          if (!sessionStorage.getItem(k)) {
            sessionStorage.setItem(k, "1");
            setTimeout(() => location.reload(), 800);
            return;
          }
        } catch (e) {}
      }
    })
    .catch(() => {});
}
function releaseWatch() {
  releaseWatch();
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
export async function ingestFiles(fileList) {
  const groups = new Map();
  let skipped = 0;
  for (const file of fileList) {
    const bz = await buffersFromFile(file);
    const entries = bz.entries;
    if (bz.isZip && entries.length === 0) { skipped++; continue; }
    for (const entry of entries) {
      let parsed;
      try {
        parsed = parseDicom(entry.bytes);
      } catch (e) {
        console.warn("skip", entry.name, e);
        skipped++;
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
          continue;
        }
      }
      if (!px) { skipped++; continue; }
      if (!groups.has(parsed.studyUid)) {
        groups.set(parsed.studyUid, {
          uid: parsed.studyUid,
          patient: parsed.patientId,
          modality: parsed.modality,
          description: parsed.description,
          bodyPart: parsed.bodyPart || "",
          meta: {
            patientName: parsed.patientName || "", sex: parsed.sex || "", age: parsed.age || "",
            studyDate: parsed.studyDate || "", studyDesc: parsed.studyDesc || "", bodyPart: parsed.bodyPart || "",
          },
          frames: [],
          created: Date.now(),
          compressedSrc: parsed.compressed || null,
        });
      }
      groups.get(parsed.studyUid).frames.push(px);
    }
  }
  for (const study of groups.values()) {
    study.triage = triageCtx(study.frames[0], study);
    await putStudy(study);
  }
  await refresh();
  return { added: groups.size, skipped };
}

/* ---- rendering ---- */
const PRESETS = { auto: null, lung: [-600, 1600], mediastinum: [40, 400], bone: [300, 1500] };

export function drawFrame(canvas, pixels, preset, modality) {
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
    if (hi <= lo) hi = lo + 1;
    if (pixels.__img && pixels.__img.k === preset + "|" + modality) {
      ctx.putImageData(pixels.__img.img, 0, 0);
      return;
    }
    const invert = photometric === "MONOCHROME1";
    for (let i = 0; i < w * h; i++) {
      let v = (d[i] - lo) / (hi - lo);
      v = Math.max(0, Math.min(1, v));
      if (invert) v = 1 - v;
      const g = Math.round(v * 255);
      img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
    }
  }
  try { pixels.__img = { k: preset + "|" + modality, img }; } catch (e) {}
  ctx.putImageData(img, 0, 0);
}

/* ---- viewer interaction: zoom / pan / measure ---- */
let vk = 1, vx = 0, vy = 0, measureMode = false, mPts = [], viewKey = "", fitK = 1;
let mMode = "seg", mItems = { segments: [], angles: [], rois: [] };
function applyView() {
  if (vk <= 1.01 && !fsNow()) { vx = 0; vy = 0; }
  $("vwrap").style.transform = `translate(${Math.round(vx)}px, ${Math.round(vy)}px) scale(${vk})`;
  const zs = $("zscale");
  if (zs) zs.textContent = "\u00d7" + (fitK * vk).toFixed(2);
}
const fsNow = () => !!document.fullscreenElement || !!($("viewer-card") && $("viewer-card").classList.contains("fs-fake"));
function sliceFitFor(f) {
  const vp = $("viewport");
  const cw = (vp && (vp.clientWidth || Math.round(vp.getBoundingClientRect().width))) || 0;
  const kw = cw ? cw / (f.w || 1) : 4;
  let k = kw;
  const fs = fsNow();
  if (fs) {
    const ch = vp ? (vp.clientHeight || 0) : 0;
    const chh = ch > 40 ? ch : (window.innerHeight || 800);
    return Math.max(0.25, Math.min(4, Math.min(cw / (f.w || 1), chh / (f.h || 1))));
  }
  if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
    const ih = window.innerHeight || 800;
    let top = 0;
    if (vp) { const vr = vp.getBoundingClientRect(); top = Math.min(Math.max(vr.top, 0), ih * 0.5); }
    const ch = ih - top - 150;
    if (ch > 40) k = Math.min(k, ch / (f.h || 1));
  }
  return Math.max(0.25, Math.min(4, k));
}
let fsHideT = 0;
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
function resetView(fit) {
  const f = current && current.frames[Number($("slice").value || 0)];
  const compute = () => {
    if (fit) fitK = sliceFitFor(f);
    vk = 1; vx = 0; vy = 0;
    const stW = Math.max(1, Math.round(f.w * fitK));
    const stH = Math.max(1, Math.round(f.h * fitK));
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
    cv.style.left = Math.round((stW - f.w * fitK) / 2) + "px";
    cv.style.top = Math.round((stH - f.h * fitK) / 2) + "px";
    const ov = $("overlay");
    ov.style.inset = "auto";
    ov.style.position = "absolute";
    ov.style.width = cv.style.width;
    ov.style.height = cv.style.height;
    ov.style.left = cv.style.left;
    ov.style.top = cv.style.top;
    applyView();
  };
  compute();
  requestAnimationFrame(compute);
}
function imgPoint(e) {
  const r = $("frame").getBoundingClientRect();
  const f0 = curFrame();
  const s = (f0 && r.width / f0.w) || vk;
  return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
}
function centerOn(ix, iy) {
  const vr = $("viewport").getBoundingClientRect();
  const r = $("frame").getBoundingClientRect();
  const f0 = curFrame();
  const s = (f0 && r.width / f0.w) || vk;
  vx += vr.left + vr.width / 2 - (r.left + ix * s);
  vy += vr.top + vr.height / 2 - (r.top + iy * s);
  applyView();
}
const curFrame = () => current && current.frames[Number($("slice").value)];
function commitMeasurements() {
  if (!current) return;
  current.measurements = { segments: mItems.segments, angles: mItems.angles, rois: mItems.rois };
  try { putStudy(current).catch(() => {}); } catch (e) {}
}
function drawOverlay() {
  const ov = $("overlay");
  const ctx = ov.getContext("2d");
  ctx.clearRect(0, 0, ov.width, ov.height);
  ctx.strokeStyle = "#38bdf8"; ctx.fillStyle = "#38bdf8"; ctx.lineWidth = 1.5;
  ctx.font = "12px system-ui, sans-serif";
  const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); };
  const label = (t, x, y) => { ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "#0b1220"; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); ctx.restore(); };
  (mItems.segments || []).forEach((s, i) => {
    ctx.beginPath(); ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]); ctx.stroke();
    dot(s.a[0], s.a[1]); dot(s.b[0], s.b[1]);
    label((i + 1) + ": " + (s.mm != null ? s.mm.toFixed(1) + " مم" : s.px.toFixed(0) + " بكسل"), (s.a[0] + s.b[0]) / 2 + 6, (s.a[1] + s.b[1]) / 2 - 6);
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
  for (const [x, y] of mPts) dot(x, y);
  if (mMode === "seg" && mPts.length === 2) { ctx.beginPath(); ctx.moveTo(mPts[0][0], mPts[0][1]); ctx.lineTo(mPts[1][0], mPts[1][1]); ctx.stroke(); }
  if (mMode === "angle" && mPts.length >= 2) {
    ctx.beginPath(); ctx.moveTo(mPts[0][0], mPts[0][1]); ctx.lineTo(mPts[1][0], mPts[1][1]);
    if (mPts[2]) ctx.lineTo(mPts[2][0], mPts[2][1]);
    ctx.stroke();
  }
  if (mMode === "roi" && mPts.length === 2) {
    ctx.beginPath(); ctx.ellipse(mPts[0][0], mPts[0][1], Math.max(2, Math.abs(mPts[1][0] - mPts[0][0])), Math.max(2, Math.abs(mPts[1][1] - mPts[0][1])), 0, 0, 7); ctx.stroke();
  }
}
let cmp = null;
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
  cx2.imageSmoothingEnabled = true;
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
  const fa = current.frames[Number($("slice").value)];
  if (!fa) return;
  const ratio = current.frames.length > 1 ? Number($("slice").value) / (current.frames.length - 1) : 0;
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
    '<div style="font-weight:700;margin-bottom:.4rem;">مقارنة مع دراسة سابقة</div>' +
    '<div style="display:flex;gap:.5rem;flex-wrap:wrap;">' +
    '<div><canvas id="cmp-a" style="width:32%;max-width:220px;background:#000;"></canvas><div style="font-size:.75rem;">الحالية</div></div>' +
    '<div><canvas id="cmp-b" style="width:32%;max-width:220px;background:#000;"></canvas><div style="font-size:.75rem;">السابقة/الأخرى</div></div>' +
    '<div><canvas id="cmp-d" style="width:32%;max-width:220px;background:#000;"></canvas><div style="font-size:.75rem;">خريطة الفرق (أحمر = ساخن)</div></div>' +
    '</div><div id="compare-out" style="margin-top:.4rem;font-size:.85rem;color:var(--accent);"></div>';
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
}
function measureOut() {
  const out = $("measure-out");
  if (!out) return;
  if (!measureMode) { out.textContent = ""; return; }
  const n = mItems.segments.length + mItems.angles.length + mItems.rois.length;
  const hints = { seg: "انقر نقطتين لكل قطعة", angle: "انقر 3 نقاط: ضلع ثم رأس ثم ضلع", roi: "انقر المركز ثم حافة القطع الناقص" };
  out.textContent = hints[mMode] + (n ? " — محفوظ: " + n : "");
}

/* ---- UI wiring ---- */
const $ = (id) => document.getElementById(id);

export async function refresh() {
  purgeOnceSoon();
  const studies = (await allStudies()).sort((a, b) => {
    const pa = a.triage?.priority === "urgent" ? 0 : 1;
    const pb = b.triage?.priority === "urgent" ? 0 : 1;
    return pa - pb || (a.created || 0) - (b.created || 0);
  });
  const body = document.querySelector("#worklist tbody");
  body.innerHTML = "";
  $("empty").style.display = studies.length ? "none" : "block";
  for (const s of studies) {
    const tr = document.createElement("tr");
    for (let i = 0; i < 5; i++) tr.appendChild(document.createElement("td"));
    tr.children[0].textContent = (s.meta && s.meta.patientName) || s.patient || "—";
    if (s.signedBy) { const sb = document.createElement("span"); sb.className = "badge signed"; sb.textContent = LANG === "en" ? "signed" : "موقّع"; tr.children[0].appendChild(sb); }
    tr.children[1].textContent = s.modality;
    const badge = document.createElement("span");
    const priority = s.triage?.priority || "routine";
    badge.className = "badge " + priority;
    badge.textContent = priLabel(s.consult ? "consult" : priority);
    if (s.consult) badge.className = "badge consult";
    tr.children[2].appendChild(badge);
    const rsn = document.createElement("div");
    rsn.className = "treason";
    rsn.textContent = (s.triage && s.triage.reasons && s.triage.reasons[0]) || "";
    rsn.title = ((s.triage && s.triage.reasons) || []).join(" | ");
    tr.children[2].appendChild(rsn);
    tr.children[3].textContent = s.frames.length;
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = LANG === "en" ? "View" : "عرض";
    btn.onclick = () => openStudy(s);
    tr.children[4].appendChild(btn);
    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "✕";
    del.title = "حذف الدراسة من الجهاز";
    del.style.marginInlineStart = ".3rem";
    del.style.padding = ".2rem .5rem";
    del.onclick = async () => {
      if (!confirm("حذف دراسة " + s.patient + " من هذا الجهاز؟")) return;
      await txDel(s.uid);
      if (current && current.uid === s.uid) current = null;
      await refresh();
    };
    tr.children[4].appendChild(del);
    body.appendChild(tr);
  }
}

async function openStudy(study) {
  current = study;
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
  $("slice").max = Math.max(0, study.frames.length - 1);
  $("slice").value = 0;
  viewKey = "";
  $("frame").style.display = "block";
  $("report-ar").style.display = "none";
  $("report-en").style.display = "none";
  $("sign-row").style.display = "none";
  show(0);
}

function frameStats(px) {
  const d = px && px.data;
  if (!d || !d.length) return { min: 0, max: 0 };
  let mn = Infinity, mx = -Infinity;
  const step = Math.max(1, Math.floor(d.length / 20000));
  for (let i = 0; i < d.length; i += step) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  return { min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx };
}

function show(idx) {
  if (!current) return;
  const f0 = current.frames[idx];
  let drawErr = "";
  try {
    drawFrame($("frame"), f0, $("preset").value, current.modality);
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
  if ($("viewer-name")) $("viewer-name").style.display = "block";
  mPts = [];
  drawOverlay();
  measureOut();
  const vKey = f0.w + "x" + f0.h;
  if (viewKey !== vKey) { viewKey = vKey; resetView(true); } else { applyView(); }
  const pnShow = (current.meta && current.meta.patientName) || current.patient || "—";
  const vnm = $("viewer-name");
  if (vnm) vnm.textContent = pnShow + " • " + ((current.meta && current.meta.sex) || "—") + " " + ((current.meta && current.meta.age) || "") + " • " + ((current.meta && current.meta.studyDate) || "") + " • " + current.modality;
  $("meta").textContent =
    `${pnShow} • ${current.modality} • شريحة ${idx + 1} من ${current.frames.length} • ${current.description || ""} • ${APP_BUILD} • ملاءمة=${fitK.toFixed(2)}`;
  const st = frameStats(f0);
  $("meta").textContent += " • [" + st.min + "-" + st.max + "]";
  if (drawErr) $("meta").textContent += " • خطأ رسم: " + drawErr;
  $("meta").textContent += " • حجم=" + cvF.width + "x" + cvF.height;
  if (st.max - st.min < 2 && current.compressedSrc && !f0.__redecode) { f0.__redecode = 1;
    decodeCompressed(current.compressedSrc, current)
      .then((px) => {
        current.frames[idx] = px;
        putStudy(current);
        drawFrame($("frame"), px, $("preset").value, current.modality);
        const ov2 = $("overlay");
        ov2.width = px.w;
        ov2.height = px.h;
        $("meta").textContent += " • [أعيد الفك]";
      })
      .catch(() => {});
  }
}

function setStatus(msg, warn) {
  const el = $("ingest-status");
  if (!el) return;
  el.textContent = msg;
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
const AI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
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
  const preset = ($("preset") && $("preset").value) || "auto";
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
  if (/(without|no |non-?contrast|plain)/.test(src)) return "without";
  if (/\b(iv|intravenous|gad)\b[^.]{0,20}contrast|with[^.]{0,20}contrast|contrast[^.]{0,20}(enhanced|given|administered)/.test(src)) return "with";
  return "unknown";
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
  const cph = cs === "with" ? "with intravenous contrast" : cs === "without" ? "without intravenous contrast" : "with contrast status per department protocol";
  if (/^MR/.test(mod)) {
    let seq = "multiplanar multisequence T1- and T2-weighted images";
    if (/brain/.test(region)) seq = "axial, sagittal and coronal T1, T2, FLAIR and DWI";
    else if (/spine/.test(region)) seq = "sagittal T1, sagittal T2 and axial T2-weighted images";
    else if (/knee|shoulder|hip|wrist|hand|elbow|ankle|foot/.test(region)) seq = "sagittal PD fat-saturated, STIR and coronal/axial T2-weighted sequences";
    return "Multiplanar, multisequence MRI of " + region + " was performed " + cph + ". Sequences include " + seq + ".";
  }
  if (/^CT/.test(mod)) return "Axial CT acquisitions of " + region + " were performed " + cph + ", with coronal and sagittal reformats.";
  if (/^(CR|DX|XR)/.test(mod)) return "Standard orthogonal projections of " + region + " were obtained without intravenous contrast.";
  if (/^US/.test(mod)) return "Real-time grayscale sonography of " + region + " was performed.";
  return mod + " examination of " + region + " was performed " + cph + ".";
}
function fillComposerFromAi(study, obj) {
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
async function aiGenerate(study) {
  const keyEl = $("ai-key");
  const key = (keyEl && keyEl.value.trim()) || "";
  try { localStorage.setItem("rrai-ai-key", key); } catch (e) {}
  const st = $("ingest-status");
  const say = (t, bad) => { if (st) { st.textContent = t; st.style.color = bad ? "#fca5a5" : "#86efac"; } };
  if (!key) { say(LANG === "en" ? "Add your free API key first — easiest without card: console.groq.com → API Keys (gsk…)." : "أضف مفتاحك المجاني أولًا — أسهل خيار بلا بطاقة: console.groq.com ← API Keys (يبدأ بـ gsk).", true); return; }
  const hint = aiProviderForKey(key);
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
  const okConsent = window.confirm(LANG === "en" ? "Send up to 6 slice renders" + extraTxt + " + numeric stats (NOT raw DICOM) to " + provName + " for this one request?" : "إرسال حتى 6 لقطات شرائح مصغّرة" + extraTxt + " + إحصاءات رقمية (ليس DICOM الخام) إلى " + provName + " لهذا الطلب الواحد فقط؟");
  if (!okConsent) return;
  const n = study.frames.length;
  const idxs = n <= 6 ? study.frames.map((_, i) => i) : [0, Math.round((n - 1) * 0.2), Math.round((n - 1) * 0.4), Math.round((n - 1) * 0.6), Math.round((n - 1) * 0.8), n - 1].filter((v, i2, a) => a.indexOf(v) === i2);
  const images = idxs.map((i) => sliceRenderB64(study, i)).concat(aiExtraImgs).slice(0, 8);
  let totalB64 = images.reduce((a, b) => a + b.length, 0);
  while (totalB64 > 3500000 && images.length > 6) { totalB64 -= images.pop().length; }
  const payload = { text: aiPromptText(study), images: images };
  say(LANG === "en" ? "AI drafting…" : "توليد مسودة بالذكاء…");
  let lastErr = null;
  const cfg = AI_PROVIDERS[provider] || AI_PROVIDERS.groq;
  if (cfg.serverSide) {
    try {
      const r = await fetch(location.origin + "/api/report_ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: JSON.parse(JSON.stringify(payload.text.match(/STUDY CONTEXT JSON: (.*)$/)?.[1] || "{}")), notes: (study.report && study.report.notes) || "" }) });
      if (!r.ok) throw new Error("http " + r.status + " " + (await r.text()).slice(0, 140));
      const obj = await r.json();
      fillComposerFromAi(study, obj);
      say(LANG === "en" ? "Server AI draft inserted — review, edit, then export." : "أُدرجت مسودة ذكاء السيرفر — راجع وعدّل ثم صدّر.");
      return;
    } catch (e) {
      say(LANG === "en" ? "Server AI failed: " + (e && e.message ? e.message : e) : "فشل ذكاء السيرفر: " + (e && e.message ? e.message : e) + " — إن لم يُضبط مفتاح المؤسسة على Vercel استخدم Groq مباشرة.", true);
      return;
    }
  }
  const wantImgs = payload.images.length > 0;
  const ordered = cfg.models.slice().sort((a, b) => (cfg.vision[b] ? 1 : 0) - (cfg.vision[a] ? 1 : 0));
  let lastVisionErr = null;
  for (const pass of (wantImgs ? [1, 2] : [2])) {
    for (const model of ordered) {
      const useImages = pass === 1;
      if (useImages && !cfg.vision[model] && !cfg.native) continue;
      try {
        const rq = aiRequestFor(provider, key, model, useImages ? payload : { text: payload.text, images: [] });
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 45000);
        let r;
        try {
          r = await fetch(rq.url, { method: "POST", headers: rq.headers, body: JSON.stringify(rq.body), signal: ac.signal });
        } catch (ae) { clearTimeout(to); throw new Error("timeout/45s " + model); }
        clearTimeout(to);
        if (r.status === 404) { lastErr = new Error("model 404 " + model); continue; }
        if (!r.ok) {
          const t = await r.text();
          throw new Error("http " + r.status + " " + t.slice(0, 160));
        }
        const j = await r.json();
        const txt = rq.openai ? ((j.choices || [])[0]?.message?.content || "") : ((j.candidates || [])[0]?.content?.parts || []).map((pp) => pp.text || "").join("");
        const clean = txt.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const obj = JSON.parse(clean);
        const wasBlind = wantImgs && pass === 2;
        fillComposerFromAi(study, obj);
        const nf = Array.isArray(obj.findings) ? obj.findings.length : 0;
        const na = nf ? obj.findings.filter((x) => /not assessed/i.test(String(x))).length / nf : 0;
        if (wasBlind) say(LANG === "en" ? "WARNING: vision models unavailable for this request — draft built from context/notes ONLY (images not read). Retry in a minute for an image-based draft." : "تنبيه: تعذّر إرسال الصور لنماذج الرؤية — سبب الفشل: " + (lastVisionErr && lastVisionErr.message ? lastVisionErr.message : lastVisionErr) + " — المسودة من السياق/الملاحظات فقط بدون قراءة الصور. أعد المحاولة بعد دقيقة لمسودة مبنية على الصور.", true);
        else if (useImages && na > 0.6) say(LANG === "en" ? "Draft inserted, but most compartments were reported 'not assessed' — retry or attach extra screenshots for a richer read." : "أُدرجت المسودة لكن معظم الأجزاء «غير مُقيّمة» — أعد المحاولة أو أرفق لقطات شاشة إضافية لقراءة أغنى.", true);
        else say(LANG === "en" ? "AI draft inserted into the composer — review, edit, then export." : "أُدرجت مسودة الذكاء في لوحة التأليف — راجع وعدّل ثم صدّر.");
        return;
      } catch (e) { lastErr = e; if (useImages) lastVisionErr = e; }
    }
  }
  const msg = (lastErr && lastErr.message) ? lastErr.message : String(lastErr);
  say(LANG === "en" ? "AI draft failed: " + msg : "فشل توليد المسودة: " + (/401|API key/.test(msg) ? "تحقق من المفتاح." : /429|quota/i.test(msg) ? "حصة مجانية انتهت — حاول لاحقًا." : msg), true);
}
function setupAi() {
  const k = $("ai-key");
  if (!k) return;
  try { k.value = localStorage.getItem("rrai-ai-key") || ""; } catch (e) {}
  const pv = $("ai-provider");
  if (pv) { try { pv.value = localStorage.getItem("rrai-ai-provider") || "groq"; } catch (e) {} }
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
  const en = draftReport(study).en || "";
  const skip = ["Radiology report draft", "Patient:", "Impression:", "Automated triage", "Triage context:", "Sign-off:", "Recommendation:"];
  const findings = en.split("\n").map((l) => l.trim()).filter((l) => l && !skip.some((k) => l.startsWith(k)));
  const impLine = en.split("\n").find((l) => l.startsWith("Impression:")) || "";
  return { exam: examNameFor(study), indication: study.indication || "", findings: findings.join("\n"), impression: impLine.replace("Impression: ", "").trim(), notes: "" };
}
function readComposer() {
  const g = (id) => { const e = $(id); return e ? String(e.value || "").trim() : ""; };
  const exam = g("rep-exam"), indication = g("rep-indication"), f = g("rep-findings"), i = g("rep-impression"), notes = g("rep-notes");
  if (!exam && !indication && !f && !i && !notes) return null;
  return { exam, indication, findings: f ? f.split("\n").map((x) => x.trim()).filter(Boolean) : [], impression: i ? i.split("\n").map((x) => x.trim()).filter(Boolean) : [], notes };
}
function prefillComposer(study) {
  if (!study || !$("rep-exam")) return;
  const d = study.report || composerDefaults(study);
  $("rep-exam").value = d.exam || "";
  $("rep-indication").value = d.indication || "";
  $("rep-findings").value = d.findings || "";
  $("rep-impression").value = d.impression || "";
  { const nn = $("rep-notes"); if (nn) nn.value = d.notes || ""; }
}
function setupComposer() {
  if (!$("rep-exam")) return;
  let t = null;
  const save = () => {
    if (!current) return;
    const e = $("rep-exam"), ind = $("rep-indication"), f = $("rep-findings"), im = $("rep-impression");
    current.report = { exam: e.value.trim(), indication: ind.value.trim(), findings: f.value.trim(), impression: im.value.trim(), notes: ($("rep-notes") ? $("rep-notes").value.trim() : "") };
    putStudy(current);
  };
  for (const id of ["rep-exam", "rep-indication", "rep-findings", "rep-impression", "rep-notes"]) {
    $(id).addEventListener("input", () => { clearTimeout(t); t = setTimeout(save, 600); });
  }
  const bankRoot = $("bank-set");
  if (bankRoot) bankRoot.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest("[data-bank]") : null;
    if (!b) return;
    const ta = $(b.getAttribute("data-bank") === "i" ? "rep-impression" : "rep-findings");
    if (!ta) return;
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
    findings: (comp && comp.findings) || "", impression: (comp && comp.impression) || "",
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
  const study = { meta: { patientName: e.patient, sex: e.sex, age: e.age, studyDate: e.studyDate }, modality: e.modality, patient: e.patient,
    report: { exam: e.exam, indication: e.indication, findings: e.findings, impression: e.impression, technique: e.technique, notes: e.notes },
    signedBy: e.signer, license: e.license, docHash: e.hash };
  const comp = { exam: e.exam, indication: e.indication, technique: e.technique,
    findings: String(e.findings || "").split("\n").filter(Boolean), impression: String(e.impression || "").split("\n").filter(Boolean) };
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
      const f = $("rep-findings"), im = $("rep-impression"), ex = $("rep-exam"), ind = $("rep-indication"), nn = $("rep-notes");
      if (f && f.value.trim() && !window.confirm(LANG === "en" ? "Replace current composer content with this archived report?" : "استبدال محتوى المحرر الحالي بهذا التقرير المؤرشف؟")) return;
      if (ex) ex.value = e.exam || ""; if (ind) ind.value = e.indication || "";
      if (f) f.value = e.findings || ""; if (im) im.value = e.impression || ""; if (nn) nn.value = e.notes || "";
      if (current) { current.report = { exam: ex.value.trim(), indication: ind.value.trim(), findings: f.value.trim(), impression: im.value.trim(), technique: e.technique || "", notes: nn.value.trim() }; putStudy(current); }
      setStatus(LANG === "en" ? "Archived report loaded into the composer." : "فُتح التقرير المؤرشف في المحرر.", false);
    }));
    bar.appendChild(mk(LANG === "en" ? "Re-export Word" : "إعادة تصدير Word", () => archiveExport(e)));
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
  return "<h1>MEDICAL RADIOLOGY REPORT</h1>" +
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
    archiveSave(current, Object.assign({}, comp, { technique: (current.report && current.report.technique) || comp.technique || "" }),
      { signer: ($("signer") && $("signer").value.trim()) || current.signedBy || "", license: ($("signer-license") && $("signer-license").value.trim()) || current.license || "", hash: current.docHash || "", status: current.signedBy ? "signed" : "draft", at: new Date().toISOString() });
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
    const say = (t, bad) => { if (st) { st.textContent = t; st.style.color = bad ? "#fca5a5" : "#86efac"; } setStatus(t, !!bad); };
    if (!base) { say("أدخل عنوان DICOMweb الأساسي أولًا (مثل https://pacs.example/dicom-web).", true); return; }
    const isPrivate = /^http:\/\/(127\.|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base);
    const relay = (t) => (isPrivate ? t : location.origin + "/api/dicomweb?url=" + encodeURIComponent(t));
    try {
      say("استعلام QIDO-RS…");
      const qr = await fetch(relay(base + "/studies?limit=10" + (q ? "&PatientID=" + encodeURIComponent(q) : "")), { headers: { Accept: "application/dicom+json" } });
      if (!qr.ok) throw new Error("QIDO http " + qr.status);
      const list = await qr.json();
      if (!Array.isArray(list) || !list.length) { say("لا دراسات مطابقة في الأرشيف.", true); return; }
      const uid = (list[0]["0020,000D"] || {}).Value?.[0];
      if (!uid) throw new Error("StudyInstanceUID مفقود في رد QIDO");
      say("سحب WADO-RS للدراسة " + uid.slice(-12) + "…");
      const wr = await fetch(relay(base + "/studies/" + uid), { headers: { Accept: "multipart/related; type=application/dicom" } });
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
    const say = (t, bad) => { if (st) { st.textContent = t; st.style.color = bad ? "#fca5a5" : "#86efac"; } setStatus(t, !!bad); };
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
    const via = (t, opts) => isPriv && t === url ? fetch(t, opts) : fetch(location.origin + "/api/dicomweb?url=" + encodeURIComponent(t), opts);
    try {
      let direct = url;
      if (/we\.tl\//i.test(url) || /wetransfer\.com\//i.test(url)) {
        say("فض رابط WeTransfer عبر الخادم…");
        const page = await (await via(url)).text();
        if (/just a moment|attention required|verify you are human|captcha|cf-chl|challenge-platform|download_expired|expired/i.test(page)) throw new Error(LANG === "en" ? "WeTransfer asked the server for human verification, or the link expired - use \"Choose files\" or a direct ZIP link" : "WeTransfer طلب تحققًا بشريًا من الخادم أو انتهت صلاحية الرابط — استخدم «اختيار الملفات» أو رابط ZIP مباشر");
        const tid = page.match(/"transfer_id":"([^"]+)"/) || page.match(/transfers\/([a-f0-9]{32,})/);
        const sh = page.match(/"security_hash":"([^"]+)"/);
        if (!tid || !sh) throw new Error("تعذر استخراج معرّف التحويل من صفحة WeTransfer");
        const id = tid[1];
        const pr = await fetch(location.origin + "/api/dicomweb?url=" + encodeURIComponent("https://wetransfer.com/api/v2/transfers/" + id + "/download"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transfer_id: id, security_hash: sh[1] })
        });
        const pj = await pr.json();
        if (!pj || !pj.direct_link) throw new Error("WeTransfer لم يعد رابطًا مباشرًا (قد يحتاج الحماية البشرية)");
        direct = pj.direct_link;
      }
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
  subtitle: ["نسخة المتصفح — تعمل Offline بالكامل، بياناتك تبقى على جهازك", "Browser edition — fully offline; your data stays on your device"],
  "h-upload": ["رفع دراسات DICOM", "Upload DICOM studies"],
  "h-worklist": ["قائمة العمل (الحرج أولًا)", "Worklist (urgent first)"],
  "h-viewer": ["العارض", "Viewer"],
  "th-patient": ["المريض", "Patient"], "th-mod": ["النوع", "Modality"], "th-pri": ["الأولوية", "Priority"], "th-slices": ["الشرائح", "Slices"],
  upload: ["رفع وتحليل", "Upload & analyze"], demo: ["توليد ديمو", "Generate demo"],
  "clear-all": ["تفريغ القائمة من الجهاز", "Empty worklist from device"],
  measure: ["قياس", "Measure"], "gen-report": ["توليد مسودة التقرير (ع/EN)", "Draft report (AR/EN)"],
  "copy-report": ["نسخ المسودة", "Copy draft"], "sign-export": ["توقيع وتصدير PDF", "Sign & export PDF"],
  "sign-export-word": ["توقيع وتصدير Word", "Sign & export Word"], "sign-export-word-en": ["تصدير Word (قالب EN)", "Word (EN template)"],
  "org-sum": ["إعدادات ترويسة المؤسسة", "Organization letterhead"], "org-save": ["حفظ الترويسة", "Save letterhead"],
  "lbl-slice": ["الشريحة", "Slice"],
  "pacs-sum": ["سحب من PACS (DICOMweb)", "Pull from PACS (DICOMweb)"],
  "pacs-pull": ["سحب أول دراسة مطابقة", "Pull first matching study"],
  "pacs-dl": ["سحب من رابط تنزيل (WeTransfer/ZIP/DICOM)", "Pull from download link (WeTransfer/ZIP/DICOM)"],
  "pick-dir": ["اختيار مجلد DICOM كامل بدل اختيار الملفات واحدًا واحدًا", "Pick a whole DICOM folder instead of file-by-file"],
  "lbl-ai-provider": ["المزوّد (كلها بلا بطاقة ائتمان)", "Provider (all card-free)"],
  "lbl-ai-key": ["مفتاح API (يُحفظ على جهازك فقط)", "API key (stored on your device only)"],
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
  "hint-main": ["⚙ كل المعالجة تحدث داخل متصفحك: لا سيرفر، لا إنترنت مطلوب بعد التثبيت، ولا بيانات تغادر جهازك. من قائمة المتصفح ⋮ ← \"إضافة إلى الشاشة الرئيسية\" لتثبيتها كتطبيق.", "⚙ All processing happens inside your browser: no server, no internet needed after install, and no data leaves your device. From the browser menu ⋮ choose \"Add to Home screen\" to install it as an app."]
};
const PRESET_L = { auto: ["تلقائي", "Auto"], lung: ["رئة", "Lung"], mediastinum: ["منصف", "Mediastinum"], bone: ["عظم", "Bone"] };
const PLACE_L = { "pacs-dl-url": ["https://we.tl/t-… أو https://…/study.zip أو https://…/study.dcm", "https://we.tl/t-… or https://…/study.zip or https://…/study.dcm"], "pacs-url": ["https://pacs.hospital.local/dicom-web", "https://pacs.hospital.local/dicom-web"], "pacs-q": ["معرف المريض (اختياري)", "Patient ID (optional)"] };
function applyLang(lang) {
  LANG = lang === "en" ? "en" : "ar";
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "en" ? "ltr" : "rtl";
  for (const [id, pair] of Object.entries(I18N)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const txt = pair[LANG === "en" ? 1 : 0];
    if (id === "lbl-slice") { if (el.firstChild) el.firstChild.nodeValue = txt + " "; }
    else el.textContent = txt;
  }
  for (const [pid, pl] of Object.entries(PLACE_L)) { const pe = document.getElementById(pid); if (pe) pe.placeholder = pl[LANG === "en" ? 1 : 0]; }
  const pre = document.getElementById("preset");
  if (pre) for (const o of pre.options) { const pl = PRESET_L[o.value]; if (pl) o.textContent = pl[LANG === "en" ? 1 : 0]; }
  const lt = document.getElementById("lang-toggle");
  if (lt) lt.textContent = LANG === "en" ? "ع" : "EN";
  try { localStorage.setItem("rrai-lang", LANG); } catch (e) {}
  if (typeof refresh === "function") refresh().catch(() => {});
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
  $("preset").addEventListener("change", () => show(Number($("slice").value)));
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
        setStatus(LANG === "en" ? "Added " + r.added + " studies from the folder" + (r.skipped ? " (skipped " + r.skipped + " non-DICOM files)" : "") + "." : "أُضيفت " + r.added + " دراسة من المجلد" + (r.skipped ? " (تُخطّي " + r.skipped + " ملفًا غير DICOM)" : "") + ".");
      } catch (e) {
        setStatus(LANG === "en" ? "Folder read failed: " + (e && e.message ? e.message : e) : "فشلت قراءة المجلد: " + (e && e.message ? e.message : e), true);
      }
    });
  }
  $("upload").addEventListener("click", async () => {
    const input = $("files");
    if (!input.files.length) {
      setStatus("اختر ملفات DICOM أولًا ثم اضغط رفع وتحليل.", true);
      return;
    }
    let r;
    try {
      r = await ingestFiles(input.files);
    } catch (e) {
      setStatus("فشل الرفع: " + (e && e.message ? e.message : e), true);
      input.value = "";
      return;
    }
    if (r.added === 0) {
      setStatus(
        "لم تُضف أي دراسة: الملفات تالفة أو بصيغة تعذّر فكّها حتى بعد تفعيل مفكات v0.4 (راجع سجل الطرفية).",
        true
      );
    } else {
      setStatus(
        "تمت إضافة " + r.added + " دراسات" + (r.skipped ? " — تم تجاهل " + r.skipped + " ملفات غير مدعومة" : "") + ".",
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
  setupCompareUI();
  $("gen-report").addEventListener("click", () => {
    if (!current) return;
    if (!current.report) prefillComposer(current);
    renderBank(current);
    const d = draftReport(current);
    $("report-ar").textContent = d.ar;
    $("report-en").textContent = d.en;
    $("report-ar").style.display = "block";
    $("report-en").style.display = "block";
    $("sign-row").style.display = "flex";
    $("signoff").checked = !!current.signedBy;
    $("signer").value = current.signedBy || "";
    $("sign-extra").style.display = "flex";
    $("signer-license").value = current.license || "";
    (async () => {
      try {
        const org2 = JSON.parse(localStorage.getItem("rrai-org") || "{}");
        const signer2 = $("signer").value.trim();
        const license2 = $("signer-license").value.trim();
        const at2 = new Date().toISOString();
        const comp2 = readComposer();
        const dHash = comp2 ? { ar: d.ar, en: d.en + "\n[composer]\n" + JSON.stringify(comp2) } : d;
        const hash2 = await signedDocHash(current, dHash, { signer: signer2, license: license2, at: at2 });
        const bytes2 = buildDocxReportEn(current, d, { signer: signer2 || "—", license: license2, org: org2, at: at2, hash: hash2 }, comp2);
        const blob2 = new Blob([bytes2], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        const el2 = document.createElement("a");
        el2.href = URL.createObjectURL(blob2);
        el2.download = "rrai-report-EN-" + safeFilePart(current.patient) + ".docx";
        document.body.appendChild(el2);
        el2.click();
        setTimeout(() => { URL.revokeObjectURL(el2.href); el2.remove(); }, 400);
        archiveSave(current, Object.assign({}, comp2, { technique: (current.report && current.report.technique) || "" }), { signer: signer2, license: license2, hash: hash2, status: signer2 ? "signed" : "draft", at: at2 });
        renderArchive();
        setStatus("وُلدت المسودة ونُزل ملف Word الإنجليزي بالقالب السريري: " + el2.download + " — البصمة: " + hash2.slice(0, 16) + "…", false);
      } catch (e) {
        setStatus("وُلدت المسودة؛ تعذر تنزيل قالب EN: " + (e && e.message ? e.message : e), true);
      }
    })();
    try {
      const org = JSON.parse(localStorage.getItem("rrai-org") || "{}");
      $("org-ar").value = org.ar || "";
      $("org-en").value = org.en || "";
    } catch (e) {}
  });
  const saveSign = async () => {
    if (!current) return;
    current.signedBy = $("signoff").checked ? ($("signer").value || "أخصائي") : "";
    await putStudy(current);
    await refresh();
  };
  $("signoff").addEventListener("change", saveSign);
  $("signer").addEventListener("change", saveSign);
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
    for (const s2 of list) rows.push([(s2.meta && s2.meta.patientName) || s2.patient || "", s2.modality, s2.frames.length, (s2.triage && s2.triage.priority) || "routine", s2.signedBy ? "signed" : (s2.consult ? "consult" : "draft"), (s2.meta && s2.meta.studyDate) || "", new Date(s2.createdAt || Date.now()).toISOString()]);
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = "worklist-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click(); URL.revokeObjectURL(a.href);
    setStatus(LANG === "en" ? "Worklist exported as CSV to this device." : "صُدّرت قائمة العمل ملف CSV على جهازك.", false);
    } catch (e) { setStatus((LANG === "en" ? "CSV export failed: " : "فشل تصدير CSV: ") + e.message, true); }
  });
  $("clear-all").addEventListener("click", async () => {
    if (!confirm("تفريغ القائمة: حذف كل الدراسات من هذا الجهاز؟")) return;
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
      const k1 = Math.max(0.5, Math.min(8, (k0 * d) / pinch0));
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
      vx += e.clientX - prev[0]; vy += e.clientY - prev[1]; moved = true; clampPan(); applyView();
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
      const p = imgPoint(e);
      mPts.push(p);
      const need = mMode === "angle" ? 3 : 2;
      if (mPts.length >= need) {
        if (mMode === "seg") {
          const f = curFrame();
          const sp = f && f.spacing;
          mItems.segments.push({
            a: mPts[0], b: mPts[1],
            px: Math.hypot(mPts[1][0] - mPts[0][0], mPts[1][1] - mPts[0][1]),
            mm: segMm(mPts[0], mPts[1], sp),
          });
        } else if (mMode === "angle") {
          mItems.angles.push({ p1: mPts[0], v: mPts[1], p2: mPts[2], deg: angleDeg(mPts[0], mPts[1], mPts[2]) });
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
  vp.addEventListener("pointercancel", vpUp);
  vp.addEventListener("dblclick", (e) => {
    if (vk > 1.01) { viewKey = ""; resetView(true); }
    else { const pt = imgPoint(e); vk = 2; centerOn(pt[0], pt[1]); setStatus("\u062a\u0643\u0628\u064a\u0631 \u00d72 \u2014 \u0646\u0642\u0631\u0629 \u0645\u0632\u062f\u0648\u062c\u0629 \u062b\u0627\u0646\u064a\u0629 \u0623\u0648 \u0632\u0631 \u0645\u0644\u0627\u0621\u0645\u0629 \u064a\u0639\u064a\u062f\u0627\u0646 \u0627\u0644\u0635\u0648\u0631\u0629 \u0644\u0644\u0634\u0627\u0634\u0629."); }
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
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) fsArm(); else fsBarShow(true);
    const b = $("fs-toggle");
    if (b) b.textContent = document.fullscreenElement ? (LANG === "ar" ? "خروج من ملء الشاشة" : "Exit fullscreen") : (LANG === "ar" ? "ملء الشاشة" : "Fullscreen");
  });
  $("measure").addEventListener("click", () => {
    measureMode = !measureMode;
    mPts = [];
    if (measureMode && current && current.measurements) {
      mItems = { segments: current.measurements.segments || [], angles: current.measurements.angles || [], rois: current.measurements.rois || [] };
    }
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
  setupAi();
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
  const zr = $("zoom-reset");
  if (zr && zr.parentNode) zr.parentNode.insertBefore(exp, zr.nextSibling);
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
  imp.onclick = () => { setStatus("اختر ملف الحزمة (عادة في مجلد التنزيلات).", false); fi.click(); };
  const imp2 = document.createElement("button");
  imp2.className = "ghost";
  imp2.id = "import-consult-clip";
  imp2.textContent = "استيراد من الحافظة";
  imp2.title = "يلصق حزمة منسوخة دون المرور بمنتقي الملفات";
  if (ca && ca.parentNode) ca.parentNode.insertBefore(imp2, ca);
  const imp3 = document.createElement("button");
  imp3.className = "ghost";
  imp3.id = "import-consult-last";
  imp3.textContent = "استيراد آخر حزمة مصدّرة";
  imp3.title = "يعيد إدخال آخر حزمة بُنيت على هذا الجهاز — بلا منتقي ملفات";
  if (ca && ca.parentNode) ca.parentNode.insertBefore(imp3, ca);
  imp3.onclick = async () => {
    const t = localStorage.getItem("rrai-last-pkg");
    if (!t) { setStatus("لا حزمة مصدّرة محفوظة على هذا الجهاز بعد — صدّر واحدة أولًا.", true); return; }
    await importConsultText(t);
  };
  imp2.onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.trim()) { setStatus("الحافظة فارغة — انسخ الحزمة أولًا من جهاز الإرسال.", true); return; }
      await importConsultText(t);
    } catch (e) { setStatus("تعذّرت قراءة الحافظة: " + (e && e.message ? e.message : e), true); }
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
  const note = prompt(isReply ? "ردّ المستشار (انطباع/توصية):" : "ملاحظتك السريرية أو سؤالك للمستشار:", "") || "";
  let actor = current.signedBy || "";
  if (!actor) actor = prompt("اسمك (يُسجل في الحزمة):", "") || "unknown";
  const reportText = ($("report-ar").textContent || "").trim() || draftReport(current).ar;
  const pkg = await buildPackage({
    reply: isReply,
    actor,
    note,
    study: isReply ? null : current,
    refUid: isReply ? ((current.consult && current.consult.refUid) || current.uid) : "",
    refHash: isReply ? (current.consult && current.consult.hash) : "",
    triage: current.triage || null,
    reportText,
    measurePts: (typeof mPts !== "undefined" ? mPts : []) || [],
    measurements: current.measurements || null,
    snapshotPng: await snapshotFrame(),
  });
  const fname = (isReply ? "rrai-reply-" : "rrai-consult-") + (current.patient || "study") + ".json";
  downloadJson(pkg, fname);
  let copied = false;
  try { await navigator.clipboard.writeText(JSON.stringify(pkg)); copied = true; } catch (e) {}
  try { localStorage.setItem("rrai-last-pkg", JSON.stringify(pkg)); } catch (e) {}
  current.consultLog = current.consultLog || [];
  current.consultLog.push({ at: new Date().toISOString(), actor, action: isReply ? "reply-export" : "consult-export", hash: pkg.hash });
  try { await putStudy(current); } catch (e) {}
  setStatus((isReply ? "صُدّر رد الاستشارة: " : "صُدّرت حزمة الاستشارة: ") + fname + " في التنزيلات" + (copied ? " + منسوخة في الحافظة (يمكن إرسالها نصًا)." : "."), false);
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
  try { text = await file.text(); } catch (e) { setStatus("تعذّرت قراءة الملف — رُفض الاستيراد (فشل مغلق).", true); return; }
  return importConsultText(text);
}

async function importConsultText(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch (e) {
    const t2 = text || "";
    if (t2.slice(0, 4) === "DICM" || t2.indexOf("\0") >= 0) {
      setStatus("الملف المحدد DICOM وليس حزمة استشارة — الحزمة اسمها rrai-consult-….json وتكون في مجلد التنزيلات Downloads، أو استخدم «استيراد من الحافظة» / «استيراد آخر حزمة مصدّرة».", true);
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

/* ---- v1.0.1 signed export wiring ---- */
async function signCurrent() {
  if (!current) { setStatus("افتح دراسة أولًا.", true); return null; }
  const signer = $("signer").value.trim();
  if (!signer) { setStatus("التوقيع يتطلب اسم الطبيب — رُفض (فشل مغلق).", true); return null; }
  const license = $("signer-license").value.trim();
  let org = { ar: "مؤسسة صحية", en: "Health Facility" };
  try { org = Object.assign(org, JSON.parse(localStorage.getItem("rrai-org") || "{}")); } catch (e) {}
  const draft = draftReport(current);
  const doc = await buildSignedDocument(current, draft, { signer, license, org });
  current.signedBy = signer;
  current.signedAt = doc.at;
  current.license = license;
  current.docHash = doc.hash;
  current.signedHistory = current.signedHistory || [];
  current.signedHistory.push({ at: doc.at, signer, license, hash: doc.hash });
  try { await putStudy(current); } catch (e) {}
  return { doc, draft, signer, license, org };
}

function setupSignExport() {
  if (!$("sign-export") || !$("sign-export-word") || !$("org-save")) {
    setStatus("واجهة التوقيع ناقصة في هذا الإصدار — أعد التحميل مع مسح بيانات الموقع.", true);
    return;
  }
  $("org-save").addEventListener("click", () => {
    const org = { ar: $("org-ar").value.trim(), en: $("org-en").value.trim() };
    localStorage.setItem("rrai-org", JSON.stringify(org));
    setStatus("حُفظت ترويسة المؤسسة للمستندات القادمة.", false);
  });
  $("sign-export").addEventListener("click", async () => {
    const s = await signCurrent();
    if (!s) return;
    $("print-root").innerHTML = s.doc.html;
    setStatus("فُتح حوار الطباعة — اختر «حفظ كـPDF». بصمة المستند: " + s.doc.hash.slice(0, 16) + "…", false);
    window.print();
  });
  if ($("sign-export-word") && !$("sign-export-word-en")) {
    const ben = document.createElement("button");
    ben.id = "sign-export-word-en";
    ben.textContent = "تصدير Word (قالب EN)";
    ben.style.cssText = "margin-inline-start:.5rem;";
    $("sign-export-word").insertAdjacentElement("afterend", ben);
    ben.addEventListener("click", async () => {
      const s = await signCurrent();
      if (!s) return;
      const bytes = buildDocxReportEn(current, s.draft, { signer: s.signer, license: s.license, org: s.org, at: s.doc.at, hash: s.doc.hash }, readComposer());
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const el = document.createElement("a");
      el.href = URL.createObjectURL(blob);
      el.download = "rrai-report-EN-" + safeFilePart(current.patient) + ".docx";
      document.body.appendChild(el);
      el.click();
      setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 400);
      setStatus("نزل القالب الإنجليزي " + el.download + " — افتحه في WPS Office Lite؛ البصمة: " + s.doc.hash.slice(0, 16) + "…", false);
    });
  }
  $("sign-export-word").addEventListener("click", async () => {
    const s = await signCurrent();
    if (!s) return;
    const bytes = buildDocxReport(current, s.draft, { signer: s.signer, license: s.license, org: s.org, at: s.doc.at, hash: s.doc.hash });
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = "rrai-report-" + safeFilePart(current.patient) + ".docx";
    document.body.appendChild(el);
    el.click();
    setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 400);
    setStatus("نزل " + el.download + " — إن لم يفتح على الهاتف فنقله لحاسوب فيه Word أو افتح نسخة PDF للعرض؛ البصمة: " + s.doc.hash.slice(0, 16) + "…", false);
  });
}

/* ---- v1.0.3 measure suite UI ---- */
function setupMeasureUI() {
  const m = $("measure");
  if (!m || $("measure-mode")) return;
  const sel = document.createElement("select");
  sel.id = "measure-mode";
  sel.className = "ghost";
  sel.style.padding = ".3rem .4rem";
  for (const [v, t] of [["seg", "قطع"], ["angle", "زاوية"], ["roi", "ROI"]]) {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  sel.onchange = () => { mMode = sel.value; mPts = []; drawOverlay(); measureOut(); };
  const clr = document.createElement("button");
  clr.className = "ghost";
  clr.id = "measure-clear";
  clr.textContent = "مسح القياسات";
  clr.onclick = () => { mItems = { segments: [], angles: [], rois: [] }; mPts = []; commitMeasurements(); drawOverlay(); measureOut(); };
  m.parentNode.insertBefore(sel, m.nextSibling);
  m.parentNode.insertBefore(clr, sel.nextSibling);
}
