/* Radiology report AI — multi-planar reconstruction (MPR).
   Pure, dependency-free maths: build an isotropic-ish volume out of a stack of
   axial slices, then reslice it into axial / coronal / sagittal planes.
   No external libraries, no DOM, nothing leaves the device. */

const PLANE = { axial: "axial", coronal: "coronal", sagittal: "sagittal" };

const med = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function spacingOf(frame) {
  // DICOM PixelSpacing is [row spacing (y), column spacing (x)] in mm.
  const sp = frame && frame.spacing;
  if (Array.isArray(sp) && sp.length >= 2 && sp[0] > 0 && sp[1] > 0) return { sy: sp[0], sx: sp[1] };
  return { sy: 1, sx: 1 };
}

function normalFrom(iop) {
  if (!iop || iop.length < 6) return null;
  const a = [iop[0], iop[1], iop[2]];
  const b = [iop[3], iop[4], iop[5]];
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!len) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Integer storage when the values allow it — halves the memory of a big volume. */
function storageFor(min, max, allInt, n) {
  if (allInt && min >= -32768 && max <= 32767) return new Int16Array(n);
  if (allInt && min >= 0 && max <= 65535) return new Uint16Array(n);
  return new Float32Array(n);
}

/**
 * Build a volume from a stack of frames.
 * @param {Array} frames  frame objects ({w,h,data,kind,spacing,geometry})
 * @param {Object} opts   { maxVoxels, flipZ }
 * @returns {{ok:boolean, reason?:string, nx:number, ny:number, nz:number,
 *            sx:number, sy:number, sz:number, data:*, min:number, max:number,
 *            downsample:number, ordered:boolean, flipZ:boolean}}
 */
export function volumeFromFrames(frames, opts) {
  opts = opts || {};
  const maxVoxels = opts.maxVoxels || 40e6;
  if (!Array.isArray(frames) || frames.length < 2) return { ok: false, reason: "need at least 2 slices" };
  const f0 = frames[0];
  if (!f0 || !f0.data || !f0.w || !f0.h) return { ok: false, reason: "frames carry no pixel data" };
  if (f0.kind === "rgb") return { ok: false, reason: "colour volumes are not resliced" };
  const w = f0.w, h = f0.h;
  for (const f of frames) {
    if (!f || f.w !== w || f.h !== h || !f.data) return { ok: false, reason: "slices differ in size" };
  }

  /* --- order the stack along the slice normal ---------------------------- */
  const n = normalFrom(frames[0].geometry && frames[0].geometry.iop);
  let order = frames.map((f, i) => i);
  let zs = null;
  if (n && frames.every((f) => f.geometry && f.geometry.ipp && f.geometry.ipp.length === 3)) {
    zs = frames.map((f) => {
      const p = f.geometry.ipp;
      return p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    });
    order = order.slice().sort((a, b) => zs[a] - zs[b]);
  } else if (frames.every((f) => f.geometry && typeof f.geometry.instanceNumber === "number" && f.geometry.instanceNumber > 0)) {
    order = order.slice().sort((a, b) => frames[a].geometry.instanceNumber - frames[b].geometry.instanceNumber);
  }

  /* --- in-plane + through-plane spacing --------------------------------- */
  const sp = spacingOf(f0);
  let sz = 0;
  if (zs) {
    const diffs = [];
    for (let i = 1; i < order.length; i++) {
      const d = Math.abs(zs[order[i]] - zs[order[i - 1]]);
      if (d > 1e-4) diffs.push(d);
    }
    if (diffs.length) sz = med(diffs);
  }
  if (!sz) {
    for (const i of order) {
      const g = frames[i].geometry || {};
      if (g.spacingBetweenSlices > 0) { sz = g.spacingBetweenSlices; break; }
      if (g.sliceThickness > 0) { sz = g.sliceThickness; break; }
    }
  }
  if (!sz || !(sz > 0)) sz = Math.max(sp.sx, sp.sy);

  /* --- downsample if the volume would not fit comfortably ---------------- */
  let nx0 = w, ny0 = h, nz = order.length;
  let ds = 1;
  while (nx0 * ny0 * nz > maxVoxels && ds < 4) {
    ds += 1;
    nx0 = Math.max(1, Math.floor(w / ds));
    ny0 = Math.max(1, Math.floor(h / ds));
  }

  const sx = sp.sx * ds, sy = sp.sy * ds;
  const nx = nx0, ny = ny0;
  const total = nx * ny * nz;

  let min = Infinity, max = -Infinity;
  for (const idx of order) {
    const d = frames[idx].data;
    const step = Math.max(1, Math.floor(d.length / 20000));
    for (let i = 0; i < d.length; i += step) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
  }
  const allInt = frames.every((f) => f.data instanceof Int16Array || f.data instanceof Uint16Array ||
                                     f.data instanceof Int8Array || f.data instanceof Uint8Array);
  const out = storageFor(min, max, allInt, total);

  for (let z = 0; z < nz; z++) {
    const src = frames[order[z]].data;
    const base = z * nx * ny;
    for (let y = 0; y < ny; y++) {
      const sy0 = y * ds, ro = sy0 * w, ro2 = base + y * nx;
      for (let x = 0; x < nx; x++) out[ro2 + x] = src[ro + x * ds];
    }
  }
  return {
    ok: true, nx, ny, nz, sx, sy, sz, data: out, min, max,
    downsample: ds, ordered: !!zs, flipZ: opts.flipZ !== false,
  };
}

