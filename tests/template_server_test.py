"""pytest: master templates + docxtpl render path (run: python3 -m pytest tests/template_server_test.py -q)."""
import io
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TPL_EN = os.path.join(ROOT, "templates", "radiology_master_template.docx")
TPL_AR = os.path.join(ROOT, "templates", "radiology_master_template_AR.docx")


def _docxml(path):
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8")


def sample_ctx():
    import render_master_template as rmt
    return rmt.sample_context()


os.environ.setdefault("RRAI_REPORT_TOKEN", "pytest-token")


def test_builder_is_reproducible():
    sys.path.insert(0, os.path.join(ROOT, "templates"))
    import build_templates as bt
    assert bt.xml_of(bt.build_en()) == zipfile.ZipFile(TPL_EN).read("word/document.xml")
    assert bt.xml_of(bt.build_ar()) == zipfile.ZipFile(TPL_AR).read("word/document.xml")


def test_rich_text_tag_form_is_correct():
    for tpl in (TPL_EN, TPL_AR):
        x = _docxml(tpl)
        assert "{{r f}}" in x and "{{r i}}" in x          # r adjacent to braces
        assert "{{ r " not in x and "|r }}" not in x      # broken forms absent


def test_render_no_leftovers_bold_shading(tmp_path):
    import render_master_template as rmt
    ctx = sample_ctx()
    out_en = rmt.render(TPL_EN, str(tmp_path / "en.docx"), ctx)
    out_ar = rmt.render(TPL_AR, str(tmp_path / "ar.docx"), ctx)
    for out, rtl in ((out_en, False), (out_ar, True)):
        x = _docxml(out)
        assert not re.search(r"\{\{|\{%", x), "leftover template tags"
        assert "Post-operative changes" in x, "findings content missing (silent-empty regression)"
        assert "epidural fibrosis" in x, "impression content missing"
        assert x.count("<w:b/>") >= 4, "anat bold runs missing"
        assert x.count("EBEBEB") >= 1, "impression shading missing"
        assert ctx["sha256"] in x, "footer sha missing"
        if rtl:
            assert x.count("<w:bidi") >= 10, "AR rtl flags missing"


def test_sha_stability_and_server_helpers():
    import report_server_fastapi as srv
    src = sample_ctx()
    ctx = {k: src[k] for k in srv.SHA_KEYS if k in src}
    ctx["findings_list"] = ["plain finding one", "plain finding two"]
    ctx["impression_list"] = ["plain impression"]
    assert srv.compute_report_sha(ctx) == srv.compute_report_sha(json.loads(json.dumps(ctx)))
    assert srv.compute_report_sha(ctx) != srv.compute_report_sha({**ctx, "patient_name": "OTHER"})
    # arabic stems survive disposition (RFC 5987), traversal ids rejected
    d = srv._content_disposition(srv._slug("سيلان احمد ناجي"))
    assert "filename*=UTF-8''" in d and "%" in d
    assert d.split("filename=")[1].split(";")[0].isascii()
    assert not srv.REPORT_ID_RE.match("../etc/passwd")
    assert not srv.REPORT_ID_RE.match("abc")
    assert srv.REPORT_ID_RE.match("d5b8d1db3acd")


# ------------------------------------------------------------ endpoint edges
import pytest  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    import report_server_fastapi as srv
    monkeypatch.setattr(srv, "GENERATED_DIR", str(tmp_path / "gen"))
    from fastapi.testclient import TestClient
    return TestClient(srv.app), {"Authorization": "Bearer pytest-token"}


def test_endpoints_auth_and_validation(client):
    c, H = client
    assert c.get("/api/templates").status_code == 401
    assert c.get("/api/templates", headers=H).status_code == 200
    assert c.post("/api/render", headers=H, json={"template": "fr", "context": {}}).status_code == 422
    # NOTE: raw/encoded ../.. never reaches the handler through httpx/starlette
    # (path normalization answers 404 first); the real guard REPORT_ID_RE is
    # unit-tested in test_sha_stability_and_server_helpers below.
    assert c.get("/api/reports/not-an-id", headers=H).status_code == 422
    assert c.get("/api/reports/000000000000", headers=H).status_code == 404


def test_render_edge_cases(client, tmp_path):
    c, H = client
    # empty lists + empty context must still render a clean docx
    r = c.post("/api/render", headers=H, json={"template": "en", "context": {}})
    assert r.status_code == 200 and r.json()["bytes"] > 5000
    # oversized name truncated, still 200, id == sha[:12]
    r = c.post("/api/render", headers=H, json={"template": "ar", "context": {
        "patient_name": "ط" * 300, "findings_list": ["بند <anat>اختبار</anat>"] * 80}})
    j = r.json()
    assert r.status_code == 200 and j["id"] == j["sha256"][:12]
    assert len(j["filename"]) < 120
    # download roundtrip: sha present in produced bytes, no leftover tags
    d = c.get("/api/reports/" + j["id"], headers=H)
    assert d.status_code == 200
    x = zipfile.ZipFile(io.BytesIO(d.content)).read("word/document.xml").decode("utf-8")
    assert j["sha256"] in x and not re.search(r"\{\{|\{%", x)
    assert "اختبار" in x and x.count("<w:b/>") >= 2


def test_letterhead_present(tmp_path):
    import render_master_template as rmt
    out = rmt.render(TPL_EN, str(tmp_path / "en.docx"), rmt.sample_context())
    z = zipfile.ZipFile(out)
    x = z.read("word/document.xml").decode("utf-8")
    assert "City Teaching Hospital" in x and "Department of Radiology" in x
    assert any(n.startswith("word/media/") for n in z.namelist()), "logo image missing"
    out_ar = rmt.render(TPL_AR, str(tmp_path / "ar.docx"), rmt.sample_context_ar())
    z2 = zipfile.ZipFile(out_ar)
    x2 = z2.read("word/document.xml").decode("utf-8")
    assert "المستشفى التعليمي" in x2 and "قسم الأشعة" in x2
    assert any(n.startswith("word/media/") for n in z2.namelist()), "AR logo missing"
