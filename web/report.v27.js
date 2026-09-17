/* Radiology report AI — bilingual (AR/EN) structured report draft.
   Decision-support only: every draft states it requires radiologist review. */

function meanStd(data) {
  let s = 0, s2 = 0;
  const n = data.length;
  for (let i = 0; i < n; i++) { const v = data[i]; s += v; s2 += v * v; }
  const m = s / n;
  return { m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
}

/* Coarse 2x2 quadrant analysis of the inner field (skip borders). */
function quadrants(pixels) {
  const { w, h, data } = pixels;
  const q = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  const x0 = Math.floor(w * 0.15), x1 = Math.floor(w * 0.85);
  const y0 = Math.floor(h * 0.15), y1 = Math.floor(h * 0.85);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y < (y0 + y1) / 2 ? 0 : 2) + (x < (x0 + x1) / 2 ? 0 : 1);
      q[i] += data[y * w + x]; cnt[i]++;
    }
  }
  return q.map((v, i) => v / Math.max(1, cnt[i]));
}

const QUAD_AR = ["الأيسر العلوي", "الأيمن العلوي", "الأيسر السفلي", "الأيمن السفلي"];
const QUAD_EN = ["upper-left", "upper-right", "lower-left", "lower-right"];

import { sha256Text } from "./consult.v23.js";

export function draftReport(study) {
  const px = study.frames[0];
  const { m, sd } = meanStd(px.data);
  const qs = quadrants(px);
  const qMean = qs.reduce((a, b) => a + b, 0) / 4;
  let bi = 0;
  for (let i = 1; i < 4; i++) if (qs[i] > qs[bi]) bi = i;
  const focal = study.triage && study.triage.priority === "urgent";
  const slices = study.frames.length;
  const modality = study.modality || "CR";
  const patient = study.patient || "—";

  const ar = [
    "مسودة تقرير أشعة — توليد آلي لدعم القرار فقط",
    `المريض: ${patient} | النوع: ${modality} | الشرائح: ${slices}`,
    focal
      ? `الانطباع: ظل بؤري عالي الكثافة يرجَّح أنه آفة، يتمركز في الربع ${QUAD_AR[bi]} من الحقل الداخلي (متوسط كثافة الربع ${Math.round(qs[bi])} مقابل ${Math.round(qMean)} لمتوسط الحقول). الأولوية: حرجة.`
      : `الانطباع: لا يبرز ظل بؤري عالي الكثافة في الحقول الأربعة (أعلى ربع ${Math.round(qs[bi])} مقابل متوسط ${Math.round(qMean)})؛ النمط ضمن الحدود الروتينية. الأولوية: روتينية.`,
    `مؤشر الفرز الآلي: ${study.triage ? study.triage.score.toFixed(4) : "—"} (عتبة الحرج ≥ 0.01).`,
    `سياق الفرز: ${study.triage?.context || "unknown"} — ${(study.triage?.reasons || []).join("؛ ")}.`,
    ...(study.docHash ? [`بصمة آخر توقيع: ${String(study.docHash).slice(0, 16)}…`] : []),
    ...((study.measurements?.segments || []).map((s, i) => `قياس ${i + 1}: ${s.mm != null ? s.mm.toFixed(1) + " مم" : s.px.toFixed(0) + " بكسل"}`)),
    ...((study.measurements?.angles || []).map((g, i) => `زاوية ${i + 1}: ${g.deg.toFixed(1)}°`)),
    ...((study.measurements?.rois || []).map((ro, i) => `ROI ${i + 1}: متوسط ${ro.mean.toFixed(1)} ${ro.unit} (σ ${ro.std.toFixed(1)}، n=${ro.n})`)),
    ...(study.consult ? [`استشارة واردة من ${study.consult.from}: ${study.consult.note || "—"}`] : []),
    ...(study.consultReply ? [`رد المستشار ${study.consultReply.actor}: ${study.consultReply.note || "—"}`] : []),
    ...((study.consultLog || []).map((l) => `سجل: ${l.action} بواسطة ${l.actor} @ ${l.at}`)),
    study.signedBy ? `الاعتماد: مسجلة بتوقيع ${study.signedBy}.` : "",
    "التوصية: مراجعة أخصائي الأشعة واعتماد التقرير النهائي — هذه المسودة ليست تشخيصًا.",
  ].filter(Boolean).join("\n");

  const en = [
    "Radiology report draft — AI-generated, decision support only",
    `Patient: ${patient} | Modality: ${modality} | Slices: ${slices}`,
    focal
      ? `Impression: focal high-density opacity suggestive of a lesion, centered in the ${QUAD_EN[bi]} quadrant of the inner field (quadrant mean ${Math.round(qs[bi])} vs field mean ${Math.round(qMean)}). Triage priority: urgent.`
      : `Impression: no dominant focal high-density opacity across the four quadrants (max quadrant ${Math.round(qs[bi])} vs mean ${Math.round(qMean)}); pattern within routine limits. Triage priority: routine.`,
    `Automated triage score: ${study.triage ? study.triage.score.toFixed(4) : "—"} (urgent threshold >= 0.01).`,
    `Triage context: ${study.triage?.context || "unknown"} — ${(study.triage?.reasons || []).join("; ")}.`,
    study.signedBy ? `Sign-off: recorded under ${study.signedBy}.` : "",
    "Recommendation: radiologist review and sign-off required — this draft is not a diagnosis.",
  ].filter(Boolean).join("\n");

  return { ar, en };
}


