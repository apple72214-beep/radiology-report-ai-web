import { triage, detectContext } from "../triage.v41.js";
const W = 256, H = 256;
const gray = (fn) => { const data = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = fn(x, y); return { kind: "gray", w: W, h: H, data }; };
const R = 128;
const brainBase = (x, y) => { const d = Math.hypot(x - 128, y - 128) / R; if (d < 0.78) return 120; if (d < 0.92) return 240; return 0; };
const brainHemo = gray((x, y) => brainBase(x, y) + (Math.hypot(x - 170, y - 100) < 15 ? 90 : 0));
const brainClean = gray(brainBase);
const chest = (blob) => gray((x, y) => {
  let v = 60;
  const inL = x >= 46 && x < 115 && y >= 64 && y < 205;
  const inR = x >= 140 && x < 210 && y >= 64 && y < 205;
  if (inL || inR) v = 30;
  if (x >= 115 && x < 140) v = 150;
  if (blob && Math.hypot(x - 80, y - 110) < 16) v = 200;
  return v;
});
const ctChest = gray((x, y) => {
  let v = 90;
  const inL = x >= 46 && x < 115 && y >= 64 && y < 205;
  const inR = x >= 140 && x < 210 && y >= 64 && y < 205;
  if (inL || inR) v = 25;
  if (x >= 115 && x < 140 && y >= 60 && y < 190) v = 200;
  if (Math.hypot(x - 128, y - 210) < 10) v = 230;
  return v;
});
let fails = 0;
const check = (name, got, wantP, wantCtx, wantReason) => {
  const okP = got.priority === wantP, okC = got.context === wantCtx, okR = !wantReason || (got.reasons || []).join("|").includes(wantReason);
  if (!(okP && okC && okR)) { fails++; console.log("FAIL", name, JSON.stringify(got)); } else console.log("PASS", name, got.priority, got.context, got.score);
};
check("brain-hemo", triage(brainHemo, { bodyPart: "HEAD" }), "urgent", "brain", "عالية الكثافة");
check("brain-clean", triage(brainClean, { bodyPart: "HEAD", description: "SYN-BRAIN ROUTINE" }), "routine", "brain");
check("chest-lesion", triage(chest(true), { description: "CHEST" }), "urgent", "chest");
check("chest-clean", triage(chest(false), { bodyPart: "CHEST" }), "routine", "chest");
check("ct-chest-symmetric", triage(ctChest, { modality: "CT", bodyPart: "CHEST" }), "routine", "chest");
check("unknown-generic", triage(chest(false), {}), "routine", "unknown");
console.log(detectContext({ description: "CT HEAD AXIAL" }) === "brain" ? "PASS ctx-detect" : (fails++, "FAIL ctx-detect"));
console.log(fails ? "TRIAGE TEST FAIL " + fails : "TRIAGE TEST PASS");
process.exit(fails ? 1 : 0);
