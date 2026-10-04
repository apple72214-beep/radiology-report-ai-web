/* MPR — multi-planar reconstruction: volume building, reslicing, crosshair maths. */
import { volumeFromFrames, planeDims, planeImage, planeIndexFor, pointToVolume, volumeToPlanePixel, isAnisotropic } from "../mpr.v106.js";

let fails = 0;
const eq = (a, b, m) => { if (a !== b) { fails++; console.log(`FAIL ${m}: ${a} ≠ ${b}`); } };
const ck = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) { fails++; console.log(`FAIL ${m}: ${a} vs ${b}`); } };

/* --- a synthetic phantom: bright sphere in a dark box ------------------- */
function phantom(nx, ny, nz, opts) {
  opts = opts || {};
  const frames = [];
  for (let z = 0; z < nz; z++) {
    const data = new Int16Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const dx = x - nx / 2, dy = y - ny / 2, dz = (z - nz / 2) * (opts.zScale || 1);
        data[y * nx + x] = Math.hypot(dx, dy, dz) < (opts.r || 6) ? 1000 : 0;
      }
    }
    frames.push({
      w: nx, h: ny, data, kind: "gray", photometric: "MONOCHROME2",
      spacing: [0.7, 0.7],
      geometry: {
        ipp: [0, 0, z * 2], iop: [1, 0, 0, 0, 1, 0],
        sliceThickness: 2, spacingBetweenSlices: 2, instanceNumber: nz - z,
      },
    });
  }
  return opts.reverse ? frames.slice().reverse() : frames;
}

/* 1. volume shape, spacing and slice ordering ---------------------------- */
const nx = 40, ny = 32, nz = 16;
const frames = phantom(nx, ny, nz, { reverse: true }); // instance numbers run backwards
const vol = volumeFromFrames(frames, { maxVoxels: 40e6 });
ck(vol && vol.ok, "volume builds from a slice stack" + (vol && !vol.ok ? " (" + vol.reason + ")" : ""));
eq(vol.nx, nx, "volume nx");
eq(vol.ny, ny, "volume ny");
eq(vol.nz, nz, "volume nz");
near(vol.sx, 0.7, 1e-6, "column spacing taken from PixelSpacing");
near(vol.sy, 0.7, 1e-6, "row spacing taken from PixelSpacing");
near(vol.sz, 2, 1e-6, "through-plane spacing from ImagePositionPatient");
eq(vol.ordered, true, "slices ordered along the slice normal, not by instance number");
/* the first frame in the array has the highest z (reverse), so volume z=0 must be the last one */
eq(vol.data[0], frames[nz - 1].data[0], "z = 0 is the slice with the lowest patient position");
eq(vol.min, 0, "volume min");
eq(vol.max, 1000, "volume max");

/* 2. plane geometry ------------------------------------------------------ */
const da = planeDims(vol, "axial"), dc = planeDims(vol, "coronal"), ds = planeDims(vol, "sagittal");
eq(`${da.w}x${da.h}/${da.n}`, `${nx}x${ny}/${nz}`, "axial dims (x,y) and slice count z");
eq(`${dc.w}x${dc.h}/${dc.n}`, `${nx}x${nz}/${ny}`, "coronal dims (x,z) and slice count y");
eq(`${ds.w}x${ds.h}/${ds.n}`, `${ny}x${nz}/${nx}`, "sagittal dims (y,z) and slice count x");
near(dc.sy, vol.sz, 1e-6, "coronal rows use through-plane spacing (true aspect ratio)");
near(ds.sy, vol.sz, 1e-6, "sagittal rows use through-plane spacing");
near(ds.sx, vol.sy, 1e-6, "sagittal columns use row spacing");

/* 3. reslicing picks the right voxels ----------------------------------- */
const cz = nz >> 1, cy = ny >> 1, cx = nx >> 1;
const ax = planeImage(vol, "axial", cz);
eq(ax.data[cy * nx + cx], 1000, "axial centre slice shows the sphere core");
const co = planeImage(vol, "coronal", cy);
eq(co.data[(vol.nz - 1 - cz) * nx + cx], 1000, "coronal through the sphere centre shows the core");
const sa = planeImage(vol, "sagittal", cx);
eq(sa.data[(vol.nz - 1 - cz) * ny + cy], 1000, "sagittal through the sphere centre shows the core");
eq(planeImage(vol, "coronal", 0).data[(vol.nz - 1 - cz) * nx + cx], 0, "coronal off-centre misses the sphere");
eq(planeImage(vol, "axial", 0).data[cy * nx + cx], 0, "axial off-centre misses the sphere");

/* 4. crosshair maths round-trips ---------------------------------------- */
const c = { x: 11, y: 7, z: 5 };
for (const [plane, expect] of [["axial", c.z], ["coronal", c.y], ["sagittal", c.x]]) {
  eq(planeIndexFor(vol, plane, c), expect, `${plane} index derived from the volume coordinate`);
  const back = pointToVolume(vol, plane, planeIndexFor(vol, plane, c),
    volumeToPlanePixel(vol, plane, c).px, volumeToPlanePixel(vol, plane, c).py);
  eq(`${back.x},${back.y},${back.z}`, `${c.x},${c.y},${c.z}`, `${plane} pixel↔volume round trip`);
}
const clamped = pointToVolume(vol, "axial", 3, -50, 9999);
ck(clamped.x >= 0 && clamped.y <= ny - 1, "out-of-canvas clicks are clamped into the volume");

/* 5. guards -------------------------------------------------------------- */
eq(volumeFromFrames(phantom(8, 8, 1), {}).ok, false, "a single slice cannot be resliced");
const mixed = phantom(16, 16, 4).concat([{ w: 8, h: 8, data: new Int16Array(64), kind: "gray" }]);
eq(volumeFromFrames(mixed, {}).ok, false, "slices of differing size are rejected");
const isoFrames = phantom(24, 24, 8, { zScale: 1 }).map((f) => {
  f.geometry = { ipp: [0, 0, f.geometry.instanceNumber ? 0 : 0, ], iop: [1, 0, 0, 0, 1, 0], sliceThickness: 0.7, spacingBetweenSlices: 0.7, instanceNumber: 8 - (f.geometry.instanceNumber - 1) };
  return f;
});
isoFrames.forEach((f, i) => { f.geometry.ipp = [0, 0, i * 0.7]; f.geometry.instanceNumber = i + 1; });
const iso = volumeFromFrames(isoFrames, {});
near(iso.sz, 0.7, 1e-6, "isotropic stack: through-plane spacing equals in-plane");
eq(isAnisotropic(iso), false, "isotropic stack is not flagged");
const thickFrames = phantom(24, 24, 8, { r: 3 }).map((f) => {
  f.geometry = { ipp: [0, 0, f.geometry.ipp[2] * 3], iop: [1, 0, 0, 0, 1, 0], sliceThickness: 6, spacingBetweenSlices: 6, instanceNumber: f.geometry.instanceNumber };
  return f;
});
eq(isAnisotropic(volumeFromFrames(thickFrames, {})), true, "thick-slice stack is flagged (reformats are approximate)");
const tiny = volumeFromFrames(phantom(64, 64, 8), { maxVoxels: 2000 });
ck(tiny.ok && tiny.downsample > 1, "oversized volumes are downsampled to fit memory");
eq(tiny.nx < 64, true, "downsampling shrinks the in-plane matrix");

console.log(fails ? "MPR TEST FAIL " + fails : "MPR TEST PASS");
process.exit(fails ? 1 : 0);
