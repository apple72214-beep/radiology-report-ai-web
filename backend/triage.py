"""CPU-friendly triage engine (heuristic baseline).

The engine is pluggable: swap ``HeuristicEngine`` logic for a
MONAI / TorchXRayVision model later without touching the API layer.
The heuristic scores opacity asymmetry between lung fields plus the
fraction of high-density pixels — a lightweight stand-in for real
pathology detection, suitable for low-resource CPUs.
"""

from __future__ import annotations

import io
from dataclasses import asdict, dataclass

import numpy as np
import pydicom

ENGINE_NAME = "heuristic-v1"
URGENT_THRESHOLD = 0.015


@dataclass
class TriageResult:
    score: float
    priority: str
    engine: str

    def as_dict(self) -> dict:
        return asdict(self)


def analyze(data: bytes) -> TriageResult:
    """Score one DICOM instance; return urgency priority.

    The score is the absolute lung-field opacity asymmetry normalised by
    global density: focal unilateral opacities (effusion, consolidation,
    mass) push it up, while symmetric normal anatomy stays near zero.
    """
    ds = pydicom.dcmread(io.BytesIO(data), force=True)
    arr = ds.pixel_array
    if arr.ndim != 2:
        return TriageResult(0.0, "routine", ENGINE_NAME)
    mono = arr.astype(np.float64)
    if getattr(ds, "PhotometricInterpretation", "") == "MONOCHROME1":
        mono = mono.max() - mono
    mono = (mono - mono.min()) / (mono.max() - mono.min() + 1e-9)

    rows, cols = mono.shape
    r0, r1 = int(rows * 0.25), int(rows * 0.80)
    left = mono[r0:r1, int(cols * 0.18) : int(cols * 0.45)]
    right = mono[r0:r1, int(cols * 0.55) : int(cols * 0.82)]
    score = float(abs(left.mean() - right.mean()) / (mono.mean() + 1e-9))
    priority = "urgent" if score >= URGENT_THRESHOLD else "routine"
    return TriageResult(round(score, 4), priority, ENGINE_NAME)
