/* Release tooling: tools/roll.py must exist, cover every drift that once broke
   the update path, and its own --check must pass on this tree. */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

let fails = 0;
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };
const c = (m) => console.log("  " + m);

const rollPy = new URL("../../tools/roll.py", import.meta.url);
ck(existsSync(rollPy), "tools/roll.py exists");
const t = readFileSync(rollPy, "utf-8");

/* substring probes — no regex, so escaping can never hide a real regression */
const probes = [
  ["critical_block(", "rebuilds the whole CRITICAL precache list (current build only)"],
  ["len_block(", "regenerates the LEN table from on-disk bytes"],
  ["importScripts", "keeps sw.js a relay to the current build"],
  ["DECODE_ANCESTOR", "regenerates a vanished codecs/decode.vNN.js"],
  ["self.registration.unregister()", "pills retired service workers"],
  ["make_standalone.py", "rebuilds the single-file edition"],
  ["def fix_launcher(", "rebuilds the launcher known list + EXPECT table from disk"],
  ["def known_block(", "known list is generated, never string-appended"],
  ["def expect_block(", "EXPECT holds one fresh entry for the current build"],
  ["def integrity_builds(", "fallback builds come from the integrity manifests on disk"],
  ["EXPECT holds exactly one entry", "audits the launcher for duplicate build keys"],
  ["integrity.", "writes the integrity manifest"],
  ["const PIN = ", "refreshes the pinned fallback origin"],
];
for (const [needle, what] of probes) ck(t.includes(needle), "roll.py covers: " + what);
ck(existsSync(new URL("../../tools/make_standalone.py", import.meta.url)), "tools/make_standalone.py exists");
c(probes.length + " roll responsibilities asserted");

/* run the checker itself when python3 is available in this environment */
const r = spawnSync("python3", [rollPy.pathname, "--check"], { encoding: "utf-8" });
if (r.error) {
  c("python3 unavailable — drift checker not executed here");
} else {
  for (const line of (r.stdout || "").trim().split("\n")) c("checker: " + line);
  ck(r.status === 0, "python3 tools/roll.py --check reports zero drift");
}

console.log(fails ? "ROLL TEST FAIL " + fails : "ROLL TEST PASS");
process.exit(fails ? 1 : 0);
