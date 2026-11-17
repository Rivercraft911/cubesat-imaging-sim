"""Build the West Coast texture from Terra MODIS. Requires Pillow."""

from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from math import cos, radians, sin, sqrt
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageChops, __version__ as pillow_version, features


WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
ACQUIRED = "2025-03-25"
ATTRIBUTION = "NASA GIBS / Terra MODIS true color, 2025-03-25 UTC"
# Full default 25 mm Stanford pass, with room for the geographic edge blend.
BOUNDS = (-131.25, 23.0, -114.0, 52.0)
QUADRANT_SIZE = 4096
SIZE = QUADRANT_SIZE * 2
ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "assets"
CACHE_DIR = ROOT / "data" / "gibs-west-coast"


def fetch_quadrant(bounds):
    # WMS 1.1.1 uses longitude, latitude order for EPSG:4326.
    params = {
        "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": LAYER,
        "STYLES": "", "SRS": "EPSG:4326", "BBOX": ",".join(map(str, bounds)), "TIME": ACQUIRED,
        "WIDTH": QUADRANT_SIZE, "HEIGHT": QUADRANT_SIZE, "FORMAT": "image/png", "TRANSPARENT": "TRUE",
    }
    url = f"{WMS}?{urlencode(params)}"
    cache_path = CACHE_DIR / f"{sha256(url.encode()).hexdigest()}.png"
    cached = cache_path.is_file()
    if cached:
        raw = cache_path.read_bytes()
    else:
        request = Request(url, headers={"User-Agent": "CubeSat-Imaging-Sim regional asset build"})
        with urlopen(request, timeout=120) as response:
            if response.headers.get_content_type() != "image/png":
                raise ValueError(f"WMS did not return a PNG for {bounds}")
            raw = response.read()

    with Image.open(BytesIO(raw)) as source:
        if source.size != (QUADRANT_SIZE, QUADRANT_SIZE) or source.mode != "RGBA":
            raise ValueError(f"Unexpected raster format for {bounds}: {source.size}, {source.mode}")
        if source.getchannel("A").getextrema() != (255, 255):
            raise ValueError(f"Acquisition has transparent pixels within {bounds}")
        tile = source.convert("RGB")
    if not cached:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix(".tmp")
        temporary.write_bytes(raw)
        temporary.replace(cache_path)
    return tile, {
        "url": url,
        "bounds_lon_lat_deg": bounds,
        "bytes": len(raw),
        "sha256": sha256(raw).hexdigest(),
        "cache_file": str(cache_path.relative_to(ROOT)),
        "cached_utc": datetime.fromtimestamp(cache_path.stat().st_mtime, timezone.utc).isoformat(),
    }


def ground_grid_at_center():
    west, south, east, north = BOUNDS
    latitude = radians((south + north) / 2)
    d_latitude = radians((north - south) / SIZE)
    d_longitude = radians((east - west) / SIZE)
    semimajor_m = 6378137
    flattening = 1 / 298.257223563
    eccentricity_squared = flattening * (2 - flattening)
    q = 1 - eccentricity_squared * sin(latitude) ** 2
    prime_vertical_m = semimajor_m / sqrt(q)
    meridional_m = semimajor_m * (1 - eccentricity_squared) / q ** 1.5
    return {
        "east_west": prime_vertical_m * cos(latitude) * d_longitude,
        "north_south": meridional_m * d_latitude,
    }


def main():
    west, south, east, north = BOUNDS
    mid_lon, mid_lat = (west + east) / 2, (south + north) / 2
    quadrants = [
        ("northwest", (west, mid_lat, mid_lon, north), (0, 0)),
        ("northeast", (mid_lon, mid_lat, east, north), (QUADRANT_SIZE, 0)),
        ("southwest", (west, south, mid_lon, mid_lat), (0, QUADRANT_SIZE)),
        ("southeast", (mid_lon, south, east, mid_lat), (QUADRANT_SIZE, QUADRANT_SIZE)),
    ]
    atlas = Image.new("RGB", (SIZE, SIZE))
    sources = []
    for name, bounds, origin in quadrants:
        print(f"Fetching {name} quadrant", flush=True)
        tile, source = fetch_quadrant(bounds)
        atlas.paste(tile, origin)
        tile.close()
        sources.append({"name": name, **source})

    # Missing swaths can be opaque black in this NASA browse layer.
    red, green, blue = atlas.split()
    black_pixels = ImageChops.lighter(ImageChops.lighter(red, green), blue).histogram()[0]
    if black_pixels > 100:
        raise ValueError(f"Unexpected area of exact black pixels in the daily acquisition: {black_pixels}")
    del red, green, blue

    # Record examples from the provider's true-color visualization.
    samples = {}
    for label, (lon, lat) in {
        "offshore_pacific": (-128.0, 37.7),
        "coastal_pacific": (-123.2, 37.7),
        "san_francisco_bay": (-122.4, 37.835),
        "stanford": (-122.1697, 37.4275),
    }.items():
        x = int((lon - west) * SIZE / (east - west))
        y = int((north - lat) * SIZE / (north - south))
        rgb = atlas.getpixel((x, y))
        if rgb == (0, 0, 0):
            raise ValueError(f"Unexpected empty pixel at {label}")
        samples[label] = {"lon_lat_deg": [lon, lat], "rgb_before_webp": rgb}

    print(f"Encoding {SIZE} × {SIZE} WebP", flush=True)
    webp = BytesIO()
    atlas.save(webp, format="WEBP", quality=90, method=4)
    encoded = webp.getvalue()
    if len(encoded) > 15_000_000:
        raise ValueError(f"West Coast texture exceeds the 15 MB asset budget: {len(encoded)} bytes")
    image_path = OUTPUT_DIR / "west-coast-regional.webp"
    image_path.write_bytes(encoded)
    metadata = {
        "id": f"nasa-terra-modis-west-coast-{ACQUIRED}",
        "file": image_path.name,
        "publisher": "NASA Earthdata Global Imagery Browse Services (GIBS)",
        "credit": ATTRIBUTION,
        "license": "NASA open data and imagery with acknowledgment",
        "license_url": "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        "license_source": "https://nasa-gibs.github.io/gibs-api-docs/#data-use-guidance-and-acknowledgements",
        "publisher_page": "https://nasa-gibs.github.io/gibs-api-docs/access-basics/",
        "source_layer": LAYER,
        "source_tile_matrix": "250m",
        "acquisition_date_utc": ACQUIRED,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "runtime_dimensions": [SIZE, SIZE],
        "crs": "EPSG:4326",
        "bounds_deg": {"west": west, "east": east, "south": south, "north": north},
        "angular_pixel_spacing_deg": [(east - west) / SIZE, (north - south) / SIZE],
        "center_pixel_spacing_m": ground_grid_at_center(),
        "transform": "Four WMS-rendered RGB quadrants pasted on a common north-up grid. No local resampling or color changes. WebP quality 90, method 4.",
        "limits": (
            "Daily true-color browse imagery includes observed clouds, atmosphere and Terra granule geometry. "
            "An acquisition join is visible at the far northwest edge. The reported pixel spacing describes "
            "the served display grid resampled from the nominal 250 m GIBS product."
        ),
        "source_quadrants": sources,
        "coverage_samples": samples,
        "exact_black_pixels_before_webp": black_pixels,
        "runtime_bytes": len(encoded),
        "runtime_sha256": sha256(encoded).hexdigest(),
        "software": {"pillow": pillow_version, "libwebp": features.version("webp")},
    }
    image_path.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {image_path.name} ({len(encoded):,} bytes)")


if __name__ == "__main__":
    main()
