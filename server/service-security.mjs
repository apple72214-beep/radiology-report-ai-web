import {timingSafeEqual} from 'node:crypto';
import {resolve4} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';

export function originList(raw='') {
 return raw.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{
  const u=new URL(x);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('invalid origin');return u.origin;
 });
}
export function jsonReply(res,status,body){res.status(status);if(status===204)return res.end();return res.json(body);}
export function serviceGate(req,res,{token,methods}){
 res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
 let allowed;try{allowed=originList(process.env.RRAI_ALLOWED_ORIGINS||'https://radiology-report-ai-web.vercel.app');}catch{jsonReply(res,503,{error:'service not configured'});return false;}
 const origin=req.headers.origin;
 if(origin && !allowed.includes(origin)){jsonReply(res,403,{error:'origin denied'});return false;}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Access-Control-Allow-Methods',methods.join(', ')+', OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Accept');
 if(req.method==='OPTIONS'){jsonReply(res,204);return false;}
 if(!methods.includes(req.method)){res.setHeader('Allow',methods.join(', ')+', OPTIONS');jsonReply(res,405,{error:'method not allowed'});return false;}
 if(typeof token!=='string'||token.length<32){jsonReply(res,503,{error:'service not configured'});return false;}
 const auth=req.headers.authorization,expected=Buffer.from('Bearer '+token),got=Buffer.from(typeof auth==='string'?auth:'');
 if(got.length!==expected.length||!timingSafeEqual(got,expected)){jsonReply(res,401,{error:'authentication required'});return false;}
 return true;
}
export function allowedTarget(input,origins){
 const u=new URL(input);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||!origins.includes(u.origin)||u.hostname.endsWith('.')||u.href.length>2048)throw new Error('target denied');
 return u;
}
// IPv4-only egress is intentional. Deny non-global/special ranges, mapped IPv6 and numeric encodings.
export function publicIPv4(ip){
 if(isIP(ip)!==4||ip==="168.63.129.16")return false;
 const [a,b]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168||b===88))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
}
export async function pinnedAddress(host,lookup=resolve4){
 if(isIP(host)) {if(!publicIPv4(host))throw new Error('address denied');return host;}
 let timer;
 try{
  const addresses=await Promise.race([lookup(host),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('dns timeout')),4000);})]);
  if(!addresses.length||addresses.some(ip=>!publicIPv4(ip)))throw new Error('address denied');
  return addresses[0];
 }finally{clearTimeout(timer);}
}
// The validated IP is bound to this connection's lookup. No second DNS lookup; no redirects.
export async function boundedHTTPS(url,{method='GET',headers={},body,maxBytes=4*1024*1024,timeoutMs=20000}={},dependencies={}){
 const address=await pinnedAddress(url.hostname,dependencies.resolve4||resolve4);
 const send=dependencies.request||request;
 return new Promise((resolve,reject)=>{
  let timer;const finishError=e=>{clearTimeout(timer);reject(e);};
  const req=send(url,{method,headers,agent:false,family:4,autoSelectFamily:false,lookup:(host,opts,cb)=>cb(null,address,4)},r=>{
   const chunks=[];let size=0;
   if(r.statusCode>=300&&r.statusCode<400){r.destroy();req.destroy(new Error('redirect denied'));return;}
   r.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(new Error('response too large'));return;}chunks.push(chunk);});
   r.on('error',finishError);r.on('aborted',()=>finishError(new Error('response aborted')));
   r.on('end',()=>{clearTimeout(timer);resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)});});
  });
  req.on('error',finishError);timer=setTimeout(()=>req.destroy(new Error('upstream timeout')),timeoutMs);
  if(body)req.write(body);req.end();
 });
}
