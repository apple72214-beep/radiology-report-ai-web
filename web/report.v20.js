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
