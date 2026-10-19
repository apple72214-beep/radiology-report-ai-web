/* Optional, authenticated, read-only institution relay. Disabled without explicit config.
   Private hospital servers must use a hospital-side gateway, not public-cloud SSRF. */
import {serviceGate,jsonReply,originList,allowedTarget,boundedHTTPS} from '../server/service-security.mjs';
export default async function handler(req,res){
 if(!serviceGate(req,res,{token:process.env.RRAI_PACS_TOKEN,methods:['GET']}))return;
 let target;
 try{
  const origins=originList(process.env.RRAI_PACS_ORIGINS||'');
  if(!origins.length)return jsonReply(res,503,{error:'service not configured'});
  target=allowedTarget(new URL(req.url,'https://service.invalid').searchParams.get('url'),origins);
 }catch{return jsonReply(res,400,{error:'target denied'});}
 try{
  const accept=String(req.headers.accept||'application/dicom+json').slice(0,256);
  const r=await boundedHTTPS(target,{headers:{Accept:accept}});
  res.setHeader('Content-Type',r.headers['content-type']||'application/octet-stream');
  res.setHeader('Content-Disposition','attachment');res.status(r.status).send(r.body);
 }catch{return jsonReply(res,502,{error:'upstream unavailable or blocked'});}
}
