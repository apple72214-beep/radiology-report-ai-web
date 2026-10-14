/* Teleradiology consultation packages — offline-first, fail-closed.
   schema rrai-consult/1 (referral) and rrai-consult-reply/1 (read-back).
   Integrity: SHA-256 over canonical payload; validator rejects any mismatch. */

const SCHEMA = "rrai-consult/1";
const SCHEMA_REPLY = "rrai-consult-reply/1";

async function sha256(obj) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(obj)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildPackage(input) {
  const payload = {
    schema: input.reply ? SCHEMA_REPLY : SCHEMA,
    createdAt: new Date().toISOString(),
    actor: input.actor || "unknown",
    note: input.note || "",
    study: input.study
      ? {
          uid: input.study.uid,
          patient: input.study.patient,
          modality: input.study.modality,
          description: input.study.description || "",
          bodyPart: input.study.bodyPart || "",
          frames: (input.study.frames || []).map((f) => ({ w: f.w, h: f.h })),
        }
      : null,
    triage: input.triage || null,
    reportText: input.reportText || "",
    measurePts: input.measurePts || [],
    snapshotPng: input.snapshotPng || "",
    refHash: input.refHash || "",
  };
  const hash = await sha256(payload);
  return { schema: payload.schema, hash, payload };
}

export async function validatePackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== "object") return { ok: false, errors: ["الحزمة ليست كائنًا صالحًا"] };
  if (pkg.schema !== SCHEMA && pkg.schema !== SCHEMA_REPLY) errors.push("مخطط غير معروف: " + pkg.schema);
  if (!pkg.payload) errors.push("لا حمولة داخل الحزمة");
  if (!pkg.hash) errors.push("لا بصمة SHA-256");
  let hashOk = false;
  if (pkg.payload && pkg.hash) {
    const h = await sha256(pkg.payload);
    hashOk = h === pkg.hash;
    if (!hashOk) errors.push("البصمة لا تطابق المحتوى — عبث محتمل");
  }
  if (pkg.schema === SCHEMA_REPLY && !pkg.payload?.refHash) errors.push("رد بلا مرجعية");
  return { ok: errors.length === 0, errors, hashOk, isReply: pkg.schema === SCHEMA_REPLY };
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
