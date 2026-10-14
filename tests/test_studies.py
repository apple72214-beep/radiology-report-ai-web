from fastapi.testclient import TestClient

from backend.dicom_utils import create_synthetic_dicom
from backend.main import app


def test_upload_worklist_and_render(tmp_path, monkeypatch):
    monkeypatch.setenv("HAGAR_STUDY_STORE", str(tmp_path / "store"))
    client = TestClient(app)

    dcm = create_synthetic_dicom(index=0, seed=7)
    response = client.post(
        "/studies/upload", files=[("files", ("demo.dcm", dcm, "application/dicom"))]
    )
    assert response.status_code == 201
    created = response.json()
    assert len(created) == 1
    uid = created[0]["study_uid"]
    assert created[0]["modality"] == "CR"

    worklist = client.get("/studies").json()
    assert any(study["study_uid"] == uid for study in worklist)

    detail = client.get(f"/studies/{uid}").json()
    assert len(detail["instances"]) == 1

    png = client.get(f"/studies/{uid}/instances/0/png")
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_multi_instance_study_groups_together(tmp_path, monkeypatch):
    monkeypatch.setenv("HAGAR_STUDY_STORE", str(tmp_path / "store"))
    client = TestClient(app)
    from pydicom.uid import generate_uid

    study_uid = generate_uid()
    files = [
        (
            "files",
            (
                f"s{i}.dcm",
                create_synthetic_dicom(index=i, study_uid=study_uid, seed=i),
                "application/dicom",
            ),
        )
        for i in range(3)
    ]
    response = client.post("/studies/upload", files=files)
    assert response.status_code == 201
    created = response.json()
    assert len(created) == 1
    assert len(created[0]["instances"]) == 3


def test_unknown_study_and_bad_preset(tmp_path, monkeypatch):
    monkeypatch.setenv("HAGAR_STUDY_STORE", str(tmp_path / "empty"))
    client = TestClient(app)
    assert client.get("/studies/nope").status_code == 404
    assert client.get("/studies/nope/instances/0/png").status_code == 404
