"""Prepare the small public Bay Area opening image. Requires Pillow.

The source is USGS's cached natural-color imagery, not synthetic geography.
Higher-resolution shot imagery is requested separately by the browser.
"""
import hashlib
import io
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer'
ZOOM = 12
BOUNDS = (-122.75, 37.20, -121.65, 38.15)
HALF = math.pi * 6378137


def xy(lon, lat):
    n = 2**ZOOM
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def main():
    west, south, east, north = BOUNDS
    x0, y0 = map(math.floor, xy(west, north))
    x1, y1 = map(math.floor, xy(east, south))
    output = Image.new('RGB', ((x1-x0+1)*256, (y1-y0+1)*256))
    coords = [(x, y) for y in range(y0, y1+1) for x in range(x0, x1+1)]

    def tile(coord):
        x, y = coord
        url = f'{BASE}/tile/{ZOOM}/{y}/{x}'
        for attempt in range(3):
            try:
                data = urlopen(url, timeout=25).read()
                return coord, Image.open(io.BytesIO(data)).convert('RGB')
            except Exception:
                if attempt == 2:
                    raise

    with ThreadPoolExecutor(max_workers=10) as pool:
        for (x, y), img in pool.map(tile, coords):
            output.paste(img, ((x-x0)*256, (y-y0)*256))
    scale = 2 * HALF / 2**ZOOM
    bounds = [x0*scale-HALF, HALF-(y1+1)*scale, (x1+1)*scale-HALF, HALF-y0*scale]
    # Preserve the documented intermediate JPEG used for the initial preview.
    encoded = io.BytesIO()
    output.save(encoded, format='JPEG', quality=94, subsampling=0)
    output = Image.open(io.BytesIO(encoded.getvalue())).convert('RGB')
    r, g, b = output.split()
    output.putalpha(ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda x: 0 if x <= 2 else 255))
    dest = ROOT/'public/assets/bay-preview.webp'
    output.save(dest, quality=94, method=6)
    manifest = {
        'id': 'usgs-bay-preview-z12', 'file': 'bay-preview.webp',
        'width': output.width, 'height': output.height, 'boundsMercator': bounds,
        'sourceResolutionM': scale/256*math.cos(math.radians(37.7)),
        'attribution': 'USDA / USGS · The National Map',
        'source': BASE, 'tileLevel': ZOOM, 'tiles': {'x': [x0, x1], 'y': [y0, y1]},
        'acquisitionDate': None, 'retrievedUTC': datetime.now(timezone.utc).isoformat(),
        'processing': 'Native cached 256px tiles mosaicked without geographic resampling; intermediate JPEG quality94 4:4:4, then WebP quality94. All RGB channels <=2 interpreted as missing coverage and made transparent.',
        'limits': 'Dated aerial mosaic with baked illumination; opening preview, not the source detail limit.',
        'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()
    }
    (dest.parent/'bay-preview.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(f'Prepared {output.width}x{output.height} from {len(coords)} tiles; {dest.stat().st_size/1e6:.1f} MB')


if __name__ == '__main__':
    main()
