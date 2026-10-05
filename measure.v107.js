/* Measurement math — pure, testable. v1.0.3 suite: segments / angles / ROI stats. */
export function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
export function segMm(a, b, spacing) {
  if (!spacing) return null;
  const dy = (b[1] - a[1]) * (spacing[0] || spacing[1]);
  const dx = (b[0] - a[0]) * (spacing[1] || spacing[0]);
  return Math.hypot(dx, dy);
}
export function angleDeg(p1, v, p2) {
  const a1 = Math.atan2(p1[1] - v[1], p1[0] - v[0]);
  const a2 = Math.atan2(p2[1] - v[1], p2[0] - v[0]);
  let d = Math.abs(a1 - a2) * 180 / Math.PI;
  if (d > 180) d = 360 - d;
  return d;
}
export function grayAt(frame, x, y) {
  const i = (y | 0) * frame.w + (x | 0);
  if (frame.kind === "rgb") {
    const d = frame.data;
    return 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2];
  }
  return frame.data[i];
}
export function ellipseStats(frame, c, rx, ry) {
  let n = 0, sum = 0, sum2 = 0, mn = Infinity, mx = -Infinity;
  const x0 = Math.max(0, Math.ceil(c[0] - rx)), x1 = Math.min(frame.w - 1, Math.floor(c[0] + rx));
  const y0 = Math.max(0, Math.ceil(c[1] - ry)), y1 = Math.min(frame.h - 1, Math.floor(c[1] + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - c[0]) / rx, dy = (y - c[1]) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const v = grayAt(frame, x, y);
      n++; sum += v; sum2 += v * v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  if (!n) return null;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean, std, min: mn, max: mx, n, unit: frame.hu ? "HU" : "gray" };
}
