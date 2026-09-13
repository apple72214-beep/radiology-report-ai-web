"""DICOM helpers: tolerant parsing and synthetic study generation."""

from __future__ import annotations

import io

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

CR_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.1"


def read_dataset(data: bytes) -> pydicom.Dataset:
    """Read a DICOM dataset tolerantly (missing meta headers allowed)."""
    return pydicom.dcmread(io.BytesIO(data), force=True)


def create_synthetic_dicom(
    index: int = 0,
    study_uid: str | None = None,
    series_uid: str | None = None,
    patient_id: str = "DEMO-0001",
    rows: int = 256,
    cols: int = 256,
    seed: int | None = None,
) -> bytes:
    """Create a synthetic chest-like CR instance for demos and tests."""
    rng = np.random.default_rng(seed if seed is not None else index)
    yy, xx = np.mgrid[0:rows, 0:cols]
    base = 1800 - 900 * (
        ((xx - cols / 2) / (cols / 2)) ** 2 + ((yy - rows / 2) / (rows / 2)) ** 2
    )
    lungs = 600 * np.exp(
        -(((xx - cols * 0.35) ** 2) / 1800 + ((yy - rows / 2) ** 2) / 3200)
    )
    lungs += 600 * np.exp(
        -(((xx - cols * 0.65) ** 2) / 1800 + ((yy - rows / 2) ** 2) / 3200)
    )
    blob = 350 * np.exp(
        -(((xx - cols * 0.62) ** 2) / 260 + ((yy - rows * 0.42) ** 2) / 260)
    )
    noise = rng.normal(0, 24, (rows, cols))
    pixels = np.clip(base - lungs + blob + noise, 0, 4095)
    arr = (pixels / 4095 * 4095).astype(np.uint16)

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = CR_IMAGE_STORAGE
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = Dataset()
    ds.file_meta = file_meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.SOPClassUID = CR_IMAGE_STORAGE
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = study_uid or generate_uid()
    ds.SeriesInstanceUID = series_uid or generate_uid()
    ds.PatientID = patient_id
    ds.Modality = "CR"
    ds.StudyDescription = "Synthetic chest demo"
    ds.InstanceNumber = index + 1
    ds.Rows = rows
    ds.Columns = cols
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    ds.PixelData = arr.tobytes()

    buf = io.BytesIO()
    pydicom.dcmwrite(buf, ds, enforce_file_format=True)
    return buf.getvalue()
