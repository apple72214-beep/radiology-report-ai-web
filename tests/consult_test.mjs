import { buildPackage, validatePackage } from "../consult.v19.js";
const study = { uid: "S1", patient: "P1", modality: "CT", description: "CHEST", bodyPart: "CHEST", frames: [{ w: 4, h: 4 }] };
let fails = 0;
const pkg = await buildPackage({ study, actor: "Dr A", note: "؟", triage: { priority: "urgent" }, reportText: "ت", measurePts: [], snapshotPng: "data:image/png;base64,x" });
const v1 = await validatePackage(pkg);
if (v1.ok && v1.hashOk) console.log("PASS roundtrip"); else { fails++; console.log("FAIL roundtrip", v1); }
const tampered = JSON.parse(JSON.stringify(pkg));
tampered.payload.note = "عبث";
const v2 = await validatePackage(tampered);
if (!v2.ok && !v2.hashOk) console.log("PASS tamper-detect"); else { fails++; console.log("FAIL tamper", v2); }
const bad = { schema: "evil/1", payload: {}, hash: "x" };
const v3 = await validatePackage(bad);
if (!v3.ok) console.log("PASS schema-reject"); else { fails++; console.log("FAIL schema"); }
const reply = await buildPackage({ reply: true, actor: "Dr B", note: "موافق", refUid: "S1", refHash: pkg.hash });
const v4 = await validatePackage(reply);
if (v4.ok && v4.isReply) console.log("PASS reply"); else { fails++; console.log("FAIL reply", v4); }
const replyNoRef = await buildPackage({ reply: true, actor: "Dr B", note: "x" });
const v5 = await validatePackage(replyNoRef);
if (!v5.ok) console.log("PASS reply-needs-ref"); else { fails++; console.log("FAIL reply-ref"); }
console.log(fails ? "CONSULT TEST FAIL " + fails : "CONSULT TEST PASS");
process.exit(fails ? 1 : 0);
