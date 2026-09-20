import { buildSignedDocument } from "../report.v45.js";
const study = { uid: "S1", patient: "P1", modality: "CT", frames: [{}], triage: { context: "chest", priority: "routine", reasons: ["x"] }, consultLog: [] };
const draft = { ar: "نص التقرير", en: "report text" };
const opts = { signer: "د. أحمد", license: "Y-123", at: "2026-09-17T00:00:00Z", org: { ar: "مستشفى الثورة", en: "Al-Thawra Hospital" } };
let fails = 0;
const d1 = await buildSignedDocument(study, draft, opts);
if (/^[0-9a-f]{64}$/.test(d1.hash)) console.log("PASS hash64"); else { fails++; console.log("FAIL hash", d1.hash); }
if (d1.html.includes("P1") && d1.html.includes("مستشفى الثورة") && d1.html.includes("Al-Thawra") && d1.html.includes(d1.hash)) console.log("PASS content"); else { fails++; console.log("FAIL content"); }
if (d1.html.includes("ليس تشخيصًا") && d1.html.includes("Decision-support")) console.log("PASS disclaimer"); else { fails++; console.log("FAIL disclaimer"); }
const d2 = await buildSignedDocument(study, draft, opts);
if (d2.hash === d1.hash) console.log("PASS deterministic"); else { fails++; console.log("FAIL deterministic"); }
const d3 = await buildSignedDocument(study, draft, { ...opts, signer: "د. آخر" });
if (d3.hash !== d1.hash) console.log("PASS signer-in-hash"); else { fails++; console.log("FAIL signer-hash"); }
const d4 = await buildSignedDocument(study, { ar: "نص معدل", en: "report text" }, opts);
if (d4.hash !== d1.hash) console.log("PASS text-in-hash"); else { fails++; console.log("FAIL text-hash"); }
const d5 = await buildSignedDocument(study, { ar: "<img src=x onerror=alert(1)>", en: "x" }, opts);
if (!d5.html.includes("<img src=x")) console.log("PASS escaped"); else { fails++; console.log("FAIL escape"); }
console.log(fails ? "REPORT TEST FAIL " + fails : "REPORT TEST PASS (7)");
process.exit(fails ? 1 : 0);
