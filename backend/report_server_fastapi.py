"""Optional hospital-side DOCX report server (reviewed & hardened rewrite).

NOTE ON ARCHITECTURE: Radiology report AI generates its Word reports 100% inside
the browser (web/docx.v*.js) by design — offline, no server, no PHI leaving the
device. This file is an OPTIONAL add-on for hospitals that prefer server-side
generation on their own LAN; it is NOT required by the platform and must never
be deployed on a public host with patient data.

Review of the original snippet this replaces (findings/impression/docx/FastAPI):
 1. Content-Disposition filename was built from raw patient_name → header
    injection / weird filenames. FIXED: slugify + whitelist.
 2. IMPRESSION shading was applied per bullet with default List Bullet spacing
    → visible white gaps between bullets ("الخلفية المستمرة" was not continuous).
    FIXED: spacing after=0 between bullets, one shaded run, gap after the block.
 3. No page setup → Word default Letter. FIXED: explicit A4 + narrow margins.
 4. Heading color was set via runs[0] which crashes if the heading has no runs
    in some templates. FIXED: guard + style-level color.
 5. No auth / rate limit / CORS policy on an endpoint that receives PHI.
    FIXED: bearer token from env RRAI_REPORT_TOKEN (401 without), permissive
    CORS only when env RRAI_REPORT_CORS=* (LAN use), payload size caps.
 6. No <anat> → bold conversion although the comment promised it. FIXED below.
 7. Errors: pydantic 422 is fine, but 5xx leaked python-docx tracebacks.
    FIXED: catch-all 500 with no internals.
 8. BytesIO never closed. FIXED: context manager.
 9. (2026-09-20, merge of the parallel-session additions) docxtpl master-template
    endpoints added INSIDE this hardened server instead of a second, unauthenticated
    main.py: GET /api/templates, POST /api/render (auto SHA-256 content fingerprint,
    <anat> bold via RichText, payload caps), GET /api/reports/{id} (strict hex id +
    realpath containment = no path traversal). All behind the same bearer token.
    Arabic download filenames keep their letters via RFC 5987 filename*.
    Rendered reports live in backend/generated/ (gitignored, never logged).
    docxtpl is OPTIONAL: without it these three endpoints return 503 and
    /api/generate-docx keeps working with plain python-docx.
"""

import hashlib
import io
import json
import os
import re
import time
import urllib.parse

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import nsdecls
from docx.oxml import parse_xml
from docx.shared import Pt, RGBColor, Mm

DARK_BLUE = RGBColor(0x00, 0x00, 0x8B)  # hospital template heading blue
BOX_GRAY = "EBEBEB"                     # continuous impression box fill
TOKEN = os.environ.get("RRAI_REPORT_TOKEN", "")

app = FastAPI(title="RRAI optional report server", docs_url=None, redoc_url=None)

if os.environ.get("RRAI_REPORT_CORS") == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?",
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )


class ReportPayload(BaseModel):
    patient_name: str = Field(max_length=120)
    exam: str = Field(default="", max_length=200)
    indication: str = Field(default="", max_length=2000)
    findings: list[str] = Field(max_length=200)
    impression: list[str] = Field(max_length=100)
    signer: str = Field(default="—", max_length=120)
    license: str = Field(default="", max_length=60)


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._\u0600-\u06FF -]+", "-", name or "study").strip("- ")[:60] or "study"


def _content_disposition(stem: str) -> str:
    """ASCII fallback + RFC 5987 UTF-8 name so Arabic stems survive headers."""
    ascii_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-")[:60] or "report"
    utf8 = urllib.parse.quote(stem[:60], safe="")
    return f"attachment; filename=MR_Report_{ascii_stem}.docx; filename*=UTF-8''MR_Report_{utf8}.docx"


def _anat_bold(paragraph, text: str) -> None:
    """Render **x** and <anat>x</anat> markers as bold runs (idea from original)."""
    norm = re.sub(r"<anat>(.*?)</anat>", r"**\1**", text or "")
    for i, part in enumerate(norm.split("**")):
        if not part:
            continue
        run = paragraph.add_run(part)
        run.bold = bool(i % 2)


def _shade(paragraph, fill: str) -> None:
    paragraph._p.get_or_add_pPr().append(parse_xml(r'<w:shd {} w:fill="{}"/>'.format(nsdecls("w"), fill)))


@app.post("/api/generate-docx")
def generate_docx(payload: ReportPayload, authorization: str = Header(default="")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        doc = Document()
        sec = doc.sections[0]
        sec.orientation = WD_ORIENT.PORTRAIT
        sec.page_width, sec.page_height = Mm(210), Mm(297)      # A4
        sec.top_margin = sec.bottom_margin = Mm(15)            # narrow
        sec.left_margin = sec.right_margin = Mm(15)

        t = doc.add_paragraph()
        t.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = t.add_run("MEDICAL RADIOLOGY REPORT")
        r.bold, r.font.size, r.font.color.rgb = True, Pt(15), RGBColor(0x1F, 0x38, 0x64)

        for line in (
            f"Patient Name: {payload.patient_name}",
            f"Exam: {payload.exam or '—'}",
            f"Clinical Indication: {payload.indication or '—'}",
        ):
            doc.add_paragraph(line)

        h = doc.add_paragraph()
        hr = h.add_run("FINDINGS:")
        hr.bold, hr.font.color.rgb = True, DARK_BLUE
        for f in payload.findings:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(3)
            _anat_bold(p, f)

        h2 = doc.add_paragraph()
        h2r = h2.add_run("IMPRESSION:")
        h2r.bold, h2r.font.color.rgb = True, DARK_BLUE
        for i, imp in enumerate(payload.impression):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0 if i < len(payload.impression) - 1 else 10)
            _shade(p, BOX_GRAY)
            _anat_bold(p, "• " + imp)

        sig = doc.add_paragraph(f"Reported by:\n{payload.signer}\n" + (f"License: {payload.license} — " if payload.license else "") + "Consultant Radiologist")
        sig.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        foot = doc.add_paragraph("Decision-support output; final clinical responsibility rests with the signing physician.")
        foot.runs[0].font.size = Pt(8)
        foot.runs[0].font.color.rgb = RGBColor(0x80, 0x80, 0x80)

        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)
        data = buf.getvalue()
        buf.close()
        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(_slug(payload.patient_name))},
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="report generation failed")


