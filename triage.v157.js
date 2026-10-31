/* Context-aware triage v1: brain / chest / bone / generic rules.
   Decision-support only — never a diagnosis. Fail-closed: unknown context
   => conservative generic rule with explicit reason. */

export function detectContext(meta) {
  const m = meta || {};
  const txt = ((m.bodyPart || "") + " " + (m.description || "") + " " + (m.seriesDescription || "")).toUpperCase();
  if (/HEAD|BRAIN|CRANI|SKULL|CEREBR|DWARA/.test(txt)) return "brain";
  if (/CHEST|THORAX|LUNG|PORT|CARDI|THORAC/.test(txt)) return "chest";
  if (/KNEE|HIP|WRIST|ELBOW|FEMUR|TIBIA|FIBULA|HUMER|RADIUS|ULNA|FOOT|ANKLE|SHOULDER|SPINE|LIMB|BONE/.test(txt)) return "bone";
  const mod = (m.modality || "").toUpperCase();
  if (mod === "CT" && /AXIAL/.test(txt) && m.bodyPart === undefined) return "unknown";
  return "unknown";
}

function stats(maskVals) {
  const n = maskVals.length || 1;
  let mean = 0;
  for (const v of maskVals) mean += v;
  mean /= n;
  let sd = 0;
  for (const v of maskVals) sd += (v - mean) * (v - mean);
  sd = Math.sqrt(sd / n);
  return { mean, sd, n };
}

export function triage(pixels, meta) {
  const base = { engine: "context-v1", context: "unknown", reasons: [], score: 0, priority: "routine" };
  if (!pixels || pixels.kind !== "gray") return { ...base, reasons: ["ليست صورة رمادية — لا فرز"] };
  const ctx = detectContext(meta);
  const { arr, w, h } = normalize(pixels);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;

  if (ctx === "brain") {
    const vals = [], left = [], right = [];
    let hi = 0, lo = 0, n = 0;
    const rIn = R * 0.62;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / rIn, dy = (y - cy) / rIn;
        if (dx * dx + dy * dy > 1) continue;
        const v = arr[y * w + x];
        vals.push(v); n++;
        if (x < cx) left.push(v); else right.push(v);
      }
    }
    const s = stats(vals);
    const tHi = s.mean + 3 * s.sd, tLo = s.mean - 3 * s.sd;
    for (const v of vals) { if (v > tHi) hi++; else if (v < tLo) lo++; }
    const fracHi = hi / (n || 1), fracLo = lo / (n || 1);
    const mL = stats(left).mean, mR = stats(right).mean;
    const asym = Math.abs(mL - mR) / (s.mean + 1e-9);
    const reasons = [];
    let priority = "routine";
    if (fracHi >= 0.002 && fracHi <= 0.3) { priority = "urgent"; reasons.push("بؤرة عالية الكثافة داخل قحفية — يُشتبه نزف حاد"); }
    if (fracLo >= 0.15) { priority = "urgent"; reasons.push("منطقة واسعة منخفضة الكثافة — يُشتبه وذمة/احتشاء"); }
    if (asym >= 0.12) { priority = "urgent"; reasons.push("عدم تناصف نصفيّ ملحوظ — يُشتبه انزياح خط منتصف"); }
    if (!reasons.length) reasons.push("لا علامة حادة بمعايير الدماغ المتاحة");
    return { score: Math.round(asym * 10000) / 10000, priority, engine: "context-v1", context: ctx, reasons };
  }

  if (ctx === "chest") {
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
    const priority = score >= 0.015 ? "urgent" : "routine";
    const reasons = priority === "urgent"
      ? ["عدم تناظر بين ساحتي الرئتين — يلزم مراجعة عاجلة"]
      : ["ساحتا الرئتين متناظرتان بمعايير الفرز الصدري"];
    return { score: Math.round(score * 10000) / 10000, priority, engine: "context-v1", context: ctx, reasons };
  }

  if (ctx === "bone") {
    return { score: 0, priority: "routine", engine: "context-v1", context: ctx, reasons: ["لا معيار كسور حاد متاح بعد — بروتوكول العظم قيد التطوير (v0.5+)"] };
  }

  /* unknown: conservative generic */
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
  const priority = score >= 0.03 ? "urgent" : "routine";
  const reasons = ["نوع الفحص غير محدد — طُبّقت قاعدة عامة محافظة"];
  return { score: Math.round(score * 10000) / 10000, priority, engine: "context-v1", context: ctx, reasons };
}

function normalize(pixels) {
  const { w, h } = pixels;
  let mn = Infinity, mx = -Infinity;
  const d = pixels.data;
  for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const span = mx - mn || 1;
  const arr = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) arr[i] = (d[i] - mn) / span;
  return { arr, w, h };
}
