import assert from 'node:assert/strict';
import {refreshedCtStudy,privateDisplayReport} from '../app.v155.js';
const frames=(fresh=false)=>Array.from({length:4},(_,z)=>({kind:'gray',w:4,h:4,seriesUid:fresh?'1.2.3.9':'',volumeUnit:'HU',spacing:[1,1],seq:{seriesNumber:3},geometry:{frameOfReferenceUid:'1.2.3.4',ipp:[0,0,z],iop:[1,0,0,0,1,0]},info:{frames:1,bitsAllocated:16,slope:1,intercept:fresh?-1024:-1},data:Float32Array.from({length:16},(_,i)=>i*100+(fresh?-1024:-1)),__win:{lo:1},__img:{k:'bad-cache'}}));
const old=()=>({uid:'1.2.3.7',modality:'CT',frames:frames(),report:{findings:'Physician text'},measurementFrames:{'1:0':{test:'keep'}},signedBy:'Synthetic',meta:{age:'021Y'}});
const fresh=()=>({uid:'1.2.3.7',modality:'CT',frames:frames(true)});
let a=old(),b=fresh(),r=refreshedCtStudy(a,b);assert(r&&r.frames[0].seriesUid==='1.2.3.9');assert.equal(r.frames[0].data[0],-1024);assert.equal(a.frames[0].data[0],-1);assert.equal(r.report,a.report);assert.equal(r.measurementFrames,a.measurementFrames);assert.equal(r.signedBy,'Synthetic');assert(!r.frames[0].__img&&!r.frames[0].__win);assert(r.dicomCalibrationUpdated);
b=fresh();b.frames.reverse();r=refreshedCtStudy(old(),b);assert.equal(r.frames[0].geometry.ipp[2],0);
for(const mutate of [b=>b.uid='1.2.3.8',b=>b.modality='MR',b=>b.frames.pop(),b=>b.frames[0].data[0]+=1,b=>b.frames[0].geometry.ipp[2]=2,b=>b.frames[0].info.encapsulated=true,b=>delete b.frames[0].geometry.ipp]){a=old();b=fresh();mutate(b);assert.equal(refreshedCtStudy(a,b),null);assert.equal(a.frames[0].data[0],-1);}
a=old();a.uid='unknown-study';b=fresh();b.uid=a.uid;assert.equal(refreshedCtStudy(a,b),null);
const d=privateDisplayReport(frames(true)[0],'brain','CT');assert.equal(d.intercept,-1024);assert.equal(d.preset,'brain');assert(!JSON.stringify(d).includes('1.2.3.4'));
console.log('PASS verified same-study full-raw-sample refresh, source immutability, frame-order/report/annotation preservation, stale window eviction, collision/partial/change/ambiguous/unknown-UID refusal and private calibration summary');
