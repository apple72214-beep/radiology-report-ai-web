<<<<<<< HEAD
import { buildPackage, validatePackage, sha256FallbackHex } from "../consult.v20.js";
const enc = new TextEncoder();
let fails = 0;
// known SHA-256 vectors for the pure-JS fallback (LAN http:// path)
const vEmpty = sha256FallbackHex(enc.encode(""));
if (vEmpty === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") console.log("PASS sha256('')"); else { fails++; console.log("FAIL sha256('')", vEmpty); }
const vAbc = sha256FallbackHex(enc.encode("abc"));
if (vAbc === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") console.log("PASS sha256('abc')"); else { fails++; console.log("FAIL sha256('abc')", vAbc); }
const vLong = sha256FallbackHex(enc.encode("a".repeat(1000000)));
if (vLong === "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0") console.log("PASS sha256(1M a)"); else { fails++; console.log("FAIL sha256(1M)", vLong); }
// subtle-vs-fallback parity inside buildPackage
const study = { uid: "S1", patient: "P1", modality: "CT", description: "CHEST", bodyPart: "CHEST", frames: [{ w: 4, h: 4 }] };
const pkg = await buildPackage({ study, actor: "Dr A", note: "؟", triage: { priority: "urgent" }, reportText: "ت", measurePts: [], snapshotPng: "data:image/png;base64,x" });
const fb = sha256FallbackHex(enc.encode(JSON.stringify(pkg.payload)));
if (fb === pkg.hash) console.log("PASS subtle==fallback"); else { fails++; console.log("FAIL parity", fb, pkg.hash); }
=======
import { buildPackage, validatePackage } from "../consult.v19.js";
const study = { uid: "S1", patient: "P1", modality: "CT", description: "CHEST", bodyPart: "CHEST", frames: [{ w: 4, h: 4 }] };
let fails = 0;
const pkg = await buildPackage({ study, actor: "Dr A", note: "؟", triage: { priority: "urgent" }, reportText: "ت", measurePts: [], snapshotPng: "data:image/png;base64,x" });
>>>>>>> 1279ccd725a3a521aa73149e42bb421c110e5946
const v1 = await validatePackage(pkg);
if (v1.ok && v1.hashOk) console.log("PASS roundtrip"); else { fails++; console.log("FAIL roundtrip", v1); }
const tampered = JSON.parse(JSON.stringify(pkg));
tampered.payload.note = "عبث";
const v2 = await validatePackage(tampered);
if (!v2.ok && !v2.hashOk) console.log("PASS tamper-detect"); else { fails++; console.log("FAIL tamper", v2); }
<<<<<<< HEAD
const v3 = await validatePackage({ schema: "evil/1", payload: {}, hash: "x" });
if (!v3.ok) console.log("PASS schema-reject"); else { fails++; console.log("FAIL schema"); }
const reply = await buildPackage({ reply: true, actor: "Dr B", note: "موافق", refUid: "S1", refHash: pkg.hash });
const v4 = await validatePackage(reply);
if (v4.ok && v4.isReply && reply.payload.refUid === "S1") console.log("PASS reply+refUid"); else { fails++; console.log("FAIL reply", v4); }
const v5 = await validatePackage(await buildPackage({ reply: true, actor: "Dr B", note: "x" }));
if (!v5.ok) console.log("PASS reply-needs-ref"); else { fails++; console.log("FAIL reply-ref"); }
console.log(fails ? "CONSULT TEST FAIL " + fails : "CONSULT TEST PASS (9)");
=======
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
>>>>>>> 1279ccd725a3a521aa73149e42bb421c110e5946
process.exit(fails ? 1 : 0);
