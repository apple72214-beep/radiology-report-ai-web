# Master templates (docxtpl / Jinja2)

- `radiology_master_template.docx` — EN hospital-style master (A4 narrow, navy title,
  dark-blue 00008B section heads, continuous EBEBEB impression box, right-aligned
  signature block, gray SHA-256/disclaimer footer).
- `radiology_master_template_AR.docx` — AR RTL master, same tags and styling.

## Tags
`{{patient_name}} {{sex}} {{age}} {{exam_date}} {{exam}} {{clinical_indication}}
{{technique}} {{radiologist_name}} {{title}} {{sha256}} {{signed_at}}`
Loops (paragraph-level): `{%p for f in findings_list %} … {{r f}} … {%p endfor %}`
and `{%p for i in impression_list %} … {{r i}} … {%p endfor %}`.
Pass `docxtpl.RichText` items in the lists; `backend/render_master_template.py`
provides `anat_richtext()` to bold `<anat>…</anat>` terms and a full sample context.

## Letterhead (draft, swappable)
Top of both templates: logo `templates/org_logo.png` + org block (name / department /
address) + navy rule. Identity lives in the `ORG` constants at the top of
`build_templates.py` — swap the strings (and the PNG for the real logo), re-run
`python3 templates/build_templates.py`, then re-render samples with
`python3 backend/render_master_template.py`. pytest `test_letterhead_present`
guards logo + org text in both languages.

## Tests
    pip install -r backend/requirements.txt pytest
    python3 -m pytest tests/template_server_test.py -q     # 7 checks

## CRITICAL syntax
RichText tags MUST be `{{r f}}` — the letter r ADJACENT to `{{` (no space).
`{{ r f }}` = Jinja syntax error; `{{ f|r }}` = renders SILENTLY EMPTY (only the
`{{r` prefix triggers docxtpl's patch_xml run splitting). Verified 2026-09-20 on
docxtpl 0.20.2; rendered samples checked byte-level (0 leftover tags, bold + shading intact).

## Render
    pip install docxtpl
    python backend/render_master_template.py     # writes docs/rrai-master-*-render-sample.docx

## Server endpoints (optional, LAN-only, hardened)
`backend/report_server_fastapi.py` serves these templates behind bearer token
(`RRAI_REPORT_TOKEN`):
- `GET  /api/templates` — list (lang, file, bytes, sha256)
- `POST /api/render` — `{"template":"en|ar","context":{…}}` → auto SHA-256 content
  fingerprint, `<anat>` bold via RichText, payload caps; saves to `backend/generated/`
- `GET  /api/reports/{id}` — download (strict hex id + realpath containment;
  Arabic filenames via RFC 5987 `filename*`)
Smoke-tested 2026-09-20 with fastapi TestClient: 401 no-auth, 200 render AR,
traversal 404, sha-in-footer + bold + RTL verified in the produced bytes.

NOTE: the browser platform does not need these files — its in-browser generator
(web/docx.v*.js) emits the identical layout offline. Templates exist for the
optional docxtpl server path and for hospital stationery customization.
