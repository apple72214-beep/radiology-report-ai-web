"""Render the docxtpl master templates (templates/radiology_master_template*.docx).

Usage (LAN / dev machine):
    pip install docxtpl
    python render_master_template.py            # renders both samples into ./out/
The platform's own exports do NOT need this file (in-browser generator); it exists
for teams that run the docxtpl path from the handed-over package.
Rich text: pass docxtpl.RichText objects; wrap anatomical terms with <anat>…</anat>
in plain strings and call anat_richtext() to bold them.
"""
import os
import re

from docxtpl import DocxTemplate, RichText

HERE = os.path.dirname(os.path.abspath(__file__))
TPL_EN = os.path.join(HERE, "..", "templates", "radiology_master_template.docx")
TPL_AR = os.path.join(HERE, "..", "templates", "radiology_master_template_AR.docx")


def anat_richtext(text: str) -> RichText:
    rt = RichText()
    for i, part in enumerate(re.sub(r"<anat>(.*?)</anat>", r"**\1**", text or "").split("**")):
        if not part:
            continue
        rt.add(part, bold=bool(i % 2))
    return rt


def sample_context():
    return {
        "patient_name": "SYLAN AHMED NAJI ALKHALGI",
        "sex": "M", "age": "075Y", "exam_date": "19/09/2026",
        "exam": "MRI Lumbosacral Spine with IV Contrast",
        "clinical_indication": "History of lumbar fixation 6 years ago; LBP with right radiculopathy",
        "technique": "MRI Lumbosacral Spine with IV Contrast performed per the department standard protocol with intravenous contrast.",
        "findings_list": [
            anat_richtext("Post-operative changes are noted in the lower <anat>lumbar spine</anat>, consistent with previous laminectomy and posterior instrumentation at L4–L5–S1."),
            anat_richtext("Residual posterior <anat>disc bulges</anat> indenting the ventral <anat>thecal sac</anat> at L4–L5 and L5–S1."),
        ],
        "impression_list": [
            anat_richtext("Post-operative changes with enhancing <anat>epidural fibrosis</anat> at the surgical bed."),
            "No evidence of post-operative fluid collection or pseudomeningocele.",
        ],
        "radiologist_name": "Dr. Abdullah Hagar",
        "title": "Consultant Radiologist",
        "sha256": "d5b8d1db3acd63c06e2ad21e58efcad7ab528f8a4569104aad8eefca647c5a80",
        "signed_at": "2026-09-20T17:57:00Z",
    }


def sample_context_ar():
    """AR sample drawn from field-accepted case #2 (2026-09-20): real Arabic findings."""
    return {
        "patient_name": "سيلان احمد ناجي الخلقي",
        "sex": "ذكر", "age": "075 سنة", "exam_date": "19/09/2026",
        "exam": "رنين مغناطيسي للعمود الفقري القطني مع الصبغة",
        "clinical_indication": "تاريخ تثبيت قطني قبل 6 سنوات؛ ألم أسفل الظهر مع اعتلال جذري أيمن",
        "technique": "أُجري فحص الرنين المغناطيسي للعمود الفقري القطني مع الصبغة الوريدية وفق بروتوكول القسم.",
        "findings_list": [
            anat_richtext("تغييرات ما بعد العملية في <anat>الفقرات القطنية</anat> السفلية، متوافقة مع استئصال الصفيحة والتثبيت الخلفي على مستوى L4–L5–S1."),
            anat_richtext("بروزات <anat>غضروفية</anat> خلفية متبقية تضغط على <anat>الكيس الجافوي</anat> الأمامي عند L4–L5 وL5–S1."),
        ],
        "impression_list": [
            anat_richtext("تغييرات ما بعد العملية مع <anat>تليف فوق الجافية</anat> معزز عند سرير الجراحة."),
            "لا دليل على تجمع سائلي بعد العملية أو أمهات غشائية كاذبة.",
        ],
        "radiologist_name": "د. عبدالله حجر",
        "title": "استشاري الأشعة",
        "sha256": "30fb8e6d458799f1e07f0e9a2ff40a8f47b3f9a4a29c6f8f8c1c9e37b0458799",
        "signed_at": "2026-09-20T02:31:52Z",
    }


def render(tpl_path, out_path, context=None):
    doc = DocxTemplate(tpl_path)
    doc.render(context or sample_context())
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    doc.save(out_path)
    return out_path


if __name__ == "__main__":
    ctx = sample_context()
    print(render(TPL_EN, os.path.join(HERE, "..", "docs", "rrai-master-EN-render-sample.docx"), ctx))
    print(render(TPL_AR, os.path.join(HERE, "..", "docs", "rrai-master-AR-render-sample.docx"), sample_context_ar()))
