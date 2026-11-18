import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { BAY_ELEVATION as dem } from '../data/bay-elevation';
import { ecefToGeodetic, EARTH_EQUATORIAL_RADIUS_M, EARTH_FLATTENING } from '../sim/earth';
import { globeReliefSampler, refineBayGlobe } from './globe-relief';

it('interpolates elevations across byte carries and tapers the two geographic edges independently', () => {
  const bytes = new Uint8ClampedArray(dem.width * dem.height * 4);
  for (let j = 0; j < dem.height; j++) {
    for (let i = 0; i < dem.width; i++) {
      const offset = (j * dem.width + i) * 4;
      if (i < dem.width / 2) bytes[offset + 1] = 255;
      else bytes[offset] = 1;
    }
  }
  const height = globeReliefSampler(bytes);
  expect(height((dem.west + dem.east) / 2, 37.5)).toBeCloseTo(255.5);
  expect(height(dem.west + 0.02, dem.north - 0.02)).toBeCloseTo(255 / 4);
  expect(height(dem.west, 37.5)).toBe(0);
});

it('registers unexaggerated relief in the globe frame and stitches its perimeter to the base mesh', () => {
  const globe = new THREE.SphereGeometry(EARTH_EQUATORIAL_RADIUS_M, 512, 256);
  const original = globe.index!.array.slice();
  const patch = refineBayGlobe(globe, (lon, lat) =>
    lon > dem.west && lon < dem.east && lat > dem.south && lat < dem.north ? 735 : 0);
  try {
    const restored = globe.index!.array;
    expect(restored.length).toBe(original.length);
    expect(restored.length - globe.drawRange.count).toBe(4 * 5 * 6);
    // Compare intact ordered triangle triples, allowing the Bay cells to draw last.
    const triangles = (indices: ArrayLike<number>) => {
      const keys = new Set<number>();
      for (let i = 0; i < indices.length; i += 3)
        keys.add((indices[i] * 150000 + indices[i + 1]) * 150000 + indices[i + 2]);
      return keys;
    };
    const flat = triangles(restored);
    for (const tri of triangles(original)) if (!flat.delete(tri)) throw new Error('Missing coarse cell');
    expect(flat.size).toBe(0);
    const pos = patch.getAttribute('position');
    const { latitudeDeg, longitudeDeg, heightM } = ecefToGeodetic([
      pos.getX(Math.floor(pos.count / 2)), -pos.getZ(Math.floor(pos.count / 2)),
      pos.getY(Math.floor(pos.count / 2)) * (1 - EARTH_FLATTENING),
    ]);
    expect(latitudeDeg).toBeGreaterThan(dem.south);
    expect(latitudeDeg).toBeLessThan(dem.north);
    expect(longitudeDeg).toBeGreaterThan(dem.west);
    expect(longitudeDeg).toBeLessThan(dem.east);
    expect(Math.abs(heightM - 735)).toBeLessThan(0.5);

    // Pair every triangle edge with the opposite edge. A closed patch has
    // exactly one unmatched edge per coarse-grid interval on its perimeter.
    const unmatched = new Set<number>();
    const index = patch.index!.array;
    for (let i = 0; i < index.length; i += 3) {
      for (let edge = 0; edge < 3; edge++) {
        const a = index[i + edge], b = index[i + (edge + 1) % 3];
        if (!unmatched.delete(b * pos.count + a)) unmatched.add(a * pos.count + b);
      }
    }
    expect(unmatched.size).toBe(18); // 4 × 5 coarse cells
    const base = globe.getAttribute('position');
    const keys = new Set<string>();
    const key = (p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
      [p.getX(i), p.getY(i), p.getZ(i)].join(',');
    for (let i = 0; i < base.count; i++) keys.add(key(base, i));
    for (const edge of unmatched) expect(keys.has(key(pos, Math.floor(edge / pos.count)))).toBe(true);
  } finally {
    patch.dispose();
    globe.dispose();
  }
});
