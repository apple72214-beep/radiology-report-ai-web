/* The launcher (start.html) is the page a stuck device opens. It boots the newest
   build whose files it can verify. Two tables drive it:
     known  — which builds to try, newest first
     EXPECT — the per-file char/byte/sha256 a build must match
   Both used to be maintained by string-replacing the old version token with the
   new one, which renamed every historical key to the current build. In a JS
   object literal the LAST duplicate key wins, so the launcher validated the new
   build against hashes from many releases back: every mirror "failed", the page
   fell back to an old build, that build saw a newer release.json and reloaded —
   the update loop the user reported. These assertions keep that from returning. */
import { readFileSync } from "node:fs";

let fails = 0;
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };
const c = (m) => console.log("  " + m);

const W = new URL("../", import.meta.url);
const rd = (f) => readFileSync(new URL(f, W), "utf-8");
const build = JSON.parse(rd("release.json")).build;
const start = rd("start.html");
const man = JSON.parse(rd("integrity." + build + ".json"));

/* ---- 1. EXPECT: exactly one entry, for the current build, hashed from disk ---- */
const keys = [...start.matchAll(/"(v\d+)": \{/g)].map((m) => m[1]);
ck(keys.length === 1, "launcher EXPECT holds exactly one build key (got " + keys.length + ")");
ck(keys[0] === build, "launcher EXPECT is keyed on the current build " + build + " (got " + keys[0] + ")");
let exp = null;
try {
  const i = start.indexOf("const EXPECT = {");
  const j = start.indexOf("};", i);
  exp = JSON.parse(start.slice(start.indexOf("{", i), j + 1));
} catch (e) { /* reported below */ }
ck(exp && Object.keys(exp).length === 1, "EXPECT parses as a single-entry object");
if (exp && exp[build]) {
  let agree = 0;
  for (const n of Object.keys(man.files)) {
    const f = man.files[n], e = exp[build][n];
    if (e && e[0] === f.chars && e[1] === f.bytes && e[2] === f.sha256) agree++;
    else { fails++; console.log("FAIL EXPECT[" + build + "][" + n + "] disagrees with integrity." + build + ".json"); }
  }
  c(agree + " module hashes in the launcher agree with integrity." + build + ".json");
} else {
  fails++; console.log("FAIL EXPECT has no entry for " + build);
}

/* ---- 2. known: de-duplicated, descending, current build first ---- */
const km = start.match(/const known = \[([^\]]*)\]/);
ck(!!km, "start.html declares a known build list");
const known = km ? [...km[1].matchAll(/"(v\d+)"/g)].map((m) => m[1]) : [];
ck(new Set(known).size === known.length, "known list carries no duplicate build (" + known.length + " entries)");
ck(known[0] === build, "known list is headed by the current build " + build);
const nums = known.map((k) => parseInt(k.slice(1), 10));
ck(nums.every((n, i) => i === 0 || nums[i - 1] > n), "known list is strictly descending");
c(known.length + " fallback builds, " + known[0] + " … " + known[known.length - 1]);

/* ---- 3. every fallback the launcher names is one it can still verify ---- */
let missing = 0;
for (const b of known.slice(1)) if (b !== build && !/^v\d+$/.test(b)) missing++;
ck(missing === 0, "every fallback is a well-formed build id");
ck(start.includes('fetch("./integrity." + b + ".json'), "unknown builds are validated from their integrity manifest");
ck(start.includes("cands.sort((x, y) => verL(y) - verL(x))"), "the newest build is always attempted first");

/* ---- 4. the launcher never caches the control files it verifies ---- */
ck(start.includes("?cb=" + '" + Date.now()') || /cb=" \+ Date\.now\(\)/.test(start), "every verified fetch is cache-busted");
ck(/"https:\/\/cdn\.jsdelivr\.net\/gh\/[^@]+@[0-9a-f]{40}\/"/.test(start), "a pinned, immutable fallback origin exists");

/* ---- 5. the app cannot reload itself forever chasing an update ---- */
const app = rd("app." + build + ".js");
ck(/function releaseWatch\(\) \{\n  checkUpdate\(\);/.test(app), "the release watchdog polls instead of recursing into itself");
ck(app.includes("rrai-rw-try-") && app.includes("tries >= 2"), "the auto-reload is capped per version");
ck(app.includes('href="./start.html"'), "once capped, the app hands the device to the launcher");
ck(/indexOf\("rrai-rw-try-"\) === 0/.test(app) && app.includes("localStorage.removeItem"), "retry counters are cleared once the device is current");

/* ---- 6. the roll tooling rebuilds both tables from disk ---- */
const roll = readFileSync(new URL("../tools/roll.py", W), "utf-8");
ck(roll.includes("def fix_launcher("), "roll.py can rebuild the launcher tables");
ck(roll.includes("def known_block(") && roll.includes("def expect_block("), "both tables are generated, never string-appended");
ck(roll.includes('EXPECT holds exactly one entry'), "roll.py --check audits for duplicate build keys");
ck(!/read\(\)\.replace\(old, new\)/.test(roll) || roll.indexOf("fix_launcher(new, exp)") > 0,
   "the roll rebuilds the tables after it rewrites version tokens");

/* ---- 7. the service worker must never serve a stale launcher ---- */
const sw = rd("sw." + build + ".js");
ck(sw.includes('const launcher = /\\/(start|index)\\.html$/'), "the service worker recognises a launcher navigation");
ck(sw.includes('new Request(e.request, { cache: "no-store" })'), "navigations are fetched from the network, not the HTTP cache");
ck(sw.includes('!launcher || okLen(url.pathname'), "a launcher body is checked against this build's byte table");
ck(sw.includes('"?swb=" + Date.now()'), "a stale or poisoned launcher gets one cache-busted retry");
ck(sw.includes('"./standalone.html", "./start.html"'), "offline fallback prefers the self-contained edition");
const lenm = sw.match(/"start\.html": (\d+)/);
ck(!!lenm, "start.html has a trusted byte length in the SW table");
if (lenm) ck(parseInt(lenm[1], 10) === readFileSync(new URL("start.html", W)).length,
             "the SW's start.html length matches the file on disk (" + lenm[1] + ")");
const leni = sw.match(/"index\.html": (\d+)/);
if (leni) ck(parseInt(leni[1], 10) === readFileSync(new URL("index.html", W)).length,
             "the SW's index.html length matches the file on disk");

console.log(fails ? "LAUNCHER TEST FAIL " + fails : "LAUNCHER TEST PASS");
process.exit(fails ? 1 : 0);
