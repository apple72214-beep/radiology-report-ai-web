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
const needIds = ["slice","preset","upload","files","demo","gen-report","report-ar","report-en","sign-row","signoff","signer","copy-report","clear-all","worklist","measure","zoom-reset","frame","sign-extra","signer-license","sign-export","sign-export-word","org-save","org-ar","org-en","print-root", "lang-toggle", "pacs-url", "pacs-pull", "pacs-dl", "pacs-dl-url", "lbl-dl-url", "pacs-dl-hint", "files-dir", "pick-dir", "pick-hint", "rep-exam", "rep-indication", "rep-findings", "rep-impression", "ai-key", "ai-gen"];
for (const id of needIds) {
  if (!ui.includes(`id="${id}"`)) { fails++; console.log("FAIL ui missing #" + id); }
  if (!app.includes(`$("${id}")`) && !app.includes(`#${id}`) && !app.includes(`"${id}":`)) { fails++; console.log("FAIL app never refs #" + id); }
}
for (const tok of ["buildDocxReport", "buildSignedDocument", "signCurrent", "setupSignExport", "setupConsultUI", "setupCompareUI", "loadAllModules", "applyLang", "buildDocxReportEn", "parseMultipartRelated", "setupPacs", "normalizeDownloadUrl", "examNameFor", "prefillComposer", "setupComposer", "aiRequestFor"]) {
  if (!app.includes(tok)) { fails++; console.log("FAIL app missing " + tok); }
}
/* ES-module parse check exactly like the browser linker does */
const tmp = path.join(os.tmpdir(), `rrai-app-${build}.mjs`);
fs.writeFileSync(tmp, app);
const chk = spawnSync(process.execPath, ["--check", tmp]);
if (chk.status !== 0) { fails++; console.log("FAIL module parse:\n" + chk.stderr.toString().slice(0, 600)); } else console.log("PASS module-parse " + build);
/* integrity manifest verification: every listed file must match bytes+chars+sha256 on disk */
import { createHash } from "node:crypto";
import { readFileSync as rint } from "node:fs";
const man = JSON.parse(rint(new URL("../integrity." + build + ".json", import.meta.url)));
let intOk = 0;
for (const [name, f] of Object.entries(man.files)) {
  const raw = rint(new URL("../" + f.path, import.meta.url));
  const sha = createHash("sha256").update(raw).digest("hex");
  const chars = raw.toString("utf-8").length;
  if (raw.byteLength !== f.bytes || chars !== f.chars || sha !== f.sha256) {
    console.error("INTEGRITY MISMATCH: " + name + " bytes=" + raw.byteLength + "/" + f.bytes + " chars=" + chars + "/" + f.chars + " sha=" + sha.slice(0, 8) + "/" + f.sha256.slice(0, 8));
    process.exit(1);
  }
  intOk++;
}
console.log("integrity: " + intOk + " files match manifest (build " + man.build + ", pinned " + man.pinned_commit.slice(0, 10) + ")");
console.log(fails ? "STATIC TEST FAIL " + fails : "STATIC TEST PASS (" + build + ", " + needIds.length + " ids wired)");
process.exit(fails ? 1 : 0);

