import * as THREE from 'three/webgpu';
import { BAY_ELEVATION as dem } from '../data/bay-elevation';
import { EARTH_FLATTENING, geodeticToEcef } from '../sim/earth';

const polarScale = 1 - EARTH_FLATTENING;
const rad = Math.PI / 180;

/** Decode north-first RGB bytes before interpolation (one-meter code steps). */
export function globeReliefSampler(rgba: Uint8ClampedArray) {
  function height(x: number, y: number) {
    const i = (y * dem.width + x) * 4;
    return rgba[i] * 256 + rgba[i + 1];
  }
  return (lon: number, lat: number) => {
    const dx = Math.min(lon - dem.west, dem.east - lon);
    const dy = Math.min(lat - dem.south, dem.north - lat);
    if (dx <= 0 || dy <= 0) return 0;
    const x = THREE.MathUtils.clamp((lon - dem.west) * dem.width / (dem.east - dem.west) - 0.5, 0, dem.width - 1);
    const y = THREE.MathUtils.clamp((dem.north - lat) * dem.height / (dem.north - dem.south) - 0.5, 0, dem.height - 1);
    const i = Math.floor(x), j = Math.floor(y);
    const right = Math.min(dem.width - 1, i + 1), bottom = Math.min(dem.height - 1, j + 1);
    const topM = THREE.MathUtils.lerp(height(i, j), height(right, j), x - i);
    const bottomM = THREE.MathUtils.lerp(height(i, bottom), height(right, bottom), x - i);
    return THREE.MathUtils.lerp(topM, bottomM, y - j)
      * THREE.MathUtils.smoothstep(dx, 0, dem.edgeFeatherDeg) * THREE.MathUtils.smoothstep(dy, 0, dem.edgeFeatherDeg);
  };
}

/** Replace the coarse Bay cells with a finer indexed patch. The outer ring
 * references the exact coarse vertices, so there are no overlapping surfaces
 * or T-junctions. The inner grid samples real heights ~1.3–1.6 km apart. */
export function refineBayGlobe(globe: THREE.SphereGeometry, elevation: (lon: number, lat: number) => number) {
  const { widthSegments: cols, heightSegments: rows } = globe.parameters;
  const xCell = (lon: number) => (lon + 180) / 360 * cols;
  const yCell = (lat: number) => (0.5 - Math.atan(polarScale * Math.tan(lat * rad)) / Math.PI) * rows;
  // Keep the outer transition triangles clear of all displaced terrain.
  const x0 = Math.floor(xCell(dem.west - 0.05)), x1 = Math.ceil(xCell(dem.east + 0.05));
  const y0 = Math.floor(yCell(dem.north + 0.05)), y1 = Math.ceil(yCell(dem.south - 0.05));
  const steps = 48, nx = (x1 - x0) * steps, ny = (y1 - y0) * steps;
  const positions: number[] = [], uv: number[] = [], triangles: number[] = [];
  const ids = new Int32Array((nx + 1) * (ny + 1));
  const outer = new Map<number, number>();
  const basePositions = globe.getAttribute('position');
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const atBoundary = i === 0 || j === 0 || i === nx || j === ny;
      const gx = x0 + (atBoundary ? Math.round(i / steps) : i / steps);
      const gy = y0 + (atBoundary ? Math.round(j / steps) : j / steps);
      const baseIndex = gy * (cols + 1) + gx;
      const existing = atBoundary ? outer.get(baseIndex) : undefined;
      if (existing !== undefined) { ids[k] = existing; continue; }
      ids[k] = positions.length / 3;
      if (atBoundary) {
        outer.set(baseIndex, ids[k]);
        positions.push(basePositions.getX(baseIndex), basePositions.getY(baseIndex), basePositions.getZ(baseIndex));
      } else {
        const lon = gx * 360 / cols - 180;
        const reducedLatitude = Math.PI * (0.5 - gy / rows);
        const lat = Math.atan(Math.tan(reducedLatitude) / polarScale) / rad;
        const [x, y, z] = geodeticToEcef(lat, lon, elevation(lon, lat));
        positions.push(x, z / polarScale, -y);
      }
      uv.push(gx / cols, 1 - gy / rows);
    }
  }
  function face(a: number, b: number, c: number) {
    if (a !== b && b !== c && c !== a) triangles.push(a, b, c);
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i;
      face(ids[k + 1], ids[k], ids[k + nx + 2]);
      face(ids[k], ids[k + nx + 1], ids[k + nx + 2]);
    }
  }
  const patch = new THREE.BufferGeometry();
  patch.setIndex(triangles);
  patch.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  patch.computeVertexNormals();
  const normals = patch.getAttribute('normal'), baseNormals = globe.getAttribute('normal');
  for (const [base, id] of outer) normals.setXYZ(id, baseNormals.getX(base), baseNormals.getY(base), baseNormals.getZ(base));

  // The polar row has one triangle per cell. Interior rows have two.
  const old = globe.index!.array;
  // Put the coarse Bay cells at the tail of the original draw. A draw-range
  // change then restores the closed reference globe using the same GPU buffer.
  const outsideCount = old.length - 6 * (x1 - x0) * (y1 - y0);
  const indices = new Uint32Array(old.length);
  let bayWrite = outsideCount;
  let read = 0, write = 0;
  for (let row = y0; row < y1; row++) {
    const start = 3 * cols + 6 * ((row - 1) * cols + x0);
    indices.set(old.subarray(read, start), write);
    write += start - read;
    read = start + 6 * (x1 - x0);
    indices.set(old.subarray(start, read), bayWrite);
    bayWrite += read - start;
  }
  indices.set(old.subarray(read), write);
  globe.setIndex(new THREE.BufferAttribute(indices, 1));
  globe.setDrawRange(0, outsideCount);
  return patch;
}

export function addGlobeRelief(planet: THREE.Mesh<THREE.SphereGeometry>, texture: THREE.Texture) {
  const image = texture.image as HTMLImageElement | undefined;
  if (image?.width !== dem.width || image.height !== dem.height) return;
  const canvas = document.createElement('canvas');
  canvas.width = dem.width;
  canvas.height = dem.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  let pixels: ImageData;
  try {
    context.drawImage(image, 0, 0);
    pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return; // An unreadable image leaves the reference globe intact.
  }
  const patch = refineBayGlobe(planet.geometry, globeReliefSampler(pixels.data));
  const mesh = new THREE.Mesh(patch, planet.material);
  mesh.name = 'Bay Area terrain';
  planet.add(mesh);
  const outsideCount = planet.geometry.drawRange.count;
  return (enabled: boolean) => {
    mesh.visible = enabled;
    planet.geometry.setDrawRange(0, enabled ? outsideCount : Infinity);
  };
}
