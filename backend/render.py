"""Server-side DICOM frame rendering to PNG.

Rendering on the server keeps the viewer offline-friendly: no external
JavaScript libraries or CDNs are required in the browser, which suits
low-resource deployments.
"""

from __future__ import annotations

import io

import numpy as np
import pydicom
from PIL import Image

# Window presets (center, width) in HU; applied only for CT densities.
PRESETS: dict[str, tuple[float, float] | None] = {
    "auto": None,
    "lung": (-600.0, 1600.0),
    "mediastinum": (40.0, 400.0),
    "bone": (300.0, 1500.0),
}


def render_png(data: bytes, preset: str = "auto") -> bytes:
    """Render one DICOM instance to an 8-bit grayscale (or RGB) PNG."""
    ds = pydicom.dcmread(io.BytesIO(data), force=True)
    arr = ds.pixel_array

    if arr.ndim == 3:  # RGB / palette-expanded frames
        img = Image.fromarray(arr.astype(np.uint8))
    else:
        mono = arr.astype(np.float64)
        if getattr(ds, "PhotometricInterpretation", "") == "MONOCHROME1":
            mono = mono.max() - mono
        window = PRESETS.get(preset)
        modality = str(getattr(ds, "Modality", ""))
        if window is not None and modality == "CT":
            center, width = window
            low, high = center - width / 2, center + width / 2
        else:
            low, high = np.percentile(mono, [2, 98])
        if high <= low:
            high = low + 1
        scaled = np.clip((mono - low) / (high - low), 0.0, 1.0)
        img = Image.fromarray((scaled * 255).astype(np.uint8))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