/** {w,h,n,sx,sy} of a plane: pixel size + how many slices it has. */
export function planeDims(vol, plane) {
  if (!vol || !vol.ok) return { w: 0, h: 0, n: 0, sx: 1, sy: 1 };
  if (plane === PLANE.coronal) return { w: vol.nx, h: vol.nz, n: vol.ny, sx: vol.sx, sy: vol.sz };
  if (plane === PLANE.sagittal) return { w: vol.ny, h: vol.nz, n: vol.nx, sx: vol.sy, sy: vol.sz };
  return { w: vol.nx, h: vol.ny, n: vol.nz, sx: vol.sx, sy: vol.sy };
}

const zToRow = (vol, z) => (vol.flipZ ? vol.nz - 1 - z : z);
const rowToZ = (vol, r) => (vol.flipZ ? vol.nz - 1 - r : r);

/** Extract one plane as a frame-shaped object ({w,h,data,kind,spacing}). */
export function planeImage(vol, plane, index) {
  const d = planeDims(vol, plane);
  if (!d.n) return null;
  const i = Math.max(0, Math.min(d.n - 1, index | 0));
  const out = new (vol.data instanceof Float32Array ? Float32Array : Int32Array)(d.w * d.h);
  const V = vol.data;
  if (plane === PLANE.coronal) {
    for (let r = 0; r < d.h; r++) {
      const z = rowToZ(vol, r), base = z * vol.nx * vol.ny + i * vol.nx, ro = r * d.w;
      for (let x = 0; x < d.w; x++) out[ro + x] = V[base + x];
    }
  } else if (plane === PLANE.sagittal) {
    for (let r = 0; r < d.h; r++) {
      const z = rowToZ(vol, r), base = z * vol.nx * vol.ny, ro = r * d.w;
      for (let y = 0; y < d.w; y++) out[ro + y] = V[base + y * vol.nx + i];
    }
  } else {
    const base = i * vol.nx * vol.ny;
    for (let k = 0; k < d.w * d.h; k++) out[k] = V[base + k];
  }
  return { w: d.w, h: d.h, data: out, kind: "gray", photometric: "MONOCHROME2", spacing: [d.sy, d.sx] };
}

/** Which slice of this plane shows volume coordinate c = {x,y,z}. */
export function planeIndexFor(vol, plane, c) {
  if (plane === PLANE.coronal) return c.y | 0;
  if (plane === PLANE.sagittal) return c.x | 0;
  return c.z | 0;
}

/** Click at pixel (px,py) on a plane → volume coordinate {x,y,z}. */
export function pointToVolume(vol, plane, index, px, py) {
  const d = planeDims(vol, plane);
  const x0 = Math.max(0, Math.min(d.w - 1, px | 0));
  const y0 = Math.max(0, Math.min(d.h - 1, py | 0));
  if (plane === PLANE.coronal) return { x: x0, y: index | 0, z: rowToZ(vol, y0) };
  if (plane === PLANE.sagittal) return { x: index | 0, y: x0, z: rowToZ(vol, y0) };
  return { x: x0, y: y0, z: index | 0 };
}

/** Volume coordinate → pixel inside a plane (for the crosshair). */
export function volumeToPlanePixel(vol, plane, c) {
  if (plane === PLANE.coronal) return { px: c.x, py: zToRow(vol, c.z) };
  if (plane === PLANE.sagittal) return { px: c.y, py: zToRow(vol, c.z) };
  return { px: c.x, py: c.y };
}

/** True when through-plane spacing is far coarser than in-plane (reformats are approximate). */
export function isAnisotropic(vol) {
  if (!vol || !vol.ok) return false;
  const inPlane = Math.min(vol.sx, vol.sy) || 1;
  return vol.sz / inPlane > 2.5;
}

