/* standalone.html (single-file edition) + retired service-worker pills. */
import { readFileSync, readdirSync } from "node:fs";
let fails = 0;
const cks = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };
const c = (m) => console.log("  " + m);

const html = readFileSync(new URL("../standalone.html", import.meta.url), "utf-8");
const mj = html.match(/<script type="application\/json" id="rrai-src">([\s\S]*?)<\/script>/);
cks(!!mj, "standalone: embedded payload present");
const P = JSON.parse(mj[1].replace(/<\\\//g, "</"));
const rel = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf-8"));
cks(P.build === rel.build, "standalone: build matches release.json (" + rel.build + ")");
cks(P.mark === rel.mark, "standalone: mark matches release.json (" + rel.mark + ")");
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
const cur = "sw." + JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf-8")).build + ".js";
let retired = 0;
for (const f of sws) {
  const t = readFileSync(new URL("../" + f, import.meta.url), "utf-8");
  if (f === cur) { cks(!t.includes("unregister()"), "current " + f + " keeps serving (no self-destruct)"); continue; }
  retired++;
  cks(/self\.registration\.unregister\(\)/.test(t) && /caches\.delete/.test(t) && /self\.skipWaiting\(\)/.test(t), "retired " + f + " self-destructs (skipWaiting + wipe caches + unregister)");
}
cks(retired > 50, "every retired build is pilled (found " + retired + ")");
const boot = readFileSync(new URL("../sw.js", import.meta.url), "utf-8").trim();
cks(boot.includes('importScripts("./sw.' + rel.build + '.js");') && boot.split("\n").filter((l) => l && !l.startsWith("/*")).length === 1, "sw.js is a pure relay to the current build");
c("service-worker graveyard: " + retired + " retired builds neutralised, sw.js relays to v104");
/* the launcher must never dead-end: single-file escape hatch on any boot failure */
for (const f of ["start.html"]) {
  const t = readFileSync(new URL("../" + f, import.meta.url), "utf-8");
  cks(t.includes('id="rrai-solo"') && t.includes('location.replace("./standalone.html?f=1")'), f + ": boot failure offers/auto-opens the single-file edition");
  cks(t.includes("rrai-solo-try") && t.includes("./diag.html"), f + ": escape hatch is once-per-session and points at diagnostics");
}
const ui = readFileSync(new URL("../ui.v121.html", import.meta.url), "utf-8");
cks(ui.includes('href="./standalone.html"') && ui.includes('href="./diag.html"'), "ui: permanent standalone + diagnostics links in About");
const dg = readFileSync(new URL("../diag.html", import.meta.url), "utf-8");
cks(dg.includes("raw.githubusercontent") && dg.includes("cdn.jsdelivr.net") && dg.includes("allorigins"), "diag: probes every external origin the launcher depends on");
c("escape hatches wired in launcher, ui and diagnostics");

/* --- an update must never be held back by the old build's own cache (v121) ---
   The launcher is the only file whose length changes with every build, so the
   service worker's byte table called every new launcher "tampered", served the
   cached one, and the device stayed on the old release however often it
   reloaded. Trust a whole launcher that carries a well-formed pinned commit. */
const swx = readFileSync(new URL("../sw.v121.js", import.meta.url), "utf-8");
const appx = readFileSync(new URL("../app.v121.js", import.meta.url), "utf-8");
cks(/const launcherOk = async \(buf, pathname\)/.test(swx), "sw: the launcher has its own check, not just a byte length");
cks(/radiology-report-ai-web@\[0-9a-f\]\{40\}/.test(swx), "sw: a newer launcher is accepted when it carries a pinned commit");
cks(/if \(!launcher \|\| await launcherOk\(buf, url\.pathname\)\)/.test(swx), "sw: a navigation to the launcher uses the new check");
cks(/s\.length < 8000/.test(swx), "sw: a truncated launcher is still refused");
cks(/\.\/start\.html\?u=/.test(appx), "app: the update banner offers a cache-busted launcher");
cks(/location\.replace\(launchUrl\)/.test(appx), "app: after the reload attempts are spent, it hands over to the launcher");
console.log(fails ? "STANDALONE TEST FAIL " + fails : "STANDALONE TEST PASS (with escape hatches)");
process.exit(fails ? 1 : 0);
