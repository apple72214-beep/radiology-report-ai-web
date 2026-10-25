import { dist, segMm, angleDeg, ellipseStats, grayAt, rectStats } from "../measure.v145.js";
let fails = 0;
const ok = (name, cond) => { if (cond) console.log("PASS " + name); else { fails++; console.log("FAIL " + name); } };
ok("dist-3-4-5", Math.abs(dist([0, 0], [3, 4]) - 5) < 1e-9);
ok("segMm-aniso", Math.abs(segMm([0, 0], [4, 3], [0.5, 0.5]) - 2.5) < 1e-9);
ok("segMm-aniso-xy", Math.abs(segMm([0, 0], [4, 3], [0.4, 0.6]) - Math.hypot(4 * 0.6, 3 * 0.4)) < 1e-9);
ok("segMm-null", segMm([0, 0], [1, 1], null) === null);
ok("angle-90", Math.abs(angleDeg([1, 0], [0, 0], [0, 1]) - 90) < 1e-9);
ok("angle-180", Math.abs(angleDeg([1, 0], [0, 0], [-1, 0]) - 180) < 1e-9);
ok("angle-0", Math.abs(angleDeg([2, 0], [0, 0], [5, 0]) - 0) < 1e-9);
const uni = { kind: "gray", w: 10, h: 10, data: new Float32Array(100).fill(100), hu: true };
const s1 = ellipseStats(uni, [5, 5], 3, 3);
ok("roi-uniform-mean", s1 && Math.abs(s1.mean - 100) < 1e-9 && Math.abs(s1.std) < 1e-9 && s1.unit === "HU" && s1.n > 20);
const grad = { kind: "gray", w: 4, h: 4, data: new Float32Array([0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30]) };
const s2 = ellipseStats(grad, [1.5, 1.5], 1.2, 1.2);
ok("roi-grad-mean", s2 && Math.abs(s2.mean - 15) < 1e-9 && s2.unit === "gray");
ok("roi-clip", ellipseStats(uni, [0, 0], 2, 2).n > 0);
ok("roi-empty-outside", ellipseStats(uni, [50, 50], 2, 2) === null);
ok("rgb-gray", Math.abs(grayAt({ kind: "rgb", w: 1, h: 1, data: new Uint8Array([255, 255, 255]) }, 0, 0) - 255) < 1e-6);
/* --- v129: a rectangle ROI -------------------------------------------------
   A rectangle is what a radiologist puts over a vertebra, a liver segment or an
   adrenal: an ellipse wastes the corners, and the corners are often where the
   question is. Every pixel of the box is counted — none estimated at the edge. */
const rbox = { kind: "gray", w: 8, h: 6, data: new Float32Array(48).map((_, i) => i % 7), hu: true };
const q1 = rectStats(rbox, [0, 0], [7, 5]);
ok("rect-whole-frame-counts-every-pixel", q1 && q1.n === 48 && q1.unit === "HU");
const q2 = rectStats(rbox, [2, 1], [3, 2]);          /* indices 10,11,18,19 -> 3,4,4,5 */
ok("rect-counts-the-box-it-was-given", q2 && q2.n === 4);
ok("rect-mean-over-the-box", q2 && Math.abs(q2.mean - 4) < 1e-9);
ok("rect-min-max-are-real-pixels", q2 && q2.min === 3 && q2.max === 5);
const q3 = rectStats(rbox, [3, 2], [2, 1]);          /* dragged the other way */
ok("rect-dragged-backwards-is-the-same-box", q3 && q3.n === q2.n && Math.abs(q3.mean - q2.mean) < 1e-9);
ok("rect-outside-the-frame-is-nothing", rectStats(rbox, [40, 40], [50, 50]) === null);
const q4 = rectStats(rbox, [-6, -6], [2, 2]);        /* partly off the edge: clipped, not wrapped */
ok("rect-off-the-edge-is-clipped", q4 && q4.n === 9 && q4.min === 0);
const rflat = { kind: "gray", w: 4, h: 4, data: new Float32Array(16).fill(64) };
const q5 = rectStats(rflat, [1, 1], [2, 2]);
ok("rect-uniform-mean", q5 && Math.abs(q5.mean - 64) < 1e-9 && q5.std < 1e-9 && q5.min === 64 && q5.max === 64 && q5.unit === "gray");
const rgrad = { kind: "gray", w: 4, h: 4, data: new Float32Array([0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30]) };
ok("rect-grad-mean", Math.abs(rectStats(rgrad, [0, 0], [3, 0]).mean - 15) < 1e-9);
ok("rect-one-pixel-is-a-value", (() => { const s = rectStats(rgrad, [2, 1], [2, 1]); return s && s.n === 1 && s.mean === 20 && s.std < 1e-9; })());
ok("rect-needs-a-frame", rectStats(null, [0, 0], [1, 1]) === null);
ok("rect-of-a-degenerate-box-is-at-least-one-pixel", (() => { const s = rectStats(rgrad, [1.4, 1.6], [1.6, 1.4]); return s && s.n >= 1; })());
console.log(fails ? "MEASURE TEST FAIL " + fails : "MEASURE TEST PASS (23)");
process.exit(fails ? 1 : 0);
