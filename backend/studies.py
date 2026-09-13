"""File-backed study store: ingestion, worklist and instance retrieval."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .dicom_utils import read_dataset


@dataclass
class Instance:
    idx: int
    sop_uid: str
    number: int


@dataclass
class Study:
    study_uid: str
    patient_id: str
    modality: str
    description: str
    owner_id: str
    status: str = "received"
    instances: list[Instance] = field(default_factory=list)


def store_root() -> Path:
    return Path(os.getenv("HAGAR_STUDY_STORE", "data/studies"))


def _study_dir(study_uid: str) -> Path:
    return store_root() / study_uid


def _load_meta(study_uid: str) -> Study | None:
    meta_path = _study_dir(study_uid) / "meta.json"
    if not meta_path.exists():
        return None
    return Study(**json.loads(meta_path.read_text()))


def _save_meta(study: Study) -> None:
    directory = _study_dir(study.study_uid)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "meta.json").write_text(json.dumps(asdict(study), indent=2))


def ingest(owner_id: str, files: list[tuple[str, bytes]]) -> list[Study]:
    """Store uploaded DICOM instances grouped by StudyInstanceUID."""
    touched: dict[str, Study] = {}
    for _name, data in files:
        ds = read_dataset(data)
        study_uid = str(getattr(ds, "StudyInstanceUID", "") or "unknown-study")
        study = touched.get(study_uid) or _load_meta(study_uid) or Study(
            study_uid=study_uid,
            patient_id=str(getattr(ds, "PatientID", "") or "unknown"),
            modality=str(getattr(ds, "Modality", "") or "OT"),
            description=str(getattr(ds, "StudyDescription", "") or ""),
            owner_id=owner_id,
        )
        idx = len(study.instances)
        number = int(getattr(ds, "InstanceNumber", idx + 1) or idx + 1)
        sop_uid = str(getattr(ds, "SOPInstanceUID", "") or f"instance-{idx}")
        instances_dir = _study_dir(study_uid) / "instances"
        instances_dir.mkdir(parents=True, exist_ok=True)
        (instances_dir / f"{idx:04d}.dcm").write_bytes(data)
        study.instances.append(Instance(idx=idx, sop_uid=sop_uid, number=number))
        touched[study_uid] = study

    result = []
    for study in touched.values():
        _save_meta(study)
        result.append(study)
    return result


def list_studies() -> list[Study]:
    root = store_root()
    if not root.exists():
        return []
    studies = []
    for directory in sorted(root.iterdir()):
        if directory.is_dir():
            study = _load_meta(directory.name)
            if study is not None:
                studies.append(study)
    return studies


def get_study(study_uid: str) -> Study | None:
    return _load_meta(study_uid)


def read_instance(study_uid: str, idx: int) -> bytes | None:
    path = _study_dir(study_uid) / "instances" / f"{idx:04d}.dcm"
    if not path.exists():
        return None
    return path.read_bytes()
