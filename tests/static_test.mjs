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
const needIds = ["slice","preset","upload","files","demo","gen-report","report-ar","report-en","sign-row","signoff","signer","copy-report","clear-all","worklist","measure","zoom-reset","frame","sign-extra","signer-license","sign-export","sign-export-word","org-save","org-ar","org-en","print-root", "lang-toggle", "pacs-url", "pacs-pull", "pacs-dl", "pacs-dl-url", "lbl-dl-url", "pacs-dl-hint", "files-dir", "pick-dir", "pick-hint", "rep-exam", "rep-indication", "rep-findings", "rep-impression", "ai-key", "ai-gen", "ai-provider", "rep-notes"];
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
/* every shipped module must parse as ESM (catches silent syntax damage like the v71/v72 docx paren bug) */
for (const m of ["dicom","triage","docx","measure","compare","report","consult","codecs/decode"]) {
  const srcM = fs.readFileSync(path.join(root, `${m}.${build}.js`), "utf8");
  const t2 = path.join(os.tmpdir(), `rrai-mod-${build}-${m.replace("/", "-")}.mjs`);
  fs.writeFileSync(t2, srcM);
  const c2 = spawnSync(process.execPath, ["--check", t2]);
  if (c2.status !== 0) { fails++; console.log("FAIL parse " + m + ":\n" + c2.stderr.toString().slice(0, 400)); }
}
console.log("PASS all-modules ESM parse");
/* The suites used to import frozen modules (dicom.v52.js, app.v104.js …) while
   the shipped app moved on, so every assertion silently proved nothing about
   the build we publish. A suite may only import the build it belongs to. */
{
  const dir = path.join(root, "tests");
  let bad = 0, checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const t = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of t.matchAll(/["'`](\.\.\/[A-Za-z0-9_/]+)\.v(\d+)\.(js|html|json)["'`]/g)) {
      checked++;
      if ("v" + m[2] !== build) { fails++; bad++; console.log("FAIL " + f + " imports frozen " + m[1] + ".v" + m[2] + "." + m[3] + " (" + build + " is current)"); }
    }
  }
  if (checked === 0) { fails++; console.log("FAIL no module imports found in the suites"); }
  else if (!bad) console.log("PASS every suite imports " + build + " (" + checked + " imports checked)");
}
console.log(fails ? "STATIC TEST FAIL " + fails : "STATIC TEST PASS (" + build + ", " + needIds.length + " ids wired)");
process.exit(fails ? 1 : 0);

