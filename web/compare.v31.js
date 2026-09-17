/* Prior-study comparison math — pure, testable. v1.1.1 */
export function frameStats(data) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
  }
  return { min: mn, max: mx, mean: sum / data.length };
}
export function normalize01(data, min, max) {
  const r = max - min || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] - min) / r;
  return out;
}
export function diffStats(a, b, thr = 0.25) {
  const n = Math.min(a.length, b.length);
  let sum = 0, hot = 0;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > thr) { hot++; mask[i] = 1; }
  }
  return { meanAbs: sum / n, pctHot: (hot / n) * 100, mask };
}
export function grayOf(frame, x, y) {
  const i = (y | 0) * frame.w + (x | 0);
  if (frame.kind === "rgb") {
    const d = frame.data;
    return 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2];
  }
  return frame.data[i];
}
export function frameGrayFlat(frame) {
  const n = frame.w * frame.h;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (frame.kind === "rgb") {
      out[i] = 0.299 * frame.data[i * 3] + 0.587 * frame.data[i * 3 + 1] + 0.114 * frame.data[i * 3 + 2];
    } else out[i] = frame.data[i];
  }
  return out;
}
