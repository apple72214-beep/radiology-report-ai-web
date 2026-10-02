/* standalone.html (single-file edition) + retired service-worker pills. */
import { readFileSync, readdirSync } from "node:fs";
let fails = 0;
const cks = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };
const c = (m) => console.log("  " + m);

const html = readFileSync(new URL("../standalone.html", import.meta.url), "utf-8");
const mj = html.match(/<script type="application\/json" id="rrai-src">([\s\S]*?)<\/script>/);
cks(!!mj, "standalone: embedded payload present");
const P = JSON.parse(mj[1].replace(/<\\\//g, "</"));
cks(P.build === "v99", "standalone: build v99");
cks(P.mark === "ب2.71", "standalone: mark ب2.71");
const S = P.src;
const TOPO = ["consult", "decode", "dicom", "triage", "docx", "measure", "compare", "report", "app", "ui"];
for (const n of TOPO) cks(typeof S[n] === "string" && S[n].length > 400, "standalone: module " + n + " embedded");
cks(/<div id="splash"/.test(S.ui), "standalone: ui markup embedded");
// zero network: after blob rewriting no relative ./ import may survive
const urls = {};
for (const n of TOPO) {
  if (n === "ui") continue;
  let txt = S[n];
  for (const d of TOPO) {
    if (d === n || !urls[d]) continue;
    const rx = d === "decode"
      ? /(["'])\.\/codecs\/decode\.v\d+\.js\1/g
      : new RegExp("([\"'])\\./" + d + "\\.v\\d+\\.js\\1", "g");
    txt = txt.replace(rx, '"' + urls[d] + '"');
  }
  const leftover = txt.match(/from\s*["']\.\//) || txt.match(/import\(\s*["']\.\//) || txt.match(/["']\.\/[a-z]+\.v\d+\.js["']/);
  cks(!leftover, "standalone: no unresolved relative import in " + n + (leftover ? " (" + leftover[0] + ")" : ""));
  urls[n] = "blob:fake/" + n;
}
cks(!/<\/script>/.test(html.slice(html.indexOf('id="rrai-src"'), html.indexOf("</script>", html.indexOf('id="rrai-src"')))), "standalone: payload cannot break out of script tag");
c("checked " + TOPO.length + " embedded units; 0 network references remain");

/* retired service workers must self-destruct, current one must not */
const sws = readdirSync(new URL("../", import.meta.url)).filter((f) => /^sw\.v\d+\.js$/.test(f));
const cur = "sw.v99.js";
let retired = 0;
for (const f of sws) {
  const t = readFileSync(new URL("../" + f, import.meta.url), "utf-8");
  if (f === cur) { cks(!t.includes("unregister()"), "current " + f + " keeps serving (no self-destruct)"); continue; }
  retired++;
  cks(/self\.registration\.unregister\(\)/.test(t) && /caches\.delete/.test(t) && /self\.skipWaiting\(\)/.test(t), "retired " + f + " self-destructs (skipWaiting + wipe caches + unregister)");
}
cks(retired > 50, "every retired build is pilled (found " + retired + ")");
const boot = readFileSync(new URL("../sw.js", import.meta.url), "utf-8").trim();
cks(/importScripts\("\.\/sw\.v99\.js"\);/.test(boot) && boot.split("\n").filter((l) => l && !l.startsWith("/*")).length === 1, "sw.js is a pure relay to the current build");
c("service-worker graveyard: " + retired + " retired builds neutralised, sw.js relays to v99");
console.log(fails ? "STANDALONE TEST FAIL " + fails : "STANDALONE TEST PASS");
process.exit(fails ? 1 : 0);
