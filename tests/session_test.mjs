import assert from 'node:assert/strict';
import {sessionFrameAt} from '../app.v145.js';
const s=[{indices:[0,1]},{indices:[]},{indices:[2,3,4]}];
assert.deepEqual(sessionFrameAt(s,2),{series:2,index:0,total:5,position:2});
assert.equal(sessionFrameAt(s,1).series,0);
assert.equal(sessionFrameAt(s,999).index,2);
assert.equal(sessionFrameAt(s,-4).position,0);
assert.equal(sessionFrameAt([],0),null);
console.log('SESSION TEST PASS');
