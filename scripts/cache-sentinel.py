"""Build the regional Bay mosaic from the fixed Sentinel-2B pass.

Requires Python 3.13, NumPy, Rasterio, and Pillow. The script reads the needed
windows of the public COGs and writes bay-regional.webp and bay-regional.json.
"""

from contextlib import ExitStack
from datetime import datetime, timezone
from hashlib import file_digest
import json
from math import cos, radians
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen

import numpy as np
from PIL import Image, __version__ as pillow_version, features
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.merge import merge
from rasterio.transform import from_bounds, rowcol
from rasterio.warp import reproject, transform, transform_bounds


COLLECTION = "https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a"
TILES = ("10SDG", "10SEG", "10SFG", "10SDH", "10SEH", "10SFH")
DATATAKE = "20250324T190338"
# Contains the six default closest-approach shot bounds, including their gutter.
MERCATOR_BOUNDS = (-13692500, 4461476.466949167, -13533500, 4608235.561256707)
NATIVE_CRS = "EPSG:32610"
OUTPUT_CRS = "EPSG:3857"
HEIGHT = 6144
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "assets"
LEGAL_NOTICE = "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice"


def source_tile(tile):
    item_id = f"S2B_T{tile}_{DATATAKE}_L2A"
    item_url = f"{COLLECTION}/items/{item_id}"
    with urlopen(item_url, timeout=30) as response:
        item = json.load(response)
    visual = item["assets"]["visual"]
    return {
        "id": item_id,
        "item": item_url,
        "visualCog": visual["href"],
        "checksumMultihash": visual["file:checksum"],
        "sensedUTC": item["properties"]["datetime"],
        "tileCloudCoverPct": item["properties"]["eo:cloud_cover"],
        "nativeShape": visual["proj:shape"],
        "nativeTransform": visual["proj:transform"],
    }


def validate_source(dataset, source):
    if (
        dataset.crs != NATIVE_CRS
        or dataset.res != (10, 10)
        or dataset.dtypes != ("uint8",) * 3
        or dataset.colorinterp != (ColorInterp.red, ColorInterp.green, ColorInterp.blue)
        or list(dataset.shape) != source["nativeShape"]
        or list(dataset.transform)[:6] != source["nativeTransform"]
    ):
        raise ValueError(f"Unexpected native raster for {source['id']}")


def warp_rgb(sources, output_transform, width):
    native_bounds = transform_bounds(OUTPUT_CRS, NATIVE_CRS, *MERCATOR_BOUNDS)
    rgb = np.zeros((3, HEIGHT, width), dtype=np.uint8)
    with TemporaryDirectory(prefix="bay-sentinel-") as directory, ExitStack() as stack:
        stack.enter_context(rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
            CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
            GDAL_HTTP_TIMEOUT=60,
            GDAL_HTTP_MAX_RETRY=3,
            GDAL_HTTP_RETRY_DELAY=2,
        ))
        datasets = []
        for source in sources:
            dataset = stack.enter_context(rasterio.open(source["visualCog"]))
            validate_source(dataset, source)
            datasets.append(dataset)

        # Stitch aligned 10 m UTM pixels first. The output is area-resampled once.
        native_path = Path(directory) / "native.tif"
        merge(
            datasets, bounds=native_bounds, res=10, target_aligned_pixels=True,
            nodata=0, method="first", dst_path=native_path, mem_limit=64,
            dst_kwds={"tiled": True, "blockxsize": 512, "blockysize": 512},
        )
        with rasterio.open(native_path) as native:
            reproject(
                rasterio.band(native, [1, 2, 3]), rgb, dst_crs=OUTPUT_CRS,
                dst_transform=output_transform, src_nodata=0, dst_nodata=0,
                resampling=Resampling.average, num_threads=4,
            )
    return np.moveaxis(rgb, 0, -1)


def verify_coverage(rgb, output_transform):
    valid_count = int(np.count_nonzero(rgb.any(axis=2)))
    total_count = rgb.shape[0] * rgb.shape[1]
    if valid_count != total_count:
        raise ValueError(f"{total_count - valid_count} uncovered pixels in the regional rectangle")
    water_rgb = {}
    for name, (longitude, latitude) in {
        "centralBay": (-122.40, 37.835),
        "southBay": (-122.18, 37.55),
        "pacific": (-122.74, 37.75),
    }.items():
        x, y = transform("EPSG:4326", OUTPUT_CRS, [longitude], [latitude])
        row, col = rowcol(output_transform, x[0], y[0])
        water_rgb[name] = {"lonLat": [longitude, latitude], "rgb": rgb[row, col].tolist()}
    return {"validPixels": valid_count, "sampleWaterRgbBeforeWebp": water_rgb}


def main():
    sources = [source_tile(tile) for tile in TILES]
    west, south, east, north = MERCATOR_BOUNDS
    width = round(HEIGHT * (east - west) / (north - south))
    output_transform = from_bounds(*MERCATOR_BOUNDS, width, HEIGHT)
    spacing = [output_transform.a, -output_transform.e]
    geographic_bounds = transform_bounds(OUTPUT_CRS, "EPSG:4326", *MERCATOR_BOUNDS)
    _, lat = transform(OUTPUT_CRS, "EPSG:4326", [(east + west) / 2], [(north + south) / 2])
    print(f"Reading {len(sources)} tiles for {width} × {HEIGHT} regional mosaic", flush=True)
    rgb = warp_rgb(sources, output_transform, width)
    coverage = verify_coverage(rgb, output_transform)

    image_path = OUTPUT_DIR / "bay-regional.webp"
    Image.fromarray(rgb).save(image_path, format="WEBP", quality=90, method=4)
    with image_path.open("rb") as image:
        digest = file_digest(image, "sha256").hexdigest()
    metadata = {
        "id": "sentinel-2b-bay-regional-2025-03-24",
        "file": image_path.name,
        "width": width,
        "height": HEIGHT,
        "boundsMercator": MERCATOR_BOUNDS,
        "boundsWgs84": geographic_bounds,
        "outputCrs": OUTPUT_CRS,
        "outputTransform": list(output_transform)[:6],
        "mapGridSpacingM": spacing,
        "sourceResolutionM": max(spacing) * cos(radians(lat[0])),
        "resolutionNote": "Output ground spacing approximated at the mosaic center by EPSG:3857 spacing times cos(latitude).",
        "nativeCrs": NATIVE_CRS,
        "nativeGridSpacingM": 10,
        "attribution": "Contains modified Copernicus Sentinel data 2025",
        "license": LEGAL_NOTICE,
        "source": COLLECTION,
        "sourceAssets": sources,
        "acquisitionDate": "2025-03-24",
        "retrievedUTC": datetime.now(timezone.utc).isoformat(),
        "processing": (
            "Same-pass Sentinel-2B L2A visual COGs (B04/B03/B02). "
            "Mosaicked on their native UTM grid, first valid pixel in listed order, "
            "then reprojected with GDAL area-average to the regional Web Mercator grid. "
            "Black NoData is excluded. No synthetic fill, sharpening, or extra color mapping. "
            "WebP quality 90, method 4."
        ),
        "coverageCheck": coverage,
        "software": {
            "rasterio": rasterio.__version__,
            "gdal": rasterio.__gdal_version__,
            "numpy": np.__version__,
            "pillow": pillow_version,
            "libwebp": features.version("webp"),
        },
        "sha256": digest,
    }
    (OUTPUT_DIR / "bay-regional.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {image_path.name} with {coverage['validPixels']:,} valid pixels and SHA-256 {digest}")


if __name__ == "__main__":
    main()
