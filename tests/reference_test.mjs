import assert from 'node:assert/strict';import {referenceSegment} from '../app.v154.js';
const frame=(ipp,iop,spacing=[1,1],uid='same')=>({w:101,h:101,spacing,geometry:{ipp,iop,frameOfReferenceUid:uid}});
const axial=frame([0,0,30],[1,0,0,0,1,0]);
const sagittal=frame([20,0,0],[0,1,0,0,0,1]);
assert.deepEqual(referenceSegment(axial,sagittal),[[0,30],[100,30]]);
assert.deepEqual(referenceSegment(sagittal,axial),[[20,0],[20,100]]);
assert.deepEqual(referenceSegment(axial,{...sagittal,spacing:[2,3]}),[[0,15],[100,15]]);
assert.equal(referenceSegment(axial,frame([20,0,0],[0,1,0,0,0,1],[1,1],'other')),null);
assert.equal(referenceSegment(axial,axial),null);
assert.equal(referenceSegment(frame([0,0,300],[1,0,0,0,1,0]),sagittal),null);
assert.equal(referenceSegment(axial,{...sagittal,spacing:null}),null);
assert.deepEqual(referenceSegment(frame([0,0,40],[1,0,0,0,1,0]),sagittal),[[0,40],[100,40]]);
console.log('REFERENCE TEST PASS');
const {referenceStrokeWidth,paintReference}=await import('../app.v154.js');
for(const rot of [0,90,180,270])for(const scale of [.3,.7,1,2,8]){
 const w=512,h=256,swap=rot===90||rot===270,r={width:(swap?h:w)*scale+100,height:(swap?w:h)*scale};
 assert(Math.abs(referenceStrokeWidth(w,h,r,rot)*scale-1.2)<1e-10);
}
assert.equal(referenceStrokeWidth(512,256,{width:0,height:0}),null);
assert.equal(referenceStrokeWidth(512,256,{width:NaN,height:100}),null);
let stroke;
const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){stroke=this.lineWidth;}};
const detached={width:512,height:256,getBoundingClientRect:()=>({width:0,height:0}),getContext:()=>ctx};
paintReference(detached,[[0,30],[511,30]],'#fbbf24',{width:256,height:256});assert.equal(stroke,2.4);
stroke=null;paintReference(detached,[[0,30],[511,30]],'#fbbf24');assert.equal(stroke,null);
console.log('REFERENCE STROKE PASS: detached canvas regression, letterbox, quarter turns and zoom');
