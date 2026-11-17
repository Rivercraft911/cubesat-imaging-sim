"""Prepare the western 2016 annual VIIRS light-emission display layer.

Run with numpy, rasterio and Pillow, optionally passing a previously downloaded
source GeoTIFF. The Zenodo deposit identifies 2016 as an observed VNL year.
"""
import hashlib
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import Window, bounds

ASSETS = Path(__file__).resolve().parents[1] / "public" / "assets"
NAME = "nightlights.average_viirs.v21_m_500m_s_20160101_20161231_go_epsg4326_v20250904.tif"
URL = "https://zenodo.org/api/records/17294744/files/" + NAME + "/content"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare(path):
    source_digest = digest(path)
    if source_digest != "319ef2d91a2ff4733c61a555a81f05b483c9b47463b1f91f00bbc5385556ca45":
        raise ValueError("Source differs from the checked 2016 GeoTIFF.")
    with rasterio.open(path) as dataset:
        window = Window(11840, 9889, 4096, 4096)
        extent = bounds(window, dataset.transform)
        samples = dataset.read(1, window=window, masked=True)
        if np.ma.count_masked(samples):
            raise ValueError("Crop contains missing samples")
        radiance = np.maximum(0, samples.data.astype(np.float32)) / 10
    # Fixed illustrative display shoulder; bright cities retain local contrast.
    linear = radiance / (radiance + 35)
    srgb = np.where(linear <= 0.0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - 0.055)
    pixels = np.rint(255 * srgb).astype(np.uint8)
    output = ASSETS / "earth-night-western-us.webp"
    Image.fromarray(pixels).save(output, lossless=True, method=6)
    with Image.open(output) as encoded:
        np.testing.assert_array_equal(pixels, np.asarray(encoded.convert("L")))
    meta = {
        "file": output.name, "source_url": URL, "source_sha256": source_digest,
        "runtime_sha256": digest(output), "source_record": "https://doi.org/10.5281/zenodo.17294744",
        "credit": "T. Hengl (OpenGeoHub), derived from Earth Observation Group Annual VNL V2.1",
        "source_license": "CC BY 4.0", "acquisition_epoch": "2016 annual composite",
        "source_paper": "https://doi.org/10.3390/rs13050922",
        "crs": "EPSG:4326", "bounds_deg_west_south_east_north": extent,
        "window_col_row_width_height": list(window.flatten()), "pixel_spacing_arcseconds": 15,
        "source_units": "Publisher integer equals ten times VNL DNB radiance in nW cm^-2 sr^-1.",
        "display": "Native grid crop. For radiance R >= 0 use linear intensity R/(R+35), then sRGB encoding and nearest 8-bit code. Lossless WebP. Display mapping, tint and emission gain are illustrative. No calibrated camera response.",
    }
    (ASSETS / "earth-night-western-us.json").write_text(json.dumps(meta, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        prepare(Path(sys.argv[1]))
    else:
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / NAME
            urllib.request.urlretrieve(URL, local)
            prepare(local)
