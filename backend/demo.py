"""Synthetic demo study seeding (used by scripts and app startup)."""

from __future__ import annotations

from pydicom.uid import generate_uid

from . import studies
from .dicom_utils import create_synthetic_dicom


def seed_demo() -> list[studies.Study]:
    """Create one urgent and one routine synthetic study if store is empty."""
    urgent_uid = generate_uid()
    routine_uid = generate_uid()
    files = [
        (
            f"demo-urgent-{i:02d}.dcm",
            create_synthetic_dicom(
                index=i, study_uid=urgent_uid, seed=i, lesion=True,
                patient_id="DEMO-0001",
            ),
        )
        for i in range(6)
    ]
    files += [
        (
            f"demo-routine-{i:02d}.dcm",
            create_synthetic_dicom(
                index=i, study_uid=routine_uid, seed=100 + i, lesion=False,
                patient_id="DEMO-0002",
            ),
        )
        for i in range(4)
    ]
    return studies.ingest(owner_id="demo", files=files)
