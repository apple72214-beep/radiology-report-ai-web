import assert from 'node:assert/strict';
import {renderVolumeGrid,prepareRenderVolume} from '../mpr.v155.js';
for(const quality of ['balanced','high']){
 const g=renderVolumeGrid(512,565,113,quality);assert.equal(g.nz,113,'in-plane reduction must not unnecessarily reduce depth to32');assert(g.nx*g.ny*g.nz<=g.budget);assert(g.nx<=512&&g.ny<=565);assert.equal(g.quality,quality);
 for(const [w,h,z] of [[512,512,202],[1024,512,1000],[2,10000,500],[4096,4096,4096],[8,6,4]]){const d=renderVolumeGrid(w,h,z,quality);assert(d.nx*d.ny*d.nz<=d.budget);assert(d.nz<=z&&d.nx<=w&&d.ny<=h);assert(d.nz<= (quality==='high'?256:192));}
}
assert.equal(renderVolumeGrid(512,565,113,'high').ny,256);assert.equal(renderVolumeGrid(512,512,202,'high').nz,202);assert.equal(renderVolumeGrid(512,512,202).nz,192);assert.equal(renderVolumeGrid(8,6,4,'other').quality,'balanced');assert.equal(renderVolumeGrid(NaN,4,4),null);
const fs=Array.from({length:4},(_,z)=>({kind:'gray',w:8,h:6,seriesUid:'synthetic',volumeUnit:'HU',info:{frames:1},spacing:[.8,.5],geometry:{frameOfReferenceUid:'reference',ipp:[0,0,z],iop:[1,0,0,0,1,0]},data:Float32Array.from({length:48},(_,i)=>i===0?-1000:98.25+z+i/100)}));
const before=fs.map(f=>Array.from(f.data)),a=prepareRenderVolume(fs,{modality:'CT'}),b=prepareRenderVolume(fs,{modality:'CT',quality:'high'});
assert(a.ok&&b.ok);assert(a.data instanceof Uint8Array&&b.data instanceof Float32Array);assert.equal(b.encoding,'float16-normalized');assert.equal(a.encoding,'uint8-normalized');assert.deepEqual(a.extent,b.extent);assert.equal(a.sourceSlices,b.sourceSlices);assert(Math.abs(b.data[1]*5120-1024-98.26)<.001);assert.deepEqual(fs.map(f=>Array.from(f.data)),before);assert.equal(b.voxelBudget,12000000);
fs[0].geometry.ipp[2]=1;assert.equal(prepareRenderVolume(fs,{modality:'CT',quality:'high'}).reason,'duplicates','quality cannot bypass geometry guards');
console.log('PASS independent depth preservation113/113, bounded balanced/high grids,202-source depth, no upsampling, normalized fine-density CPU input, physical/source immutability and unchanged geometry guards');
