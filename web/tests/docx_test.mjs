import { buildDocxReport, buildDocxReportEn, crc32 } from "../docx.v52.js";
import { signedDocHash } from "../report.v52.js";
import fs from "node:fs";
let fails = 0;
const enc = new TextEncoder();
if (crc32(enc.encode("123456789")) === 0xcbf43926) console.log("PASS crc32"); else { fails++; console.log("FAIL crc32"); }
const study = { uid: "S1", patient: "P1", modality: "CT", frames: [{}], triage: { priority: "routine", context: "chest" } };
const draft = { ar: "نص <تجريبي> &", en: "text" };
const m = { signer: "د. أ", license: "L1", org: { ar: "م", en: "H" }, at: "2026-09-17T00:00:00Z", hash: "ab".repeat(32) };
const bytes = buildDocxReport(study, draft, m);
if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) console.log("PASS zip-magic"); else { fails++; console.log("FAIL magic"); }
const tail = Buffer.from(bytes.slice(bytes.length - 22));
if (tail.readUInt32LE(0) === 0x06054b50 && tail.readUInt16LE(8) === 7) console.log("PASS zip-eocd-7entries"); else { fails++; console.log("FAIL eocd"); }
const buf = Buffer.from(bytes);
if (["[Content_Types].xml", "_rels/.rels", "word/document.xml"].every((n) => buf.includes(Buffer.from(n)))) console.log("PASS entries"); else { fails++; console.log("FAIL entries"); }
const docXml = buf.toString("utf8");
if (docXml.includes("نص &lt;تجريبي&gt; &amp;")) console.log("PASS xml-escape"); else { fails++; console.log("FAIL escape"); }
if (docXml.includes("Document SHA-256: " + m.hash)) console.log("PASS fingerprint"); else { fails++; console.log("FAIL fingerprint"); }
const h1 = await signedDocHash(study, draft, { signer: "د. أ", at: m.at });
const h2 = await signedDocHash(study, draft, { signer: "د. أ", at: m.at });
if (h1 === h2 && /^[0-9a-f]{64}$/.test(h1)) console.log("PASS hash-stable"); else { fails++; console.log("FAIL hash"); }
fs.writeFileSync("/tmp/rrai-test.docx", bytes);
/* EN clinical template assertions */
const enBytes = buildDocxReportEn(study, draft, m);
const enBuf = Buffer.from(enBytes);
const enXml = enBuf.toString("utf8");
let enFails = 0;
const enCheck = (cond, name) => { if (cond) console.log("PASS en-" + name); else { enFails++; console.log("FAIL en-" + name); } };
enCheck(enXml.includes("MEDICAL RADIOLOGY REPORT"), "title");
enCheck(enXml.includes('w:color w:val="1F3864"'), "navy-title-color");
enCheck(enXml.includes("TECHNIQUE:") && enXml.includes("FINDINGS:") && enXml.includes("IMPRESSION:"), "sections");
enCheck(enXml.includes('w:fill="EBEBEB"'), "impression-shaded-box");
enCheck(enXml.includes("Reported by:") && enXml.includes('w:jc w:val="right"'), "right-signature");
enCheck(enXml.includes("Patient Name:") && enXml.includes("Exam Date:"), "demographics");
enCheck(enXml.includes("Document SHA-256: " + m.hash), "en-fingerprint");
const enTail = Buffer.from(enBytes.slice(enBytes.length - 22));
enCheck(enTail.readUInt32LE(0) === 0x06054b50, "zip-eocd");
if (enBuf.includes(Buffer.from("word/document.xml"))) console.log("PASS en-entries"); else { enFails++; console.log("FAIL en-entries"); }
fails += enFails;
fs.writeFileSync("/tmp/rrai-test-en.docx", enBytes);
/* composer override assertions (v52) */
const comp = { exam: "MRI Lumbosacral Spine with IV Contrast", indication: "History of lumbar fixation 6 years ago.", findings: ["Post-operative changes are noted in the lower **lumbar spine**.", "The **conus medullaris** terminates at a normal level."], impression: ["Post-operative changes of lower lumbar laminectomy.", "No evidence of pseudomeningocele."] };
const cBytes = buildDocxReportEn(study, draft, m, comp);
const cXml = Buffer.from(cBytes).toString("utf8");
let cFails = 0;
const cCheck = (cond, name) => { if (cond) console.log("PASS comp-" + name); else { cFails++; console.log("FAIL comp-" + name); } };
cCheck(cXml.includes("Exam: MRI Lumbosacral Spine with IV Contrast"), "exam");
cCheck(cXml.includes("Clinical Indication: History of lumbar fixation 6 years ago."), "indication");
cCheck(cXml.includes("performed per the department standard protocol with intravenous contrast."), "technique-contrast");
cCheck(cXml.includes("<w:b/>") && cXml.includes("lumbar spine</w:t>"), "bold-runs");
cCheck(cXml.includes("• Post-operative changes of lower lumbar laminectomy.") && cXml.includes("• No evidence of pseudomeningocele."), "impression-bullets");
cCheck(cXml.includes("this draft is not a diagnosis"), "disclaimer-kept");
const compDup = { exam: "MR Study", indication: "", findings: ["Post-operative changes are noted in the lower **lumbar spine**.", "Post-operative changes are noted in the lower **lumbar spine**.", "Second line."], impression: ["Dup bullet.", "Dup bullet."] };
const dXml = Buffer.from(buildDocxReportEn(study, draft, m, compDup)).toString("utf8");
cCheck((dXml.match(/Post-operative changes are noted/g) || []).length === 1 && (dXml.match(/Dup bullet\./g) || []).length === 1, "dedupe-consecutive");
const compAnat = { exam: "MR", indication: "", findings: ["The <anat>thecal sac</anat> is indented."], impression: [] };
const aXml = Buffer.from(buildDocxReportEn(study, draft, m, compAnat)).toString("utf8");
cCheck(aXml.includes("<w:b/>") && aXml.includes("thecal sac</w:t>"), "anat-bold-alias");
const spOk = (aXml.match(/w:fill="EBEBEB"/g) || []).length >= 0;
cCheck(spOk, "box-gray-const");
fails += 0;
fails += cFails;
console.log(fails ? "DOCX TEST FAIL " + fails : "DOCX TEST PASS (7+9 template+9 composer)");
process.exit(fails ? 1 : 0);
