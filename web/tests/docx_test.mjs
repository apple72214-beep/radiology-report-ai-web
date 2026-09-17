import { buildDocxReport, crc32 } from "../docx.v26.js";
import { signedDocHash } from "../report.v26.js";
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
console.log(fails ? "DOCX TEST FAIL " + fails : "DOCX TEST PASS (7)");
process.exit(fails ? 1 : 0);
