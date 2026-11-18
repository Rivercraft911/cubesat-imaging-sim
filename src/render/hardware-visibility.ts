import * as THREE from 'three/webgpu';
import { cameraBodyRotation } from '../sim/camera';
import type { CameraConfig, SensorProfile } from '../sim';

/** Conservative rejection of whole triangles against a padded rectilinear
 * sensor frustum. Triangles crossing the frame with all vertices outside may
 * still contribute: only a shared outside plane proves a triangle invisible. */
export function createHardwareVisibility(cubeSize: number, cubeNear: number) {
  let previousShip: THREE.Group | undefined;
  let previousKey = '';
  let visible = true;
  return (ship: THREE.Group, camera: CameraConfig, sensor: SensorProfile, geometryRevision: number) => {
    const pitchOverFocal = sensor.pixelPitchUm * 0.001 / camera.lens.focalLengthMm;
    if (camera.id !== 'main' || camera.lens.projection !== 'rectilinear' ||
        !(pitchOverFocal > 0 && pitchOverFocal * cubeSize <= 0.25)) return true;
    const key = [geometryRevision, ...camera.positionBodyM, sensor.width, sensor.height, pitchOverFocal].join(':');
    if (ship === previousShip && key === previousKey) return visible;
    previousKey = key;
    previousShip = ship;
    // Cube texel coordinates are ratios of direction components. On each
    // dominant-axis face their angular gradient is at most sqrt(6)/2 times
    // face width. The pitch bound above keeps sampling at mip zero. Expand
    // every frustum side by eight face-center texels for bilinear footprints,
    // including across face seams. Limit the fast path to moderate view angles.
    const halfX = Math.atan(sensor.width * pitchOverFocal / 2);
    const halfY = Math.atan(sensor.height * pitchOverFocal / 2);
    if (Math.max(halfX, halfY) > Math.PI / 4) {
      visible = true;
      return visible;
    }
    const guard = 16 / cubeSize;
    const xSlope = Math.tan(halfX + guard), ySlope = Math.tan(halfY + guard);
    // Cube face depth is never greater than ray distance. Half of the closest
    // possible forward depth leaves clearance for float transforms at the pupil.
    const near = 0.5 * cubeNear / Math.hypot(1, xSlope, ySlope);
    ship.updateWorldMatrix(true, true);
    const fromCamera = new THREE.Matrix4().compose(new THREE.Vector3(...camera.positionBodyM),
      new THREE.Quaternion(...cameraBodyRotation(camera)), new THREE.Vector3(1, 1, 1));
    const cameraFromWorld = ship.matrixWorld.clone().multiply(fromCamera).invert();
    const transform = new THREE.Matrix4(), p = new THREE.Vector3();
    visible = false;
    ship.traverse(object => {
      if (visible || !(object instanceof THREE.Mesh) || !object.layers.isEnabled(0)) return;
      transform.multiplyMatrices(cameraFromWorld, object.matrixWorld);
      const positions = object.geometry.getAttribute('position'), index = object.geometry.index;
      const codes = new Uint8Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(transform);
        let outside = 0;
        if (p.z < near) outside |= 1;
        if (p.x < -p.z * xSlope) outside |= 2;
        if (p.x > p.z * xSlope) outside |= 4;
        if (p.y < -p.z * ySlope) outside |= 8;
        if (p.y > p.z * ySlope) outside |= 16;
        codes[i] = outside;
      }
      const count = index?.count ?? positions.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const a = index ? index.getX(i) : i;
        const b = index ? index.getX(i + 1) : i + 1;
        const c = index ? index.getX(i + 2) : i + 2;
        if ((codes[a] & codes[b] & codes[c]) === 0) { visible = true; break; }
      }
    });
    return visible;
  };
}
