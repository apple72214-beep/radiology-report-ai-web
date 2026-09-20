/* Optional institution-side AI structuring endpoint (Node serverless, stdlib-only).
   ARCHITECTURE: server ONLY converts raw notes + context to structured JSON;
   Word rendering, physician review/edit, sign-off and SHA-256 stay in the browser.
   Card-free providers only (Groq default). ENV: RRAI_AI_KEY, RRAI_AI_BASE_URL,
   RRAI_AI_MODEL, optional RRAI_AI_TOKEN (else same-origin check). No PHI logging. */
const SYSTEM =
  "You are a radiology reporting ASSISTANT drafting a structured report for a reviewing " +
  "radiologist to edit and sign. Convert RAW CLINICAL NOTES (primary source) plus the study " +
  "context into a professional report. Rules: do not repeat findings; group by anatomical " +
  "structure; wrap anatomical terms in <anat></anat>; never invent lesions, levels or devices " +
  "absent from the notes; if not assessable say so; respond in STRICT JSON: " +
  '{"findings": [str], "impression": [str], "exam": str, "indication": str}.';

const cap = (x, n, ln) => (Array.isArray(x) ? x.slice(0, n).map((it) => String(it).trim().slice(0, ln)).filter(Boolean) : []);

export default async function handler(req, res) {
  const set = (code, obj) => {
    res.status(code);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Cache-Control", "no-store");
    res.json(obj);
  };
  if (req.method === "OPTIONS") return set(204, {});
  if (req.method !== "POST") return set(405, { error: "POST only" });
  const token = process.env.RRAI_AI_TOKEN || "";
  const auth = req.headers.authorization || "";
  const origin = req.headers.origin || req.headers.referer || "";
  const allowed = token
    ? auth === "Bearer " + token
    : origin.startsWith("https://radiology-report-ai-web.vercel.app") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
  if (!allowed) return set(403, { error: "forbidden" });
  const key = process.env.RRAI_AI_KEY || "";
  if (!key) return set(503, { error: "server key not configured (RRAI_AI_KEY)" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { return set(400, { error: "bad json" }); } }
  body = body || {};
  const notes = String(body.notes || "").slice(0, 6000);
  if (!notes.trim()) return set(422, { error: "notes required" });
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const base = (process.env.RRAI_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  const model = process.env.RRAI_AI_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model, temperature: 0.1, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "STUDY CONTEXT JSON: " + JSON.stringify(context).slice(0, 4000) + "\nRAW CLINICAL NOTES:\n" + notes },
        ],
      }),
    });
    if (!r.ok) return set(502, { error: "provider http " + r.status });
    const j = await r.json();
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
