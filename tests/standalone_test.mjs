/* standalone.html (single-file edition) + retired service-worker pills. */
import { readFileSync, readdirSync } from "node:fs";
let fails = 0;
const cks = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };
const c = (m) => console.log("  " + m);

const html = readFileSync(new URL("../standalone.html", import.meta.url), "utf-8");
const mj = html.match(/<script type="application\/json" id="rrai-src">([\s\S]*?)<\/script>/);
cks(!!mj, "standalone: embedded payload present");
const P = JSON.parse(mj[1].replace(/<\\\//g, "</"));
cks(P.build === "v102", "standalone: build v102");
cks(P.mark === "ب2.74", "standalone: mark ب2.74");
const S = P.src;
const TOPO = ["consult", "decode", "dicom", "triage", "docx", "measure", "compare", "report", "mpr", "app", "ui"];
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
const cur = "sw.v102.js";
let retired = 0;
for (const f of sws) {
  const t = readFileSync(new URL("../" + f, import.meta.url), "utf-8");
  if (f === cur) { cks(!t.includes("unregister()"), "current " + f + " keeps serving (no self-destruct)"); continue; }
  retired++;
  cks(/self\.registration\.unregister\(\)/.test(t) && /caches\.delete/.test(t) && /self\.skipWaiting\(\)/.test(t), "retired " + f + " self-destructs (skipWaiting + wipe caches + unregister)");
}
cks(retired > 50, "every retired build is pilled (found " + retired + ")");
const boot = readFileSync(new URL("../sw.js", import.meta.url), "utf-8").trim();
cks(/importScripts\("\.\/sw\.v102\.js"\);/.test(boot) && boot.split("\n").filter((l) => l && !l.startsWith("/*")).length === 1, "sw.js is a pure relay to the current build");
c("service-worker graveyard: " + retired + " retired builds neutralised, sw.js relays to v102");
/* the launcher must never dead-end: single-file escape hatch on any boot failure */
for (const f of ["start.html"]) {
  const t = readFileSync(new URL("../" + f, import.meta.url), "utf-8");
  cks(t.includes('id="rrai-solo"') && t.includes('location.replace("./standalone.html?f=1")'), f + ": boot failure offers/auto-opens the single-file edition");
  cks(t.includes("rrai-solo-try") && t.includes("./diag.html"), f + ": escape hatch is once-per-session and points at diagnostics");
}
const ui = readFileSync(new URL("../ui.v102.html", import.meta.url), "utf-8");
cks(ui.includes('href="./standalone.html"') && ui.includes('href="./diag.html"'), "ui: permanent standalone + diagnostics links in About");
const dg = readFileSync(new URL("../diag.html", import.meta.url), "utf-8");
cks(dg.includes("raw.githubusercontent") && dg.includes("cdn.jsdelivr.net") && dg.includes("allorigins"), "diag: probes every external origin the launcher depends on");
c("escape hatches wired in launcher, ui and diagnostics");
console.log(fails ? "STANDALONE TEST FAIL " + fails : "STANDALONE TEST PASS (with escape hatches)");
process.exit(fails ? 1 : 0);
