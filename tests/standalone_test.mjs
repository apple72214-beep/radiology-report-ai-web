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
/* v129 — this list used to be typed by hand, and a module added to the app
   (viewer-state, in v124) was never added here: five releases of tests passed
   while one module was never checked and the launcher could not resolve it.
   The list is the payload's own keys now, so a new module cannot be skipped. */
const TOPO = Object.keys(S);
cks(TOPO.length >= 12, "standalone: every module of the build is embedded (" + TOPO.length + " units)");
for (const n of TOPO) cks(typeof S[n] === "string" && S[n].length > 400, "standalone: module " + n + " embedded");
cks(TOPO.indexOf("viewer-state") >= 0, "standalone: the viewer-state module is embedded with the rest");
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
  const leftover = txt.match(/from\s*["']\.\//) || txt.match(/import\(\s*["']\.\//) || txt.match(/["']\.\/(?:codecs\/)?[A-Za-z0-9_-]+\.v\d+\.js["']/);
  cks(!leftover, "standalone: no unresolved relative import in " + n + (leftover ? " (" + leftover[0] + ")" : ""));
  urls[n] = "blob:fake/" + n;
}
cks(!/<\/script>/.test(html.slice(html.indexOf('id="rrai-src"'), html.indexOf("</script>", html.indexOf('id="rrai-src"')))), "standalone: payload cannot break out of script tag");
c("checked " + TOPO.length + " embedded units; 0 network references remain");

/* --- the launcher must be able to assemble EVERY module (v129) -----------
   start.html fetches each module, rewrites its `./<module>.vNNN.js` into a blob
   URL and only then imports it. The order lives in a list called TOPO, and
   viewer-state was never added to it — for five releases the launcher rewrote
   every module except one, and the boot died inside the app with "Failed to
   resolve module specifier './viewer-state.v129.js'", a message that names
   neither the file at fault nor why. Two guards:
     1. TOPO holds every module the app imports, `app` last;
     2. the launcher's own leftover check looks for ANY surviving module path,
        not only one written straight inside `import(...)` — the app imports
        through a variable, which the old check could never see. */
{
  const start = readFileSync(new URL("../start.html", import.meta.url), "utf-8");
  const appSrc = S.app || "";
  const tm = start.match(/const TOPO = \[(.*?)\];/);
  cks(!!tm, "launcher: TOPO list present");
  const names = (tm ? tm[1] : "").match(/"[A-Za-z0-9_-]+"/g).map((s) => s.slice(1, -1));
  const imported = [];
  const rx = /\["([A-Za-z0-9_-]+)", "\.\/(?:codecs\/)?[A-Za-z0-9_-]+\.v\d+\.js"/g;
  let m2;
  while ((m2 = rx.exec(appSrc))) imported.push(m2[1]);
  /* the app does not import itself: TOPO is the app's imports plus the app */
  cks(imported.length >= 10, "launcher: the app's module table was found (" + imported.length + " entries)");
  const missing = imported.filter((n) => names.indexOf(n) < 0);
  cks(missing.length === 0, "launcher: TOPO lists every module the app imports" +
    (missing.length ? " — missing " + missing.join(", ") : ""));
  cks(names.length === imported.length + 1, "launcher: TOPO is exactly the app's imports plus the app itself");
  cks(names.indexOf("app") === names.length - 1, "launcher: the app module is assembled last");
  cks(!/"app"/.test((tm ? tm[1] : "").slice(0, (tm ? tm[1] : "").indexOf('"app"'))),
     "launcher: nothing is assembled after the app");
  cks(start.includes("[A-Za-z0-9_-]+\\.v\\d+\\.js"),
      "launcher: the unresolved-import check covers a module path however it is written");
  c("launcher: TOPO holds " + names.length + " modules, all " + imported.length + " imports resolvable");
}

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
const ui = readFileSync(new URL("../ui.v142.html", import.meta.url), "utf-8");
cks(ui.includes('href="./standalone.html"') && ui.includes('href="./diag.html"'), "ui: permanent standalone + diagnostics links in About");
const dg = readFileSync(new URL("../diag.html", import.meta.url), "utf-8");
cks(dg.includes("raw.githubusercontent") && dg.includes("cdn.jsdelivr.net") && dg.includes("allorigins"), "diag: probes every external origin the launcher depends on");
c("escape hatches wired in launcher, ui and diagnostics");

/* --- an update must never be held back by the old build's own cache (v121) ---
   The launcher is the only file whose length changes with every build, so the
   service worker's byte table called every new launcher "tampered", served the
   cached one, and the device stayed on the old release however often it
   reloaded. Trust a whole launcher that carries a well-formed pinned commit. */
const swx = readFileSync(new URL("../sw.v142.js", import.meta.url), "utf-8");
const appx = readFileSync(new URL("../app.v142.js", import.meta.url), "utf-8");
cks(/const launcherOk = async \(buf, pathname\)/.test(swx), "sw: the launcher has its own check, not just a byte length");
cks(/radiology-report-ai-web@\[0-9a-f\]\{40\}/.test(swx), "sw: a newer launcher is accepted when it carries a pinned commit");
cks(/if \(!launcher \|\| await launcherOk\(buf, url\.pathname\)\)/.test(swx), "sw: a navigation to the launcher uses the new check");
cks(/s\.length < 8000/.test(swx), "sw: a truncated launcher is still refused");
cks(/\.\/start\.html\?u=/.test(appx), "app: the update banner offers a cache-busted launcher");
cks(/location\.replace\(launchUrl\)/.test(appx), "app: after the reload attempts are spent, it hands over to the launcher");
console.log(fails ? "STANDALONE TEST FAIL " + fails : "STANDALONE TEST PASS (with escape hatches)");
process.exit(fails ? 1 : 0);
