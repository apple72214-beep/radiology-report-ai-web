"""Optional institution-side AI structuring endpoint (stdlib-only, Vercel Python).

ARCHITECTURE NOTE (deliberate deviation from the handed-over package):
  * The server ONLY converts raw clinical notes + numeric context into structured
    JSON (findings/impression). It NEVER renders Word and NEVER sees raw DICOM.
    Rendering, physician review/edit, sign-off and the SHA-256 fingerprint stay in
    the browser (web/docx.v*.js) — a downloaded report must always pass a human.
  * No paid/card providers: the institution sets its own card-free key in Vercel
    env (Groq default). OPENAI/gpt-4o is NOT used (paid credits = card = policy).
  * No secrets in code; no PH I logging; no traceback leakage; payload caps.

ENV (Vercel → Project → Settings → Environment Variables):
  RRAI_AI_KEY       card-free provider key (gsk_… Groq default / sk-or-… OpenRouter)
  RRAI_AI_BASE_URL  default https://api.groq.com/openai/v1
  RRAI_AI_MODEL     default meta-llama/llama-4-scout-17b-16e-instruct
  RRAI_AI_TOKEN     optional shared secret; if set, clients must send it as
                    Authorization: Bearer … (otherwise same-origin check applies)

Review fixes vs the original package (main.py):
  1. card-free provider by env, never hardcoded keys;  2. no exception detail leakage;
  3. filename injection moot (no docx here);           4. auth/same-origin guard;
  5. payload caps + JSON validation;                   6. no docxtpl template dependency;
  7. CORS without credentials;                         8. physician review gate kept client-side.
"""

import json
import os
import urllib.error
import urllib.request

APP_ORIGIN = "https://radiology-report-ai-web.vercel.app"
SYSTEM_PROMPT = (
    "You are a radiology reporting ASSISTANT drafting a structured report for a reviewing "
    "radiologist to edit and sign. Convert RAW CLINICAL NOTES (primary source) plus the study "
    "context into a professional report. Rules: do not repeat findings; group by anatomical "
    "structure; wrap anatomical terms in <anat></anat>; never invent lesions, levels or devices "
    "absent from the notes; if not assessable say so; respond in STRICT JSON: "
    '{"findings": [str], "impression": [str], "exam": str, "indication": str}.'
)


def _json(res, code, obj):
    body = json.dumps(obj).encode("utf-8")
    res.status_code = code
    res.headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store",
    }
    return body


def _allowed(req):
    token = os.environ.get("RRAI_AI_TOKEN", "")
    auth = req.headers.get("authorization", "") if hasattr(req.headers, "get") else ""
    if token:
        return auth == "Bearer " + token
    origin = (req.headers.get("origin", "") or req.headers.get("referer", "") or "")
    return origin.startswith(APP_ORIGIN) or origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")


def _cap_list(x, n=60, ln=2000):
    if not isinstance(x, list):
        return []
    out = []
    for it in x[:n]:
        t = str(it).strip()[:ln]
        if t:
            out.append(t)
    return out


def handler(req, res):
    if req.method == "OPTIONS":
        return _json(res, 204, {})
    if req.method != "POST":
        return _json(res, 405, {"error": "POST only"})
    if not _allowed(req):
        return _json(res, 403, {"error": "forbidden"})
    key = os.environ.get("RRAI_AI_KEY", "")
    if not key:
        return _json(res, 503, {"error": "server key not configured (RRAI_AI_KEY)"})
    try:
        body = req.body if isinstance(req.body, dict) else json.loads(req.body or "{}")
    except Exception:
        return _json(res, 400, {"error": "bad json"})
    notes = str(body.get("notes", ""))[:6000]
    context = body.get("context", {})
    if not isinstance(context, dict):
        context = {}
    if not notes.strip():
        return _json(res, 422, {"error": "notes required"})
    base = os.environ.get("RRAI_AI_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
    model = os.environ.get("RRAI_AI_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
    payload = json.dumps({
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "STUDY CONTEXT JSON: " + json.dumps(context)[:4000] + "\nRAW CLINICAL NOTES:\n" + notes},
        ],
    }).encode("utf-8")
    rq = urllib.request.Request(
        base + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(rq, timeout=60) as rp:
            j = json.loads(rp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return _json(res, 502, {"error": "provider http " + str(e.code)})
    except Exception:
        return _json(res, 502, {"error": "provider unreachable"})
    try:
        txt = j["choices"][0]["message"]["content"]
        obj = json.loads(txt.strip().removeprefix("```json").removesuffix("```").strip())
    except Exception:
        return _json(res, 502, {"error": "provider returned non-json"})
    return _json(res, 200, {
        "findings": _cap_list(obj.get("findings")),
        "impression": _cap_list(obj.get("impression")),
        "exam": str(obj.get("exam", ""))[:200],
        "indication": str(obj.get("indication", ""))[:2000],
        "model": model,
    })
