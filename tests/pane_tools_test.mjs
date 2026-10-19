import assert from 'node:assert/strict';
import {secondaryImagePoint,paneMeasurementKey} from '../app.v135.js';
import {orientPoint,orientSize} from '../viewer-state.v135.js';
for(const rotate of [0,90,180,270])for(const flipH of [false,true])for(const flipV of [false,true]){
 const o={rotate,flipH,flipV},frame={w:120,h:80},[dw,dh]=orientSize(frame.w,frame.h,o);
 for(const p of [[10,15],[55,40],[100,60]]){
  const [u,v]=orientPoint(...p,frame.w,frame.h,o),r={left:37,top:-25,width:600,height:500};
  const k=Math.min(r.width/dw,r.height/dh),x=r.left+(r.width-dw*k)/2+u*k,y=r.top+(r.height-dh*k)/2+v*k;
  const out=secondaryImagePoint(x,y,r,frame,o);assert(out);assert(Math.abs(out[0]-p[0])<1e-8&&Math.abs(out[1]-p[1])<1e-8);
 }
}
assert.equal(secondaryImagePoint(-100,0,{left:0,top:0,width:600,height:500},{w:120,h:80},{}),null);
assert.notEqual(paneMeasurementKey(1,2),paneMeasurementKey(2,2));
assert.notEqual(paneMeasurementKey(2,2),paneMeasurementKey(2,3));
console.log('PANE TOOL MAPPING TEST PASS (48 inverse mappings + scope boundaries)');
