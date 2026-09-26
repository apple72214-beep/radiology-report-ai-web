/* Minimal OOXML (.docx) writer — offline, dependency-free.
   ZIP "store" method + CRC32; opens in Word / LibreOffice / Google Docs. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (9 << 5) | 17;
  const dosTime = (12 << 11) | (0 << 5) | 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(end.buffer), p);
  return out;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function para(text, opts = {}) {
  const jc = opts.align || (opts.ltr ? "left" : "right");
  const shd = opts.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shd}"/>` : "";
  const pPr = `<w:pPr>${opts.ltr ? "" : "<w:bidi/>"}${shd}<w:jc w:val="${jc}"/>${opts.ind ? `<w:ind w:left="${opts.ind}"/>` : ""}${opts.after != null ? `<w:spacing w:after="${opts.after}"/>` : ""}</w:pPr>`;
  const rPr = `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.color ? `<w:color w:val="${opts.color}"/>` : ""}${opts.sz ? `<w:sz w:val="${opts.sz}"/>` : ""}${opts.ltr ? '<w:rtl w:val="0"/>' : ""}</w:rPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}
const NAVY = "1F3864", BLUE = "00008B", BOX = "EBEBEB";
const fmtDate = (d) => (d && /^\d{8}$/.test(d)) ? d.slice(6, 8) + "/" + d.slice(4, 6) + "/" + d.slice(0, 4) : (d || "—");
function paraBold(text, opts = {}) {
  const jc = opts.align || (opts.ltr ? "left" : "right");
  const shd = opts.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shd}"/>` : "";
  const pPr = `<w:pPr>${opts.ltr ? "" : "<w:bidi/>"}${shd}<w:jc w:val="${jc}"/>${opts.ind ? `<w:ind w:left="${opts.ind}"/>` : ""}${opts.after != null ? `<w:spacing w:after="${opts.after}"/>` : ""}</w:pPr>`;
  const rtl = opts.ltr ? '<w:rtl w:val="0"/>' : "";
  const norm = String(text == null ? "" : text).replace(/<anat>(.*?)<\/anat>/g, "**$1**");
  const parts = norm.split(/\*\*(.+?)\*\*/g);
  let runs = "";
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const b = i % 2 ? "<w:b/>" : "";
    runs += `<w:r><w:rPr>${b}${opts.color ? `<w:color w:val="${opts.color}"/>` : ""}${opts.sz ? `<w:sz w:val="${opts.sz}"/>` : ""}${rtl}</w:rPr><w:t xml:space="preserve">${esc(parts[i])}</w:t></w:r>`;
  }
  return `<w:p>${pPr}${runs}</w:p>`;
}
export function documentXmlEn(study, draft, m, comp0) {
  const comp = comp0 || null;
  const compExam = comp && comp.exam ? String(comp.exam).trim() : "";
  const compInd = comp && comp.indication ? String(comp.indication).trim() : "";
  const compF = comp && Array.isArray(comp.findings) ? comp.findings.map((x) => String(x).trim()).filter(Boolean) : null;
  const compI = comp && Array.isArray(comp.impression) ? comp.impression.map((x) => String(x).trim()).filter(Boolean) : null;
  const meta = study.meta || {};
  const modality = study.modality || "CR";
  const exam = [modality, meta.bodyPart || meta.studyDesc || ""].filter(Boolean).join(" of ").replace("of ", (x) => (meta.bodyPart ? " of " : " "));
  const en = String(draft.en || "");
  const impLine = en.split("\n").find((l) => l.startsWith("Impression:")) || "";
  const triageLine = en.split("\n").find((l) => l.startsWith("Automated triage score:")) || "";
  const L = [];
  L.push(para("MEDICAL RADIOLOGY REPORT", { bold: true, sz: 30, color: NAVY, ltr: true, align: "center", after: 240 }));
  L.push(para("Patient Name: " + (meta.patientName || study.patient || "—"), { ltr: true, after: 40 }));
  L.push(para("Sex: " + (meta.sex || "—") + "     Age: " + (meta.age || "—"), { ltr: true, after: 40 }));
  L.push(para("Exam Date: " + fmtDate(meta.studyDate), { ltr: true, after: 40 }));
  L.push(para("Exam: " + (compExam || (meta.bodyPart || meta.studyDesc ? modality + " of the " + (meta.bodyPart || meta.studyDesc) : modality + " study")), { ltr: true, after: 40 }));
  L.push(para("Clinical Indication: " + (compInd || study.indication || study.triage?.context || "—") + ".", { ltr: true, after: 200 }));
  L.push(para("TECHNIQUE:", { bold: true, color: BLUE, ltr: true, after: 60 }));
  L.push(para(compExam ? compExam + " performed per the department standard protocol" + (/contrast/i.test(compExam) ? " with intravenous contrast." : " without intravenous contrast unless otherwise recorded.") + " Sequences and protocol per department standard; to be completed by the reporting physician if required." : (meta.studyDesc || modality + " examination") + " of the " + (meta.bodyPart || "region of interest") + " performed without intravenous contrast unless otherwise recorded. Sequences and protocol per department standard; to be completed by the reporting physician if required.", { ltr: true, after: 200 }));
  L.push(para("FINDINGS:", { bold: true, color: BLUE, ltr: true, after: 60 }));
  if (compF && compF.length) {
    for (const l of compF.filter((x, i) => x !== compF[i - 1])) L.push(paraBold(l, { ltr: true, after: 60 }));
  } else {
    for (const l of en.split("\n")) {
      if (l.startsWith("Impression:") || l.startsWith("Automated triage") || l.startsWith("Radiology report draft") || l.startsWith("Patient:") || l.startsWith("Recommendation:") || l.startsWith("Sign-off:")) continue;
      if (l.trim()) L.push(para(l, { ltr: true, after: 60 }));
    }
    if (impLine) L.push(para(impLine.replace("Impression: ", ""), { ltr: true, after: 60 }));
  }
  for (const s of (study.measurements?.segments || [])) L.push(para("Measurement: segment " + (s.mm != null ? s.mm.toFixed(1) + " mm" : s.px.toFixed(0) + " px") + ".", { ltr: true, after: 40 }));
  for (const g of (study.measurements?.angles || [])) L.push(para("Measurement: angle " + g.deg.toFixed(1) + " degrees.", { ltr: true, after: 40 }));
  for (const r of (study.measurements?.rois || [])) L.push(para("Measurement: ROI mean " + r.mean.toFixed(1) + " " + r.unit + " (SD " + r.std.toFixed(1) + ", n=" + r.n + ").", { ltr: true, after: 40 }));
  if (study.compare) L.push(para("Comparison with prior study " + (study.compare.patient || study.compare.uid) + ": mean absolute difference " + Number(study.compare.meanAbs).toFixed(3) + ", hot spots " + Number(study.compare.pctHot).toFixed(1) + "% (threshold 0.25 after normalization).", { ltr: true, after: 200 }));
  L.push(para("IMPRESSION:", { bold: true, color: BLUE, ltr: true, after: 60 }));
  const bullets = [];
  if (compI && compI.length) { for (const l of compI.filter((x, i) => x !== compI[i - 1])) bullets.push(l); }
  else {
  if (impLine) bullets.push(impLine.replace("Impression: ", "").split(". Triage priority")[0] + ".");
  if (triageLine) bullets.push(triageLine);
  }
  if (study.compare) bullets.push("Comparison performed with " + (study.compare.patient || study.compare.uid) + " as recorded above.");
  bullets.push("Recommendation: radiologist review and sign-off required — this draft is not a diagnosis.");
  for (let bi2 = 0; bi2 < bullets.length; bi2++) L.push(para("• " + bullets[bi2], { ltr: true, shd: BOX, ind: 227, after: bi2 === bullets.length - 1 ? 200 : 0 }));
  L.push(para("", { ltr: true, after: 300 }));
  L.push(para("Reported by:", { ltr: true, align: "right", after: 20 }));
  L.push(para(m.signer || "—", { bold: true, ltr: true, align: "right", after: 20 }));
  L.push(para((m.license ? "License: " + m.license + " — " : "") + "Consultant Radiologist", { ltr: true, align: "right", color: "595959", sz: 20, after: 120 }));
  L.push(para("Document SHA-256: " + m.hash, { ltr: true, sz: 16, color: "808080", after: 20 }));
  L.push(para("Signed at: " + m.at + " — Decision-support output; final clinical responsibility rests with the signing physician.", { ltr: true, sz: 16, color: "808080" }));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${L.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:marG w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/></w:sectPr></w:body></w:document>`;
}
export function buildDocxReportEn(study, draft, m, comp) {
  const enc = new TextEncoder();
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rl = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const st = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(ct) },
    { name: "_rels/.rels", data: enc.encode(rl) },
    { name: "word/document.xml", data: enc.encode(documentXmlEn(study, draft, m, comp)) },
    { name: "word/styles.xml", data: enc.encode(st) },
  ]);
}

export function documentXml(study, draft, m) {
  const lines = [
    para(m.org.ar || "مؤسسة صحية", { bold: true, sz: 32 }),
    para(m.org.en || "Health Facility", { ltr: true, sz: 20 }),
    para("تقرير تصوير شعاعي موقّع — نظام دعم قرار، ليس تشخيصًا نهائيًا", { bold: true, sz: 24 }),
    para(`المريض: ${study.patient}   النوع: ${study.modality}   الشرئح: ${(study.frames || []).length}`),
    para(`معرّف الدراسة: ${study.uid}`, { ltr: true }),
    para(`الفرز الآلي: ${study.triage?.priority || "-"} / ${study.triage?.context || "-"}`),
    para(`تاريخ التوقيع: ${m.at}`, { ltr: true }),
    para("نص التقرير (عربي):", { bold: true }),
  ];
  for (const l of String(draft.ar || "").split("\n")) lines.push(para(l));
  lines.push(para("Report (English):", { bold: true, ltr: true }));
  for (const l of String(draft.en || "").split("\n")) lines.push(para(l, { ltr: true }));
  if (study.consult) lines.push(para(`استشارة واردة من ${study.consult.from}: ${study.consult.note || "—"}`));
  if (study.consultReply) lines.push(para(`رد المستشار ${study.consultReply.actor}: ${study.consultReply.note || "—"}`));
  for (const l of (study.consultLog || [])) lines.push(para(`سجل: ${l.action} بواسطة ${l.actor} @ ${l.at}`, { sz: 18 }));
  lines.push(para("التوقيع الإلكتروني السريري", { bold: true, sz: 26 }));
  lines.push(para(`الاسم: ${m.signer}${m.license ? "   الترخيص: " + m.license : ""}`));
  lines.push(para("أقرّ بصفتي الطبيب المسؤول بمراجعة الصور واعتماد هذا التقرير."));
  lines.push(para("Document SHA-256: " + m.hash, { ltr: true, sz: 18 }));
  lines.push(para("Decision-support output; final clinical responsibility rests with the signing physician.", { ltr: true, sz: 18 }));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:marG w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/></w:sectPr></w:body></w:document>`;
}

export function buildDocxReport(study, draft, m) {
  const enc = new TextEncoder();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Segoe UI"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc("تقرير تصوير شعاعي موقّع — " + study.patient)}</dc:title><dc:creator>${esc(m.signer || "")}</dc:creator><cp:lastModifiedBy>${esc(m.signer || "")}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${esc(m.at || "")}</dcterms:created></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Radiology report AI</Application><AppVersion>1.0</AppVersion></Properties>`;
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "word/document.xml", data: enc.encode(documentXml(study, draft, m)) },
    { name: "word/styles.xml", data: enc.encode(styles) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
    { name: "docProps/core.xml", data: enc.encode(core) },
    { name: "docProps/app.xml", data: enc.encode(app) },
  ]);
}
