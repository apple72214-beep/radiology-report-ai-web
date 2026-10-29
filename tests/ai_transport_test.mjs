import assert from 'node:assert/strict';
import {aiRunRequests} from '../app.v148.js';
const obj={findings:['Synthetic finding'],impression:['Synthetic impression']};
const good=()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(obj)}]}}]}),{status:200});
const requests=['model-a','model-b'].map(model=>({model,url:'https://synthetic.invalid',headers:{},body:{images:['SYNTHETIC']}}));
async function run(sequence,expected,n){let calls=[];const fetcher=async(u,o)=>{calls.push(o);const s=sequence.shift();if(s instanceof Error)throw s;return typeof s==='function'?s(o):s;};try{let r=await aiRunRequests(requests,{fetcher,sleep:async()=>{}});assert.equal(expected,'ok');assert.deepEqual(r.obj,obj);}catch(e){assert.equal(e.code,expected);}assert.equal(calls.length,n);assert(calls.every(c=>JSON.parse(c.body).images.length===1));}
await run([new Response('',{status:503}),good()],'ok',2);
await run([new Response('',{status:503}),new Response('',{status:503}),good()],'ok',3);
await run(Array.from({length:4},()=>new Response('',{status:503})),'unavailable',4);
await run([new Response('',{status:401})],'auth',1);
await run([new Response('',{status:403})],'auth',1);
await run([new Response('quota PerDay',{status:429})],'quota',1);
await run([new Response('',{status:429,headers:{'Retry-After':'120'}})],'rate-limit',1);
await run([new Response('',{status:429,headers:{'Retry-After':'1'}}),good()],'ok',2);
await run([new Response('',{status:404}),good()],'ok',2);
await run(Array.from({length:4},()=>new TypeError('Failed to fetch')),'network',4);
await run([new Response('{broken',{status:200}),good()],'ok',2);
await run([new Response(JSON.stringify({candidates:[{finishReason:'SAFETY'}]}))],'blocked',1);
await run([new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"findings":[],"impression":[]}'}]}}]})),good()],'ok',2);
let calls=0;
await assert.rejects(aiRunRequests(requests,{attemptMs:5,budgetMs:60000,sleep:async()=>{},fetcher:(u,o)=>{calls++;return new Promise((r,j)=>o.signal.addEventListener('abort',()=>j(new DOMException('Aborted','AbortError'))));}}),e=>e.code==='timeout');assert.equal(calls,4);
// A header response must not clear the timer before a stalled body finishes.
await assert.rejects(aiRunRequests(requests,{attemptMs:5,budgetMs:60000,sleep:async()=>{},fetcher:async(u,o)=>({ok:true,json:()=>new Promise((r,j)=>o.signal.addEventListener('abort',()=>j(new DOMException('Aborted','AbortError'))))})}),e=>e.code==='timeout');
const ac=new AbortController();ac.abort();calls=0;await assert.rejects(aiRunRequests(requests,{signal:ac.signal,fetcher:()=>{calls++;}}),e=>e.code==='cancelled');assert.equal(calls,0);
let clock=0;calls=0;await assert.rejects(aiRunRequests(requests,{now:()=>clock,budgetMs:1000,sleep:async()=>{},fetcher:async()=>{calls++;clock=1001;throw new TypeError('network');}}),e=>e.code==='network');assert.equal(calls,1);
console.log('PASS bounded retries, same image payload, model fallback, auth/quota stop, rate limits, 404, network vs timeout, invalid response, safety, stalled body, cancellation and total deadline');
