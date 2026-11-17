"""Build the regional cloud texture from the original NASA PNG. Requires Pillow."""

from argparse import ArgumentParser
from hashlib import file_digest, sha256
from io import BytesIO
import json
from math import floor
from pathlib import Path

from PIL import Image, ImageChops, __version__ as pillow_version, features


SOURCE_URL = "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud.W.2001210.21600x21600.png"
SOURCE_PAGE = "https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/"
SOURCE_SHA256 = "d7a6b03bb54b8ba56f72af6d1d49f191a25c12e911c43739c900e893d10eb814"
SOURCE_SIZE = (21600, 21600)
SOURCE_BOUNDS = {"west": -180, "south": -90, "east": 0, "north": 90}
SAMPLES_PER_DEGREE = SOURCE_SIZE[0] // 180
# Native pixel edges (left, top, right, bottom) matching the West Coast imagery.
CROP = (5850, 4560, 7920, 8040)
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "assets"
OUTPUT = OUTPUT_DIR / "earth-clouds-western-us-v2.png"
METADATA = OUTPUT_DIR / "earth-clouds-western-us.json"


def soft_toe(code):
    t = min(1, code / 64)
    return floor(code * t * t * (3 - 2 * t) + 0.5)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help=f"Local copy of {SOURCE_URL}")
    path = parser.parse_args().source
    with path.open("rb") as stream:
        if file_digest(stream, "sha256").hexdigest() != SOURCE_SHA256:
            raise ValueError("Source SHA-256 differs from the verified NASA western hemisphere")

    Image.MAX_IMAGE_PIXELS = SOURCE_SIZE[0] * SOURCE_SIZE[1]
    with Image.open(path) as source:
        if source.format != "PNG" or source.size != SOURCE_SIZE or source.mode != "L":
            raise ValueError("Expected a 21600 × 21600 grayscale NASA PNG")
        with source.crop(CROP) as crop:
            coverage = crop.point([soft_toe(code) for code in range(256)])

    encoded = BytesIO()
    with coverage:
        size = coverage.size
        coverage.info.clear()  # Keep coverage codes independent of display color profiles.
        coverage.save(encoded, format="PNG", compress_level=9)
        encoded.seek(0)
        with Image.open(encoded) as decoded:
            if ImageChops.difference(decoded, coverage).getbbox():
                raise ValueError("PNG encoding changed coverage values")
    pixels = encoded.getvalue()
    left, top, right, bottom = CROP
    west, north = SOURCE_BOUNDS["west"], SOURCE_BOUNDS["north"]
    metadata = {
        "schema_version": "1.0",
        "revision": "nasa-blue-marble-cloud-2001-west-coast-soft-toe-v2",
        "file": OUTPUT.name,
        "publisher_page": SOURCE_PAGE,
        "source_url": SOURCE_URL,
        "credit": "NASA Goddard Space Flight Center / Reto Stöckli; compositing enhancements by Robert Simmon",
        "license": "NASA imagery-use guidelines with source acknowledgment and no implied endorsement.",
        "license_url": "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        "acquisition_epoch": "2001 multiday composite, released 2002",
        "retrieved_utc": "2026-10-25T12:35:17.946446+00:00",
        "source_dimensions": SOURCE_SIZE,
        "source_bytes": path.stat().st_size,
        "source_sha256": SOURCE_SHA256,
        "source_tile_bounds_deg": SOURCE_BOUNDS,
        "crop_pixel_box": CROP,
        "bounds_deg": {
            "west": west + left / SAMPLES_PER_DEGREE,
            "south": north - bottom / SAMPLES_PER_DEGREE,
            "east": west + right / SAMPLES_PER_DEGREE,
            "north": north - top / SAMPLES_PER_DEGREE,
        },
        "angular_pixel_spacing_deg": 1 / SAMPLES_PER_DEGREE,
        "published_nominal_resolution_m": 1000,
        "runtime_dimensions": size,
        "runtime_bytes": len(pixels),
        "runtime_sha256": sha256(pixels).hexdigest(),
        "transform": "Exact native pixel crop. Apply the global map's display transfer before GPU filtering, then encode as lossless grayscale PNG. No resampling.",
        "display_transfer": {
            "revision": "cloud-mask-soft-toe-v1",
            "formula": "For source code c in [0,255], t=min(1,c/64); output=floor(c*t*t*(3-2*t)+0.5).",
            "stage": "Applied to source texels before encoding. Runtime samples the prepared coverage directly.",
        },
        "limits": "Static display opacity based on a historical composite. Cloud altitude, illumination and optical behavior are illustrative.",
        "software": {"pillow": pillow_version, "zlib": features.version("zlib")},
    }
    OUTPUT.write_bytes(pixels)
    METADATA.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.name} ({size[0]} × {size[1]}, {len(pixels):,} bytes)")


if __name__ == "__main__":
    main()
