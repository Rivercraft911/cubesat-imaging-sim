"""Build the Stanford night texture from NASA's registered ISS photo tiles.

Requires numpy, Pillow, rasterio and scipy. An optional directory caches tiles.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import urlopen

import numpy as np
from PIL import Image
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import reproject, Resampling
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
PHOTO = "ISS072-E-583361"
TILES = f"https://eol.jsc.nasa.gov/images/MapTiles/tiled_astronaut_photos/{PHOTO}/12"
BOUNDS = [-122.65, 37.12, -121.78, 37.88]
WIDTH, HEIGHT = 2400, 2600
HALF_WORLD_M = math.pi * 6378137
TILE_M = 2 * HALF_WORLD_M / 4096


def tile_at(lon, lat):
    return (math.floor((lon + 180) / 360 * 4096),
            math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 4096))


def fetch(cache, address):
    x, y = address
    path = cache / f"{PHOTO}-12-{x}-{y}.png"
    if not path.exists():
        try:
            with urlopen(f"{TILES}/{x}/{y}.png", timeout=30) as response:
                data = response.read()
        except HTTPError as error:
            if error.code != 404:
                raise
            data = b""  # Outside NASA's tiled footprint.
        path.write_bytes(data)
    data = path.read_bytes()
    return x, y, data


def linear_srgb(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def compare_display_levels(photo, assets):
    """Compare co-located opaque pixels on every fourth photo row and column."""
    luminance = np.array([0.2126, 0.7152, 0.0722])
    with Image.open(photo) as image:
        rgba = np.asarray(image.convert("RGBA"))[::4, ::4]
    mask = rgba[:, :, 3] >= 250
    observed = np.sum(linear_srgb(rgba[:, :, :3] / 255) * luminance, axis=2)
    reference = json.loads((assets / "earth-night-western-us.json").read_text())
    west, south, east, north = BOUNDS
    col = west + (np.arange(0, WIDTH, 4) + 0.5) * (east - west) / WIDTH
    row = north - (np.arange(0, HEIGHT, 4) + 0.5) * (north - south) / HEIGHT
    w, s, e, n = reference["bounds_deg_west_south_east_north"]
    with Image.open(assets / reference["file"]) as image:
        u = ((col - w) * image.width / (e - w)).astype(int)
        v = ((n - row) * image.height / (n - s)).astype(int)
        viirs = linear_srgb(np.asarray(image.convert("L"))[v[:, None], u] / 255)
    photo_mean = float(observed[mask].mean())
    viirs_mean = float(viirs[mask].mean() * np.dot([1, 0.88, 0.74], luminance))
    return {
        "meanPhoto": photo_mean, "meanTintedRegional": viirs_mean,
        "regionalGain": photo_mean / viirs_mean, "sampleCount": int(mask.sum()),
        "sample": "Nearest regional texel at each fourth photo pixel center with alpha >= 250.",
        "units": "Linear display luminance before pass lighting, arbitrary relative scale.",
        "regionalAssetSha256": reference["runtime_sha256"],
    }


def build(cache):
    cache.mkdir(parents=True, exist_ok=True)
    west, south, east, north = BOUNDS
    x0, y0 = tile_at(west, north)
    x1, y1 = tile_at(east, south)
    mosaic = Image.new("RGBA", ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
    digest = sha256()
    addresses = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for x, y, data in pool.map(lambda xy: fetch(cache, xy), addresses):
            digest.update(sha256(data).digest())
            if data:
                with Image.open(BytesIO(data)) as tile:
                    mosaic.paste(tile.convert("RGBA"), ((x - x0) * 256, (y - y0) * 256))

    output = np.zeros((4, HEIGHT, WIDTH), dtype=np.uint8)
    reproject(np.asarray(mosaic).transpose(2, 0, 1), output,
              src_crs="EPSG:3857", dst_crs="EPSG:4326", src_alpha=4, dst_alpha=4,
              src_transform=from_origin(-HALF_WORLD_M + x0 * TILE_M,
                                        HALF_WORLD_M - y0 * TILE_M, TILE_M / 256, TILE_M / 256),
              dst_transform=from_bounds(*BOUNDS, WIDTH, HEIGHT), resampling=Resampling.bilinear)
    # Taper the photograph into the regional lights over roughly 8 km, including the crop border.
    mask = output[3] > 0
    mask[[0, -1], :] = False
    mask[:, [0, -1]] = False
    blend = np.minimum(1, distance_transform_edt(mask) / 256)
    output[3] = np.rint(output[3] * blend**2 * (3 - 2 * blend))
    campus_x = int((-122.1697 - west) / (east - west) * WIDTH)
    campus_y = int((north - 37.4275) / (north - south) * HEIGHT)
    if output[3, campus_y, campus_x] != 255:
        raise ValueError("Georeferenced photo must cover Stanford")
    # Match the broad display level of the VIIRS crop before mip generation.
    # This shoulder retains RGB ratios in linear light and maps white to white.
    rgb = output[:3].astype(np.float32) / 255
    linear = linear_srgb(rgb)
    linear *= 12 / (1 + 11 * linear.max(axis=0))
    srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
    output[:3] = np.rint(255 * srgb).clip(0, 255).astype(np.uint8)
    path = ROOT / "public/assets/stanford-night-iss.webp"
    # Preserve dark gradients and isolated points of light through geographic resampling.
    Image.fromarray(output.transpose(1, 2, 0)).save(path, quality=97, method=6)
    meta = {
        "bounds": BOUNDS, "crs": "EPSG:4326", "size": [WIDTH, HEIGHT],
        "photo": PHOTO, "exposureUtc": "2025-01-24T05:36:48Z", "reportedSourceSpacingM": 10.7,
        "source": "https://eol.jsc.nasa.gov/SearchPhotos/photo.pl?mission=ISS072&roll=E&frame=583361",
        "credit": "Earth Science and Remote Sensing Unit, NASA Johnson Space Center",
        "tileTemplate": TILES + "/{x}/{y}.png",
        "tileRangeXYInclusive": [[x0, y0], [x1, y1]],
        "tileSetSha256": digest.hexdigest(), "fileSha256": sha256(path.read_bytes()).hexdigest(),
        "displayMatch": compare_display_levels(path, path.parent),
        "processing": "NASA z12 tiles (~30 m spacing at Stanford), projected to a ~32 m geographic grid. Linear RGB display transfer 12*RGB/(1+11*max(RGB)), then sRGB encoding. Coverage alpha has a 256-pixel smooth edge feather. WebP quality 97, method 6, lossless alpha. Separate acquisition, illustrative relative city-light brightness.",
    }
    (ROOT / "src/data/stanford-night.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(path, path.stat().st_size, digest.hexdigest())


if __name__ == "__main__":
    with TemporaryDirectory() as temp:
        build(Path(sys.argv[1] if len(sys.argv) > 1 else temp))
