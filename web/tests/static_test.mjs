/* Static wiring guard: catches "patch silently not applied" regressions. */
import fs from "node:fs";
import path from "node:path";
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
for (const tok of ["buildDocxReport", "buildSignedDocument", "signCurrent", "setupSignExport", "setupConsultUI"]) {
  if (!app.includes(tok)) { fails++; console.log("FAIL app missing " + tok); }
}
const imports = [...app.matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]);
for (const f of imports) {
  if (!fs.existsSync(path.join(root, f))) { fails++; console.log("FAIL missing module " + f); }
}
if (!ui.includes('id="sign-extra"') || !ui.includes('id="print-root"')) { fails++; console.log("FAIL ui sign block"); }
console.log(fails ? "STATIC TEST FAIL " + fails : "STATIC TEST PASS (" + build + ", " + needIds.length + " ids wired)");
process.exit(fails ? 1 : 0);
