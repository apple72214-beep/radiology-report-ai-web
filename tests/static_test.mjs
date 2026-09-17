/* Static wiring guard: catches "patch silently not applied" + module parse regressions. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const build = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8")).build;
let fails = 0;
const app = fs.readFileSync(path.join(root, `app.${build}.js`), "utf8");
const ui = fs.readFileSync(path.join(root, `ui.${build}.html`), "utf8");
const needIds = ["slice","preset","upload","files","demo","gen-report","report-ar","report-en","sign-row","signoff","signer","copy-report","clear-all","worklist","measure","zoom-reset","frame","sign-extra","signer-license","sign-export","sign-export-word","org-save","org-ar","org-en","print-root"];
for (const id of needIds) {
  if (!ui.includes(`id="${id}"`)) { fails++; console.log("FAIL ui missing #" + id); }
  if (!app.includes(`$("${id}")`) && !app.includes(`#${id}`)) { fails++; console.log("FAIL app never refs #" + id); }
}
for (const tok of ["buildDocxReport", "buildSignedDocument", "signCurrent", "setupSignExport", "setupConsultUI", "setupCompareUI", "loadAllModules"]) {
  if (!app.includes(tok)) { fails++; console.log("FAIL app missing " + tok); }
}
/* ES-module parse check exactly like the browser linker does */
const tmp = path.join(os.tmpdir(), `rrai-app-${build}.mjs`);
fs.writeFileSync(tmp, app);
const chk = spawnSync(process.execPath, ["--check", tmp]);
if (chk.status !== 0) { fails++; console.log("FAIL module parse:\n" + chk.stderr.toString().slice(0, 600)); } else console.log("PASS module-parse " + build);
console.log(fails ? "STATIC TEST FAIL " + fails : "STATIC TEST PASS (" + build + ", " + needIds.length + " ids wired)");
process.exit(fails ? 1 : 0);