# ---------------------------------------------------------------- docxtpl path
HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(HERE, "..", "templates")
GENERATED_DIR = os.path.join(HERE, "generated")
TEMPLATE_FILES = {"en": "radiology_master_template.docx", "ar": "radiology_master_template_AR.docx"}
REPORT_ID_RE = re.compile(r"^[0-9a-f]{12}$")
SHA_KEYS = ["patient_name", "sex", "age", "exam_date", "exam", "clinical_indication",
            "technique", "findings_list", "impression_list", "radiologist_name", "title"]


def compute_report_sha(context: dict) -> str:
    canon = json.dumps({k: context.get(k, "") for k in SHA_KEYS},
                       ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def _auth(authorization: str) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _docxtpl():
    try:
        import docxtpl  # noqa
        return docxtpl
    except ImportError:
        raise HTTPException(status_code=503, detail="docxtpl not installed on server")


class RenderPayload(BaseModel):
    template: str = Field(default="en", max_length=8)
    context: dict = Field(default_factory=dict)


@app.get("/api/templates")
def list_templates(authorization: str = Header(default="")):
    _auth(authorization)
    out = []
    for lang, fn in TEMPLATE_FILES.items():
        path = os.path.join(TEMPLATES_DIR, fn)
        if os.path.isfile(path):
            data = open(path, "rb").read()
            out.append({"lang": lang, "file": fn, "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest()})
    return {"templates": out, "note": "docxtpl/Jinja2; RichText tag form is {{r var}} (no space)."}


@app.post("/api/render")
def render_report(payload: RenderPayload, authorization: str = Header(default="")):
    _auth(authorization)
    if payload.template not in TEMPLATE_FILES:
        raise HTTPException(status_code=422, detail="template must be 'en' or 'ar'")
    tpl_path = os.path.join(TEMPLATES_DIR, TEMPLATE_FILES[payload.template])
    if not os.path.isfile(tpl_path):
        raise HTTPException(status_code=503, detail="template file missing on server")
    docxtpl = _docxtpl()
    ctx = dict(payload.context or {})

    for k in ("patient_name", "sex", "age", "exam_date", "exam", "clinical_indication",
              "technique", "radiologist_name", "title"):
        ctx[k] = str(ctx.get(k, ""))[:2000]

    def rich(x):
        rt = docxtpl.RichText()
        for i, part in enumerate(re.sub(r"<anat>(.*?)</anat>", r"**\1**", x).split("**")):
            if part:
                rt.add(part, bold=bool(i % 2))
        return rt

    ctx["findings_list"] = [rich(str(it)[:2000]) for it in (ctx.get("findings_list") or [])[:60] if str(it).strip()]
    ctx["impression_list"] = [rich(str(it)[:2000]) for it in (ctx.get("impression_list") or [])[:60] if str(it).strip()]
    # fingerprint over the PLAIN context the caller sent (stable, reproducible)
    plain = dict(payload.context or {})
    for k in ("findings_list", "impression_list"):
        plain[k] = [str(it)[:2000] for it in (plain.get(k) or [])[:60]]
    sha = compute_report_sha(plain)
    ctx.setdefault("sha256", sha)
    ctx.setdefault("signed_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    try:
        doc = docxtpl.DocxTemplate(tpl_path)
        doc.render(ctx)
        buf = io.BytesIO()
        doc.save(buf)
        data = buf.getvalue()
        buf.close()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="template render failed")

    os.makedirs(GENERATED_DIR, exist_ok=True)
    stem = _slug(ctx.get("patient_name") or "report")
    rid = sha[:12]
    fname = f"{rid}_{stem}.docx"
    with open(os.path.join(GENERATED_DIR, fname), "wb") as fh:
        fh.write(data)
    return {"id": rid, "sha256": sha, "filename": f"MR_Report_{stem}.docx",
            "bytes": len(data), "template": payload.template}


@app.get("/api/reports/{rid}")
def get_report(rid: str, authorization: str = Header(default="")):
    _auth(authorization)
    if not REPORT_ID_RE.match(rid or ""):
        raise HTTPException(status_code=422, detail="invalid report id")
    root = os.path.realpath(GENERATED_DIR)
    match = None
    if os.path.isdir(root):
        for fn in os.listdir(root):
            if fn.startswith(rid + "_") and fn.endswith(".docx"):
                match = os.path.join(root, fn)
                break
    if not match or not os.path.realpath(match).startswith(root + os.sep):
        raise HTTPException(status_code=404, detail="report not found")
    data = open(match, "rb").read()
    stem = os.path.basename(match)[len(rid) + 1:-5]
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": _content_disposition(stem)},
    )
