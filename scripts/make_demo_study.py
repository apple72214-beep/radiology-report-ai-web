"""Generate a synthetic demo study into the local study store."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydicom.uid import generate_uid

from backend import studies
from backend.dicom_utils import create_synthetic_dicom


def main() -> None:
    study_uid = generate_uid()
    files = [
        (
            f"demo-{i:02d}.dcm",
            create_synthetic_dicom(index=i, study_uid=study_uid, seed=i),
        )
        for i in range(6)
    ]
    created = studies.ingest(owner_id="demo", files=files)
    for study in created:
        print(f"stored study {study.study_uid} with {len(study.instances)} instances")


if __name__ == "__main__":
    main()
