import { parseMultipartRelated } from "../dicom.v41.js";
let fails = 0;
const enc = new TextEncoder();
const bnd = "abc123";
const part1 = enc.encode("DICOMPART1");
const part2 = enc.encode("DICOMPART2LONGER");
const body = new Uint8Array([...enc.encode("--" + bnd + "\r\nContent-Type: application/dicom\r\n\r\n"), ...part1, ...enc.encode("\r\n--" + bnd + "\r\nContent-Type: application/dicom\r\n\r\n"), ...part2, ...enc.encode("\r\n--" + bnd + "--\r\n")]);
const parts = parseMultipartRelated(body.buffer, 'multipart/related; type="application/dicom"; boundary=' + bnd);
if (parts.length === 2) console.log("PASS parts-count"); else { fails++; console.log("FAIL parts-count " + parts.length); }
if (parts[0] && new TextDecoder().decode(parts[0]) === "DICOMPART1") console.log("PASS part1-bytes"); else { fails++; console.log("FAIL part1"); }
if (parts[1] && new TextDecoder().decode(parts[1]) === "DICOMPART2LONGER") console.log("PASS part2-bytes"); else { fails++; console.log("FAIL part2"); }
const single = parseMultipartRelated(enc.encode("plain").buffer, "application/octet-stream");
if (single.length === 1 && new TextDecoder().decode(single[0]) === "plain") console.log("PASS no-boundary-passthrough"); else { fails++; console.log("FAIL passthrough"); }
console.log(fails ? "PACS TEST FAIL " + fails : "PACS TEST PASS (4)");
process.exit(fails ? 1 : 0);
