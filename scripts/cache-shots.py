"""Build bundled Bay Area shot rasters from CDFW's public USDA 2022 NAIP layer.

Requires Python 3 and Pillow. Run from any directory.
"""
import hashlib
import io
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlencode
from urllib.request import urlopen

from PIL import Image


SERVICE = 'https://gis.wildlife.ca.gov/images/rest/services/Base_Remote_Sensing/NAIP_2022/ImageServer'
CATALOG = 'https://catalog.data.gov/dataset/naip-2022-60cm-california'
PUBLIC_DOMAIN = 'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip'
DEST = Path(__file__).resolve().parents[1] / 'public/assets/shots'
GROUND_PITCH_M = 1.5
SHOTS = [
    ('stanford', 37.4275, -122.1697, 8192, 6144, ['stanford']),
    ('golden-gate', 37.8199, -122.4783, 6144, 6144, ['goldenGate']),
    ('bay-bridge', 37.8042, -122.3750, 6144, 6144, ['bayBridge', 'sanFrancisco']),
]
EXTENT_KEYS = ('xmin', 'ymin', 'xmax', 'ymax')


def mercator(lon, lat):
    radius = 6378137
    return radius * math.radians(lon), radius * math.asinh(math.tan(math.radians(lat)))


def export_tile(job):
    name, column, row, bounds, width, height = job
    params = urlencode({
        'bbox': ','.join(map(str, bounds)),
        'bboxSR': 3857, 'imageSR': 3857, 'size': f'{width},{height}',
        'format': 'png32', 'bandIds': '0,1,2', 'noData': '0,0,0',
        'noDataInterpretation': 'esriNoDataMatchAll', 'adjustAspectRatio': 'false',
        'interpolation': 'RSP_BilinearInterpolation', 'f': 'json',
    })
    request = f'{SERVICE}/exportImage?{params}'
    for attempt in range(3):
        try:
            with urlopen(request, timeout=35) as response:
                metadata = json.load(response)
            if 'error' in metadata:
                raise ValueError(f'Image export returned {metadata["error"]}')
            extent = metadata['extent']
            sr = extent['spatialReference']
            if sr.get('latestWkid', sr.get('wkid')) != 3857:
                raise ValueError(f'Unexpected raster spatial reference {sr}')
            if any(abs(extent[key] - expected) > 1e-5 for key, expected in zip(EXTENT_KEYS, bounds)):
                raise ValueError(f'Raster extent changed: {extent}')
            if (metadata['width'], metadata['height']) != (width, height):
                raise ValueError(f'Raster grid changed: {metadata}')
            with urlopen(metadata['href'], timeout=35) as response:
                data = response.read()
            with Image.open(io.BytesIO(data)) as raw:
                if raw.format != 'PNG' or raw.size != (width, height):
                    raise ValueError(f'Unexpected image {raw.format} {raw.size}')
                image = raw.convert('RGBA')
            print(f'{name}: tile {column},{row} verified ({len(data)/1e6:.1f} MB)', flush=True)
            return column, row, image
        except (KeyError, OSError, ValueError) as error:
            if attempt == 2:
                raise RuntimeError(f'{name} tile {column},{row} failed') from error


def build_shot(shot, pool, destination):
    name, lat, lon, width, height, targets = shot
    x, y = mercator(lon, lat)
    projected_pitch = GROUND_PITCH_M / math.cos(math.radians(lat))
    tile_w, tile_h = width // 2, height // 2
    half_span_x, half_span_y = tile_w * projected_pitch, tile_h * projected_pitch
    x_edges = [x - half_span_x, x, x + half_span_x]
    y_edges = [y + half_span_y, y, y - half_span_y]
    jobs = [
        (name, col, row, (x_edges[col], y_edges[row + 1], x_edges[col + 1], y_edges[row]), tile_w, tile_h)
        for row in range(2) for col in range(2)
    ]
    with Image.new('RGBA', (width, height)) as mosaic:
        for col, row, raster in pool.map(export_tile, jobs):
            mosaic.paste(raster, (col * tile_w, row * tile_h))
            raster.close()
        alpha = mosaic.getchannel('A').histogram()
        if alpha[-1] < width * height * 0.1:
            raise ValueError(f'{name} has less than 10% valid imagery')
        file = f'{name}.webp'
        output = destination / file
        mosaic.save(output, quality=90, method=4)
    print(f'{name}: bundled {output.stat().st_size/1e6:.1f} MB', flush=True)
    return {
        'id': f'cdfw-naip-2022-{name}', 'file': file, 'targetIds': targets,
        'width': width, 'height': height,
        'boundsMercator': [x_edges[0], y_edges[-1], x_edges[-1], y_edges[0]],
        'sourceResolutionM': GROUND_PITCH_M,
        'attribution': 'USDA NAIP 2022 · California Department of Fish and Wildlife',
        'source': SERVICE, 'catalog': CATALOG, 'publicDomain': PUBLIC_DOMAIN,
        'sourceNativeResolutionM': 0.6, 'sourceAcquisitionYear': 2022,
        'retrievedUTC': datetime.now(timezone.utc).isoformat(),
        'projectedPixelSpacingM': projected_pitch, 'transparentPixels': alpha[0],
        'processing': 'Four bilinear natural-color EPSG:3857 exports with returned extents verified. Stitched at matching pixel edges and encoded as WebP quality 90 with source alpha.',
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    }


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.shot-build-', dir=DEST.parent) as temporary:
        stage = Path(temporary)
        with ThreadPoolExecutor(max_workers=4) as pool:
            manifest = [build_shot(shot, pool, stage) for shot in SHOTS]
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for entry in manifest:
            (stage / entry['file']).replace(DEST / entry['file'])
        (stage / 'manifest.json').replace(DEST / 'manifest.json')


if __name__ == '__main__':
    main()
