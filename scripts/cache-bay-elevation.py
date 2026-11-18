"""Build Bay Area land relief from USGS 3DEP and NHD. Requires NumPy and Pillow."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/bay-elevation"
OUTPUT = ROOT / "public/assets/bay-elevation.png"
W, S, E, N = -123.1, 36.55, -120.8, 38.45
WIDTH, HEIGHT = 1536, 1792
BBOX = f"{W},{S},{E},{N}"
DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
HYDRO = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer"


def fetch(endpoint, params, filename):
    cache_file = CACHE / filename
    if not cache_file.exists():
        with urlopen(endpoint + "?" + urlencode(params), timeout=120) as response:
            raw = response.read()
        cache_file.write_bytes(raw)
    raw = cache_file.read_bytes()
    print(filename, hashlib.sha256(raw).hexdigest())
    return raw


def index_xy(lon, lat):
    return ((lon - W) * WIDTH / (E - W), (N - lat) * HEIGHT / (N - S))


def water_mask():
    mask = Image.new("1", (WIDTH, HEIGHT))
    # NHD large-scale area and waterbody feature types. Union the polygons
    # individually to preserve terrestrial islands and overlapping features.
    for layer, codes in [(9, "445,312"), (12, "493")]:
        payload = fetch(f"{HYDRO}/{layer}/query", dict(
            f="geojson", geometry=BBOX, geometryType="esriGeometryEnvelope", inSR=4326,
            outSR=4326, where=f"ftype in ({codes})", returnGeometry="true",
            outFields="ftype,gnis_name", maxAllowableOffset=0.00015, geometryPrecision=5,
        ), f"nhd-{layer}.json")
        features = json.loads(payload)
        if not features["features"] or features.get("exceededTransferLimit"):
            raise ValueError("Incomplete NHD response")
        for feature in features["features"]:
            g = feature["geometry"]
            if g["type"] not in ("Polygon", "MultiPolygon"):
                raise ValueError(g["type"])
            polygons = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            for rings in polygons:
                patch = Image.new("1", mask.size)
                draw = ImageDraw.Draw(patch)
                for i, ring in enumerate(rings):
                    draw.polygon([index_xy(*p) for p in ring], fill=int(i == 0))
                mask = ImageChops.logical_or(mask, patch)
    return np.asarray(mask)


def main():
    CACHE.mkdir(exist_ok=True, parents=True)
    raw = fetch(f"{DEM}/exportImage", dict(
        f="image", bbox=BBOX, bboxSR=4326, imageSR=4326, size=f"{WIDTH},{HEIGHT}",
        format="tiff", pixelType="F32", interpolation="RSP_BilinearInterpolation",
        renderingRule='{"rasterFunction":"None"}', adjustAspectRatio="false", compression="LZ77",
    ), "3dep.tif")
    with Image.open(BytesIO(raw)) as source:
        assert source.mode == "F" and source.size == (WIDTH, HEIGHT)
        np.testing.assert_allclose(source.tag_v2[33550][:2], [(E-W)/WIDTH, (N-S)/HEIGHT])
        np.testing.assert_allclose(source.tag_v2[33922], [0, 0, 0, W, N, 0])
        dem = np.array(source)
    assert np.all(np.isfinite(dem)) and np.min(dem) > -500 and np.max(dem) < 2000
    heights = np.rint(np.maximum(dem, 0)).astype(np.uint16)
    heights[water_mask()] = 0
    assert heights.max() <= 1300, "Update the ray-search ceiling in bay-elevation.ts for this source"
    # Catch flipped axes, incorrect projections, missing marine coverage or a
    # rendered hillshade accidentally supplied by the service. Summit heights
    # are lower than published point maxima at this grid spacing.
    for lon, lat, lo, hi in [(-122.85, 37.3, 0, 0), (-122.33, 37.8, 0, 0),
                              (-122.18, 37.57, 0, 0), (-122.1697, 37.4275, 15, 50),
                              (-121.9142, 37.8816, 1050, 1180), (-121.8444, 37.1109, 1050, 1160)]:
        x, y = map(int, index_xy(lon, lat))
        assert lo <= heights[y, x] <= hi, (lon, lat, heights[y, x])
    rgb = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    rgb[:, :, 0] = heights >> 8
    rgb[:, :, 1] = heights & 255
    Image.fromarray(rgb).save(OUTPUT, compress_level=9)
    with Image.open(OUTPUT) as saved:
        channels = np.asarray(saved, dtype=np.uint16)
        np.testing.assert_array_equal(channels[:, :, 0]*256 + channels[:, :, 1], heights)
    print(OUTPUT.name, hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), OUTPUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