export { PLANE };

/* v151: strict single-series geometry and bounded local volume rendering.
   The 3D view uses acquisition axes, not patient-oriented labels or segmentation. */
export function prepareRenderVolume(frames,opts={}) {
 const fail=reason=>({ok:false,reason});
 if(!Array.isArray(frames)||frames.length<4)return fail('slices');
 if(String(opts.modality||'').toUpperCase()!=='CT')return fail('ct-only');
 if(frames.some(f=>f?.volumeUnit!=='HU'||f?.info?.frames>1||f?.info?.depthFit))return fail('hu');
 const f0=frames[0],w=f0?.w,h=f0?.h,g0=f0?.geometry,sp=f0?.spacing;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2)return fail('pixels');
 if(!g0?.frameOfReferenceUid||!f0.seriesUid||!Array.isArray(g0.iop)||g0.iop.length!==6||!g0.iop.every(Number.isFinite))return fail('geometry');
 if(!Array.isArray(sp)||sp.length<2||!sp.every(x=>Number.isFinite(x)&&x>0))return fail('spacing');
 const a=g0.iop.slice(0,3),b=g0.iop.slice(3),dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
 if(Math.abs(Math.hypot(...a)-1)>.001||Math.abs(Math.hypot(...b)-1)>.001||Math.abs(dot(a,b))>.001)return fail('geometry');
 const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const rows=[];
 for(const f of frames){
  const g=f?.geometry;
  if(!f||f.w!==w||f.h!==h||!f.data||f.data.length!==w*h||f.kind==='rgb')return fail('pixels');
  if(f.seriesUid!==f0.seriesUid||!g||g.frameOfReferenceUid!==g0.frameOfReferenceUid)return fail('mixed');
  if(!Array.isArray(g.iop)||g.iop.length!==6||!g.iop.every((x,i)=>Number.isFinite(x)&&Math.abs(x-g0.iop[i])<.001)||!Array.isArray(g.ipp)||g.ipp.length!==3||!g.ipp.every(Number.isFinite))return fail('geometry');
  if(!Array.isArray(f.spacing)||f.spacing.length<2||!f.spacing.slice(0,2).every((x,i)=>Number.isFinite(x)&&Math.abs(x-sp[i])<Math.max(.001,sp[i]*.001)))return fail('spacing');
  rows.push({f,z:dot(g.ipp,n),u:dot(g.ipp,a),v:dot(g.ipp,b)});
 }
 rows.sort((x,y)=>x.z-y.z);
 const deltas=rows.slice(1).map((r,i)=>r.z-rows[i].z),sorted=deltas.slice().sort((a,b)=>a-b),sz=sorted[Math.floor(sorted.length/2)];
 if(!(sz>.001)||deltas.some(d=>d<.001))return fail('duplicates');
 if(deltas.some(d=>Math.abs(d-sz)>Math.max(.05,sz*.05)))return fail('irregular');
 if(rows.some(r=>Math.abs(r.u-rows[0].u)>.05||Math.abs(r.v-rows[0].v)>.05))return fail('tilt');
 if(opts.inspectOnly)return {ok:true,sourceSlices:rows.length,sz,extent:[(w-1)*sp[1],(h-1)*sp[0],rows.at(-1).z-rows[0].z]};
 const factor=Math.max(1,(w-1)/159,(h-1)/159,(rows.length-1)/191,Math.cbrt(w*h*rows.length/4000000));
 const nx=Math.max(2,Math.floor((w-1)/factor)+1),ny=Math.max(2,Math.floor((h-1)/factor)+1),nz=Math.max(2,Math.floor((rows.length-1)/factor)+1);
 const raw=new Float32Array(nx*ny*nz);let min=Infinity,max=-Infinity,k=0;
 for(let z=0;z<nz;z++){const f=rows[Math.round(z*(rows.length-1)/(nz-1))].f;
  for(let y=0;y<ny;y++){const iy=Math.round(y*(h-1)/(ny-1));for(let x=0;x<nx;x++){
   const v=Number(f.data[iy*w+Math.round(x*(w-1)/(nx-1))]);if(!Number.isFinite(v))return fail('pixels');raw[k++]=v;min=Math.min(min,v);max=Math.max(max,v);
  }}
 }
 if(!(max>min))return fail('flat');
 const data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=Math.round(255*Math.max(0,Math.min(1,(raw[i]+1024)/5120)));
 const extent=[(w-1)*sp[1],(h-1)*sp[0],rows.at(-1).z-rows[0].z];
 const maxExtent=Math.max(...extent),box=extent.map(x=>1.5*x/maxExtent);
 const anisotropy=Math.max(sz,...sp.slice(0,2))/Math.min(sz,...sp.slice(0,2));
 const gaps=rows.some(r=>Number.isFinite(r.f.geometry.sliceThickness)&&r.f.geometry.sliceThickness>0&&sz-r.f.geometry.sliceThickness>Math.max(.2,r.f.geometry.sliceThickness*.1));
 return {ok:true,nx,ny,nz,data,min,max,extent,box,sz,sourceSlices:rows.length,downsample:factor>1.001,anisotropy,gaps};
}
export function createVolumeRenderer(canvas,vol,onLost){
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,preserveDrawingBuffer:true});
 if(!gl||gl.isContextLost())throw new Error('webgl');
 if(Math.max(vol.nx,vol.ny,vol.nz)>gl.getParameter(gl.MAX_3D_TEXTURE_SIZE))throw new Error('gpu-size');
 let program,texture,vao,vs,fs,disposed=false,raf=0;
 const listeners=[],bind=(el,type,fn,opts)=>{el.addEventListener(type,fn,opts);listeners.push(()=>el.removeEventListener(type,fn,opts));};
 const state={yaw:.5,pitch:-.3,zoom:1,threshold:200,opacity:1,cut:0};
 function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);listeners.forEach(f=>f());if(texture)gl.deleteTexture(texture);if(program)gl.deleteProgram(program);if(vao)gl.deleteVertexArray(vao);if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);}
 const compile=(type,source)=>{const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){gl.deleteShader(sh);throw new Error('shader');}return sh;};
 try{
  vs=compile(gl.VERTEX_SHADER,`#version 300 es
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`);
  fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
  precision highp float;precision highp sampler3D;
  uniform sampler3D vox;uniform vec2 resolution;uniform vec3 boxSize;
  uniform float yaw,pitch,zoom,threshold,opacity,cut;out vec4 color;
  void main(){
   vec2 uv=(gl_FragCoord.xy/resolution)*2.-1.;uv.x*=resolution.x/resolution.y;
   float cy=cos(yaw),sy=sin(yaw),cx=cos(pitch),sx=sin(pitch);
   mat3 ry=mat3(cy,0.,-sy,0.,1.,0.,sy,0.,cy),rx=mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx);
   vec3 ro=ry*rx*vec3(uv*1.2/zoom,3.),rd=ry*rx*vec3(0.,0.,-1.);
   vec3 inv=1./(rd+vec3(.000001));vec3 t0=(-boxSize*.5-ro)*inv,t1=(boxSize*.5-ro)*inv;
   vec3 lo=min(t0,t1),hi=max(t0,t1);float near=max(max(lo.x,lo.y),lo.z),far=min(min(hi.x,hi.y),hi.z);
   if(far<=max(near,0.)){color=vec4(0.,0.,0.,1.);return;}
   float start=max(near,0.),stepSize=(far-start)/192.;vec4 acc=vec4(0.);
   for(int i=0;i<192;i++){
    vec3 p=ro+rd*(start+(float(i)+.5)*stepSize),q=p/boxSize+.5;
    if(q.z<cut)continue;
    float v=texture(vox,q).r,hu=v*5120.-1024.;float d=clamp((hu-threshold)/800.,0.,1.);
    float alpha=1.-exp(-d*opacity*10.*stepSize);
    vec3 tissue=mix(vec3(.55,.3,.13),vec3(1.,.95,.8),clamp(d,0.,1.));
    if(alpha>.001){
     vec3 e=1./vec3(textureSize(vox,0));
     vec3 grad=vec3(texture(vox,q+vec3(e.x,0.,0.)).r-texture(vox,q-vec3(e.x,0.,0.)).r,
      texture(vox,q+vec3(0.,e.y,0.)).r-texture(vox,q-vec3(0.,e.y,0.)).r,
      texture(vox,q+vec3(0.,0.,e.z)).r-texture(vox,q-vec3(0.,0.,e.z)).r)/(e*boxSize);
     float diffuse=length(grad)>.00001?abs(dot(normalize(grad),rd)):.5;
     tissue*=.25+.75*diffuse;
    }
    acc.rgb+=(1.-acc.a)*alpha*tissue;acc.a+=(1.-acc.a)*alpha;
    if(acc.a>.98)break;
   }color=vec4(acc.rgb,1.);
  }`);
  program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('shader');
  vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.useProgram(program);texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,vol.nx,vol.ny,vol.nz,0,gl.RED,gl.UNSIGNED_BYTE,vol.data);
  if(gl.getError()!==gl.NO_ERROR)throw new Error('gpu-memory');
  const u={};for(const n of ['vox','resolution','boxSize','yaw','pitch','zoom','threshold','opacity','cut'])u[n]=gl.getUniformLocation(program,n);
  function draw(){raf=0;if(disposed||gl.isContextLost())return;gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);gl.bindVertexArray(vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,texture);gl.uniform1i(u.vox,0);gl.uniform2f(u.resolution,canvas.width,canvas.height);gl.uniform3fv(u.boxSize,vol.box);for(const n of ['yaw','pitch','zoom','threshold','opacity','cut'])gl.uniform1f(u[n],state[n]);gl.drawArrays(gl.TRIANGLES,0,3);}
  function update(values={}){Object.assign(state,values);state.zoom=Math.max(.5,Math.min(2.5,state.zoom));state.pitch=Math.max(-1.5,Math.min(1.5,state.pitch));if(!raf&&!disposed)raf=requestAnimationFrame(draw);}
  const pointers=new Map();let distance=0;
  bind(canvas,'pointerdown',e=>{pointers.set(e.pointerId,[e.clientX,e.clientY]);canvas.setPointerCapture(e.pointerId);distance=0;});
  bind(canvas,'pointermove',e=>{const old=pointers.get(e.pointerId);if(!old)return;pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size===1)update({yaw:state.yaw+(e.clientX-old[0])*.012,pitch:state.pitch+(e.clientY-old[1])*.012});else{const p=[...pointers.values()],d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);if(distance>0)update({zoom:state.zoom*d/distance});distance=d;}});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])bind(canvas,ev,e=>{pointers.delete(e.pointerId);distance=0;});
  bind(canvas,'wheel',e=>{e.preventDefault();update({zoom:state.zoom*Math.exp(-e.deltaY*.001)});},{passive:false});
  bind(canvas,'webglcontextlost',e=>{e.preventDefault();dispose();onLost?.();});
  draw();return {update,dispose,reset:()=>update({yaw:.5,pitch:-.3,zoom:1,threshold:200,opacity:1,cut:0}),state};
 }catch(e){dispose();throw e;}
}

// Safe numeric diagnostics, without pixels, coordinates, identifiers or labels.
export function volumeGeometryReport(frames,modality){
 const fs=Array.isArray(frames)?frames:[],base=fs[0]?.geometry?.iop;
 const valid=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
 const badIop=f=>{const a=f?.geometry?.iop;return !valid(a,6)||Math.abs(Math.hypot(...a.slice(0,3))-1)>.001||Math.abs(Math.hypot(...a.slice(3))-1)>.001||Math.abs(a.slice(0,3).reduce((v,x,i)=>v+x*a[i+3],0))>.001;};
 const count=fn=>fs.filter(fn).length,first=fn=>{const i=fs.findIndex(fn);return i<0?null:i+1;};
 const noPosition=f=>!valid(f?.geometry?.ipp,3),differentIop=f=>valid(base,6)&&valid(f?.geometry?.iop,6)&&f.geometry.iop.some((x,i)=>Math.abs(x-base[i])>=.001);
 const v=prepareRenderVolume(fs,{modality,inspectOnly:true});
 const r={schema:'rrai-ct-volume-geometry-1',modality:String(modality||'').toUpperCase()==='CT'?'CT':'not-CT',slices:fs.length,
  seriesCount:new Set(fs.map(f=>f?.seriesUid).filter(Boolean)).size,missingSeries:count(f=>!f?.seriesUid),
  referenceCount:new Set(fs.map(f=>f?.geometry?.frameOfReferenceUid).filter(Boolean)).size,missingReference:count(f=>!f?.geometry?.frameOfReferenceUid),
  missingOrInvalidPositions:count(noPosition),firstInvalidPositionSlice:first(noPosition),invalidOrientations:count(badIop),firstInvalidOrientationSlice:first(badIop),differentOrientations:count(differentIop),firstDifferentOrientationSlice:first(differentIop),
  missingOrInvalidSpacing:count(f=>!valid(f?.spacing,2)||f.spacing.some(x=>x<=0)),missingVerifiedHU:count(f=>f?.volumeUnit!=='HU'),
  geometryEligible:!!v.ok,reason:v.ok?'geometry-accepted':v.reason,detail:v.ok?'geometry-accepted':v.reason};
 if(v.reason==='geometry'){r.detail=r.missingReference?'missing-frame-reference':r.missingSeries?'missing-series-id':r.invalidOrientations?'invalid-orientation':r.differentOrientations?'inconsistent-orientation':r.missingOrInvalidPositions?'invalid-position':'geometry';}
 return r;
}
