"""Generate synthetic demo studies into the local study store."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.demo import seed_demo


def main() -> None:
    for study in seed_demo():
        print(f"stored study {study.study_uid} with {len(study.instances)} instances")


if __name__ == "__main__":
    main()
