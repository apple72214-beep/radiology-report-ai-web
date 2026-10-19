import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const build=JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url))).build;
const events={},origin='https://radiology-report-ai-web.vercel.app';
const context={URL,Request,Response,TextDecoder,console,setTimeout,clearTimeout,location:{origin},self:{location:new URL(origin+'/sw.js'),addEventListener:(type,fn)=>events[type]=fn},caches:{match:async()=>undefined,open:async()=>({put:async()=>{}})},fetch:async()=>new Response('test')};
vm.runInNewContext(fs.readFileSync(new URL('../sw.'+build+'.js',import.meta.url),'utf8'),context);
for(const [path,method,auth] of [['/api/dicomweb?url=x','GET',false],['/api/report_ai','POST',false],['/api/dicomweb','GET',true],['/app.'+build+'.js','GET',true],['https://third.example/notes','GET',false],['/patient-report.json','GET',false]]){
 let intercepted=false;const request=new Request(path.startsWith('https:')?path:origin+path,{method,headers:auth?{authorization:'Bearer synthetic'}:{}});
 events.fetch({request,respondWith:()=>intercepted=true});assert.equal(intercepted,false,path);
}
let navIntercepted=false;events.fetch({request:{url:origin+'/private-report.html',method:'GET',headers:new Headers(),mode:'navigate'},respondWith:()=>navIntercepted=true});assert.equal(navIntercepted,false);
let task;events.fetch({request:new Request(origin+'/app.'+build+'.js'),respondWith:p=>task=p});assert(task);await task;
console.log('SW SECURITY PASS: no API/auth/external/unknown-asset caching; known app assets remain cacheable');
