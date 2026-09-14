/* Radiology report AI — browser-only worklist, triage and viewer. */
import { parseDicom } from "./dicom.js";
import { draftReport } from "./report.js";

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
      if (!parsed.pixels) { skipped++; continue; }
      if (!groups.has(parsed.studyUid)) {
        groups.set(parsed.studyUid, {
          uid: parsed.studyUid,
          patient: parsed.patientId,
          modality: parsed.modality,
          description: parsed.description,
          frames: [],
          created: Date.now(),
        });
      }
      groups.get(parsed.studyUid).frames.push(parsed.pixels);
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

export function drawFrame(canvas, pixels, preset, photometric) {
  const { w, h } = pixels;
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
    if (win && photometric === "CT") {
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

function show(idx) {
  if (!current) return;
  drawFrame($("frame"), current.frames[idx], $("preset").value, current.modality);
  $("meta").textContent =
    `${current.patient} • ${current.modality} • شريحة ${idx + 1} من ${current.frames.length} • ${current.description || ""}`;
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
        "لم تُضف أي دراسة: الملفات غير مدعومة في هذه النسخة (DICOM مضغوط JPEG2000/JPEG-LS مثلًا) أو لا تحتوي بكسل. الدعم الكامل قادم في v0.3.",
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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
}
