/* Radiology report AI — browser-only worklist, triage and viewer. */
import { parseDicom } from "./dicom.v16.js";
import { draftReport } from "./report.v16.js";
import { decodeCompressed } from "./codecs/decode.v16.js";

const APP_BUILD = "v16";

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
            'تحديث متاح (' + m[1] + '): <a href="?v=' + m[1] + '" style="color:var(--accent)">افتح النسخة المحدثة الآن</a> أو امسح بيانات الموقع من إعدادات Chrome.';
        }
      }
    })
    .catch(() => {});
}

const DB_NAME = "rrai";
const STORE = "studies";
let db = null;
let current = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "uid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  const t = db.transaction(STORE, mode);
  return fn(t.objectStore(STORE));
}

function allStudies() {
  return new Promise((resolve) => {
    const req = tx("readonly", (s) => s.getAll());
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function putStudy(study) {
  return new Promise((resolve) => {
    const req = tx("readwrite", (s) => s.put(study));
    req.onsuccess = resolve;
    req.onerror = resolve;
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
      frames, triage: triage(frames[0]), created: Date.now(),
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
  if ((file.name || "").toLowerCase().endsWith(".zip")) return await unzipDicom(buf);
  return [{ name: file.name, bytes: buf }];
}

/* ---- ingest uploaded files ---- */
export async function ingestFiles(fileList) {
  const groups = new Map();
  let skipped = 0;
  for (const file of fileList) {
    const entries = await buffersFromFile(file);
    if ((file.name || "").toLowerCase().endsWith(".zip") && entries.length === 0) { skipped++; continue; }
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
          frames: [],
          created: Date.now(),
          compressedSrc: parsed.compressed || null,
        });
      }
      groups.get(parsed.studyUid).frames.push(px);
    }
  }
  for (const study of groups.values()) {
    study.triage = triage(study.frames[0]);
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
  canvas.width = w;
  canvas.height = h;
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
    }
    if (hi <= lo) hi = lo + 1;
    const invert = photometric === "MONOCHROME1";
    for (let i = 0; i < w * h; i++) {
      let v = (d[i] - lo) / (hi - lo);
      v = Math.max(0, Math.min(1, v));
      if (invert) v = 1 - v;
      const g = Math.round(v * 255);
      img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---- viewer interaction: zoom / pan / measure ---- */
let vk = 1, vx = 0, vy = 0, measureMode = false, mPts = [];
function applyView() {
  $("vwrap").style.transform = `translate(${vx}px, ${vy}px) scale(${vk})`;
}
function resetView(fit) {
  const f = current && current.frames[Number($("slice").value || 0)];
  vk = fit && f ? Math.max(1, Math.min(4, ($("viewport").clientWidth || f.w) / f.w)) : 1;
  vx = 0; vy = 0;
  applyView();
}
function imgPoint(e) {
  const r = $("vwrap").getBoundingClientRect();
  return [(e.clientX - r.left) / vk, (e.clientY - r.top) / vk];
}
function centerOn(ix, iy) {
  const vr = $("viewport").getBoundingClientRect();
  const r = $("vwrap").getBoundingClientRect();
  vx += vr.left + vr.width / 2 - (r.left + ix * vk);
  vy += vr.top + vr.height / 2 - (r.top + iy * vk);
  applyView();
}
function drawOverlay() {
  const ov = $("overlay");
  const ctx = ov.getContext("2d");
  ctx.clearRect(0, 0, ov.width, ov.height);
  if (!mPts.length) return;
  ctx.strokeStyle = "#38bdf8"; ctx.fillStyle = "#38bdf8"; ctx.lineWidth = 1.5;
  for (const [x, y] of mPts) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
  if (mPts.length === 2) {
    ctx.beginPath(); ctx.moveTo(mPts[0][0], mPts[0][1]); ctx.lineTo(mPts[1][0], mPts[1][1]); ctx.stroke();
  }
}
function measureOut() {
  const out = $("measure-out");
  if (!out) return;
  if (mPts.length === 2 && current) {
    const px = Math.hypot(mPts[1][0] - mPts[0][0], mPts[1][1] - mPts[0][1]);
    const sp = current.frames[Number($("slice").value)] && current.frames[Number($("slice").value)].spacing;
    out.textContent = sp
      ? "المسافة: " + (px * sp[0]).toFixed(1) + " مم (" + px.toFixed(0) + " بكسل)"
      : "المسافة: " + px.toFixed(0) + " بكسل";
  } else {
    out.textContent = measureMode ? "انقر نقطتين على الصورة" : "";
  }
}

/* ---- UI wiring ---- */
const $ = (id) => document.getElementById(id);

export async function refresh() {
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
    tr.children[0].textContent = s.patient + (s.signedBy ? " ✔" : "");
    tr.children[1].textContent = s.modality;
    const badge = document.createElement("span");
    const priority = s.triage?.priority || "routine";
    badge.className = "badge " + priority;
    badge.textContent = priority === "urgent" ? "حرج" : "روتيني";
    tr.children[2].appendChild(badge);
    tr.children[3].textContent = s.frames.length;
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = "عرض";
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
  $("slice").max = Math.max(0, study.frames.length - 1);
  $("slice").value = 0;
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
  cvF.style.width = "100%";
  cvF.style.height = "auto";
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
  ov.width = current.frames[idx].w;
  ov.height = current.frames[idx].h;
  $("viewport").style.display = "block";
  mPts = [];
  drawOverlay();
  measureOut();
  resetView(true);
  $("meta").textContent =
    `${current.patient} • ${current.modality} • شريحة ${idx + 1} من ${current.frames.length} • ${current.description || ""}`;
  const st = frameStats(f0);
  $("meta").textContent += " • [" + st.min + "-" + st.max + "]";
  if (drawErr) $("meta").textContent += " • خطأ رسم: " + drawErr;
  $("meta").textContent += " • حجم=" + cvF.clientWidth + "x" + cvF.clientHeight + "/" + cvF.width + "x" + cvF.height;
  const cvx = $("frame");
  const c2 = cvx.getContext("2d");
  const sampleMean = () => {
    try {
      const sx = Math.max(0, Math.floor(f0.w / 2) - 2), sy = Math.max(0, Math.floor(f0.h / 2) - 2);
      const sm = c2.getImageData(sx, sy, 4, 4).data;
      let acc = 0;
      for (let i = 0; i < sm.length; i += 4) acc += sm[i];
      return Math.round(acc / (sm.length / 4));
    } catch (e) { return -1; }
  };
  let tag = " • رسم=" + sampleMean();
  if (st.max - st.min >= 2) {
    const m0 = sampleMean();
    if (m0 >= 0 && m0 < 1) {
      const img2 = c2.createImageData(f0.w, f0.h);
      const dd = f0.data, lo2 = st.min, hi2 = st.max;
      const inv = (f0.photometric === "MONOCHROME1");
      for (let i = 0; i < f0.w * f0.h; i++) {
        let v = (dd[i] - lo2) / ((hi2 - lo2) || 1);
        v = Math.max(0, Math.min(1, v));
        if (inv) v = 1 - v;
        const g = (v * 255) | 0;
        img2.data[i * 4] = g; img2.data[i * 4 + 1] = g; img2.data[i * 4 + 2] = g; img2.data[i * 4 + 3] = 255;
      }
      c2.putImageData(img2, 0, 0);
      tag += " • مباشر=" + sampleMean();
    }
  }
  $("meta").textContent += tag;
  if (st.max - st.min < 2 && current.compressedSrc) {
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

export function init() {
  openDb().then(async (d) => {
    db = d;
    await refresh();
  });
  $("slice").addEventListener("input", (e) => show(Number(e.target.value)));
  $("preset").addEventListener("change", () => show(Number($("slice").value)));
  $("upload").addEventListener("click", async () => {
    const input = $("files");
    if (!input.files.length) {
      setStatus("اختر ملفات DICOM أولًا ثم اضغط رفع وتحليل.", true);
      return;
    }
    const r = await ingestFiles(input.files);
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
  $("demo").addEventListener("click", () => seedDemo());
  $("gen-report").addEventListener("click", () => {
    if (!current) return;
    const d = draftReport(current);
    $("report-ar").textContent = d.ar;
    $("report-en").textContent = d.en;
    $("report-ar").style.display = "block";
    $("report-en").style.display = "block";
    $("sign-row").style.display = "flex";
    $("signoff").checked = !!current.signedBy;
    $("signer").value = current.signedBy || "";
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
  $("clear-all").addEventListener("click", async () => {
    if (!confirm("تفريغ القائمة: حذف كل الدراسات من هذا الجهاز؟")) return;
    await txClear();
    current = null;
    await refresh();
  });
  const vp = $("viewport");
  const ptrs = new Map();
  let pinch0 = 0, k0 = 1, moved = false;
  vp.addEventListener("pointerdown", (e) => {
    vp.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
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
      if (pinch0 > 0) { vk = Math.max(0.5, Math.min(8, (k0 * d) / pinch0)); moved = true; applyView(); }
    } else if (ptrs.size === 1 && vk > 1.01) {
      vx += e.clientX - prev[0]; vy += e.clientY - prev[1]; moved = true; applyView();
    } else if (ptrs.size === 1 && Math.hypot(e.clientX - prev[0], e.clientY - prev[1]) > 4) {
      moved = true;
    }
  });
  const vpUp = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = 0;
    if (!moved && measureMode && ptrs.size === 0) {
      const p = imgPoint(e);
      if (mPts.length === 2) mPts = [p]; else mPts.push(p);
      drawOverlay();
      measureOut();
    }
  };
  vp.addEventListener("pointerup", vpUp);
  vp.addEventListener("pointercancel", vpUp);
  vp.addEventListener("dblclick", (e) => {
    if (vk > 1.01) resetView(true);
    else { const pt = imgPoint(e); vk = 3; centerOn(pt[0], pt[1]); }
  });
  $("zoom-reset").addEventListener("click", () => resetView(true));
  $("measure").addEventListener("click", () => {
    measureMode = !measureMode;
    mPts = [];
    drawOverlay();
    measureOut();
    $("measure").style.color = measureMode ? "var(--accent)" : "";
    $("measure").style.borderColor = measureMode ? "var(--accent)" : "";
  });
  checkUpdate();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
}