export async function signedDocHash(study, draft, o) {
  const canon = JSON.stringify({
    uid: study.uid, patient: study.patient, modality: study.modality,
    ar: draft.ar, en: draft.en, signer: o.signer || "", license: o.license || "", at: o.at,
  });
  return sha256Text(canon);
}

/* ---- v1.0.1 signed document (print/PDF, offline, no libs) ---- */
export async function buildSignedDocument(study, draft, opts) {
  const o = opts || {};
  const at = o.at || new Date().toISOString();
  const org = o.org || { ar: "مؤسسة صحية", en: "Health Facility" };
  const signer = o.signer || "";
  const license = o.license || "";
  const hash = await signedDocHash(study, draft, { signer, license, at });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
  const consultLines = [
    ...(study.consult ? [`استشارة واردة من ${study.consult.from}: ${study.consult.note || "—"}`] : []),
    ...(study.consultReply ? [`رد المستشار ${study.consultReply.actor}: ${study.consultReply.note || "—"}`] : []),
    ...((study.consultLog || []).map((l) => `سجل: ${l.action} بواسطة ${l.actor} @ ${l.at}`)),
  ];
  const html = `
<div dir="rtl" lang="ar" style="font-family:system-ui,'Segoe UI',Tahoma,sans-serif;color:#111;padding:24px;">
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0f172a;padding-bottom:10px;">
    <div><div style="font-size:1.3rem;font-weight:700;">${esc(org.ar)}</div>
    <div style="font-size:.85rem;color:#444;" dir="ltr">${esc(org.en)}</div></div>
    <div style="text-align:left;font-size:.8rem;color:#333;">Radiology report AI<br/>نظام دعم قرار — ليس تشخيصًا نهائيًا</div>
  </div>
  <h2 style="margin:14px 0 6px;">تقرير تصوير شعاعي موقّع</h2>
  <table style="width:100%;border-collapse:collapse;font-size:.9rem;" cellpadding="6">
    <tr><td style="border:1px solid #999;"><b>المريض</b></td><td style="border:1px solid #999;">${esc(study.patient)}</td>
        <td style="border:1px solid #999;"><b>Modality</b></td><td style="border:1px solid #999;">${esc(study.modality)}</td></tr>
    <tr><td style="border:1px solid #999;"><b>معرّف الدراسة</b></td><td style="border:1px solid #999;" dir="ltr">${esc(study.uid)}</td>
        <td style="border:1px solid #999;"><b>الشرائح</b></td><td style="border:1px solid #999;">${(study.frames || []).length}</td></tr>
    <tr><td style="border:1px solid #999;"><b>الفرز الآلي</b></td><td style="border:1px solid #999;">${esc(study.triage?.priority || "-")} / ${esc(study.triage?.context || "-")}</td>
        <td style="border:1px solid #999;"><b>تاريخ التوقيع</b></td><td style="border:1px solid #999;" dir="ltr">${esc(at)}</td></tr>
  </table>
  <h3 style="margin:12px 0 4px;">نص التقرير (عربي)</h3>
  <pre style="white-space:pre-wrap;border:1px solid #bbb;padding:10px;font-family:inherit;">${esc(draft.ar)}</pre>
  <h3 style="margin:12px 0 4px;" dir="ltr">Report (English)</h3>
  <pre dir="ltr" style="white-space:pre-wrap;border:1px solid #bbb;padding:10px;font-family:inherit;">${esc(draft.en)}</pre>
  ${consultLines.length ? `<h3 style="margin:12px 0 4px;">سجل الاستشارة والتدقيق</h3><ul style="font-size:.85rem;">${consultLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
  <div style="margin-top:22px;border:2px solid #0f172a;padding:12px;">
    <div style="font-weight:700;">التوقيع الإلكتروني السريري</div>
    <div style="margin-top:6px;">الاسم: <b>${esc(signer)}</b> ${license ? ` — الترخيص: <b>${esc(license)}</b>` : ""}</div>
    <div>بصفتي الطبيب المسؤول أقرّ بمراجعة الصور وهذا التقرير واعتماده.</div>
    <div style="margin-top:8px;font-size:.8rem;" dir="ltr">Document SHA-256: ${hash}</div>
  </div>
  <div style="margin-top:12px;font-size:.75rem;color:#555;">
    هذا المستند ناتج عن نظام دعم قرار؛ المسؤولية السريرية النهائية للطبيب الموقّع.
    Decision-support output; final clinical responsibility rests with the signing physician.
  </div>
</div>`;
  return { html, hash, at };
}
