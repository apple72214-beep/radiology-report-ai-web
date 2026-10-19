/* Optional institution-side AI structuring endpoint (Node serverless, stdlib-only).
   ARCHITECTURE: server ONLY converts raw notes + context to structured JSON;
   Word rendering, physician review/edit, sign-off and SHA-256 stay in the browser.
   Card-free providers only (Groq default). ENV: RRAI_AI_KEY, RRAI_AI_BASE_URL,
   RRAI_AI_MODEL, required RRAI_AI_TOKEN (32+ characters). No application request-body logging; configure platform logs separately. */
const SYSTEM =
  "You are a radiology reporting ASSISTANT drafting a structured report for a reviewing " +
  "radiologist to edit and sign. Convert RAW CLINICAL NOTES (primary source) plus the study " +
  "context into a professional report. Rules: do not repeat findings; group by anatomical " +
  "structure; wrap anatomical terms in <anat></anat>; never invent lesions, levels or devices " +
  "absent from the notes; if not assessable say so; respond in STRICT JSON: " +
  '{"findings": [str], "impression": [str], "exam": str, "indication": str}.';

const cap = (x, n, ln) => (Array.isArray(x) ? x.slice(0, n).map((it) => String(it).trim().slice(0, ln)).filter(Boolean) : []);

import {serviceGate,jsonReply,originList,allowedTarget,boundedHTTPS} from '../server/service-security.mjs';
export default async function handler(req, res) {
  const set=(code,obj)=>jsonReply(res,code,obj);
  if(!serviceGate(req,res,{token:process.env.RRAI_AI_TOKEN,methods:['POST']}))return;
  const key=process.env.RRAI_AI_KEY||'';
  if(!key)return set(503,{error:'service not configured'});
  if(Number(req.headers['content-length'])>16384)return set(413,{error:'body too large'});
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { return set(400, { error: "bad json" }); } }
  body = body || {};
  if(typeof body!=='object'||Array.isArray(body))return set(400,{error:'object required'});
  if(Buffer.byteLength(JSON.stringify(body))>16384)return set(413,{error:'body too large'});
  const notes = String(body.notes || "").slice(0, 6000);
  if (!notes.trim()) return set(422, { error: "notes required" });
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const base = (process.env.RRAI_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  const model = process.env.RRAI_AI_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  let target;
  try{target=allowedTarget(base+'/chat/completions',originList(process.env.RRAI_AI_ORIGINS||'https://api.groq.com'));}catch{return set(503,{error:'service not configured'});}
  try {
    const r = await boundedHTTPS(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      maxBytes:1024*1024,timeoutMs:25000,
      body: JSON.stringify({
        model, temperature: 0.1, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "STUDY CONTEXT JSON: " + JSON.stringify(context).slice(0, 4000) + "\nRAW CLINICAL NOTES:\n" + notes },
        ],
      }),
    });
    if (r.status<200||r.status>=300) return set(502, { error: "provider unavailable" });
    const j = JSON.parse(r.body.toString("utf8"));
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const obj = JSON.parse(txt.trim().replace(/^```(json)?/i, "").replace(/```$/, ""));
    return set(200, {
      findings: cap(obj.findings, 60, 2000),
      impression: cap(obj.impression, 60, 2000),
      exam: String(obj.exam || "").slice(0, 200),
      indication: String(obj.indication || "").slice(0, 2000),
      model,
    });
  } catch (e) {
    return set(502, { error: "provider unreachable or non-json" });
  }
}

export const config={api:{bodyParser:{sizeLimit:"16kb"}}};
