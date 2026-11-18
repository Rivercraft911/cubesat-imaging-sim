import * as THREE from 'three/webgpu';
import type { CameraId } from '../sim';

type Triangle = { p: number[]; min: number[]; max: number[]; center: number[]; owner?: CameraId; glass: boolean };
type Branch = { min: number[]; max: number[]; start: number; end: number; left: number; right: number };
const cache = new WeakMap<THREE.Group, GuideOcclusion>();

/** A body-frame acceleration structure for editor-only optical obstruction.
 * Geometry, not shaded pixels, decides visibility. It is rebuilt with CAD. */
class TriangleIndex {
  readonly triangles: Triangle[] = [];
  private order: number[] = [];
  private branches: Branch[] = [];
  private stack: number[] = [];

  constructor(root: THREE.Group, owner?: CameraId) {
    const inverseRoot = root.matrixWorld.clone().invert();
    const point = new THREE.Vector3();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !(object.layers.mask & 1)) return;
      if (!owner) {
        for (let parent = object.parent; parent && parent !== root; parent = parent.parent) {
          if (parent.userData.cameraId) return;
        }
      }
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      // Current camera mounts have physical glass and standard opaque barrels.
      // Solar-cell coverglass is outside a camera mount and remains a blocker.
      const glass = Boolean(owner && material instanceof THREE.MeshPhysicalMaterial);
      const matrix = inverseRoot.clone().multiply(object.matrixWorld);
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.index;
      const count = index ? index.count : positions.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const p: number[] = [];
        for (let corner = 0; corner < 3; corner++) {
          point.fromBufferAttribute(positions, index ? index.getX(i + corner) : i + corner).applyMatrix4(matrix);
          p.push(point.x, point.y, point.z);
        }
        const min = [0, 1, 2].map(axis => Math.min(p[axis], p[axis + 3], p[axis + 6]));
        const max = [0, 1, 2].map(axis => Math.max(p[axis], p[axis + 3], p[axis + 6]));
        this.triangles.push({ p, min, max, center: min.map((v, axis) => (v + max[axis]) / 2), owner, glass });
      }
    });
    this.order = this.triangles.map((_, i) => i);
    if (this.order.length) this.build(0, this.order.length);
  }

  private build(start: number, end: number): number {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const triangle = this.triangles[this.order[i]];
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], triangle.min[axis]);
        max[axis] = Math.max(max[axis], triangle.max[axis]);
      }
    }
    const id = this.branches.length;
    const branch: Branch = { min, max, start, end, left: -1, right: -1 };
    this.branches.push(branch);
    if (end - start <= 12) return id;
    const size = max.map((v, axis) => v - min[axis]);
    const axis = size.indexOf(Math.max(...size));
    const midpoint = (min[axis] + max[axis]) / 2;
    let left = start, right = end - 1;
    while (left <= right) {
      if (this.triangles[this.order[left]].center[axis] < midpoint) left++;
      else { [this.order[left], this.order[right]] = [this.order[right], this.order[left]]; right--; }
    }
    if (left === start || left === end) left = (start + end) >>> 1;
    branch.left = this.build(start, left);
    branch.right = this.build(left, end);
    return id;
  }

  trace(origin: THREE.Vector3, direction: THREE.Vector3, cameraId: CameraId) {
    if (!this.branches.length) return null;
    const o = [origin.x, origin.y, origin.z], d = [direction.x, direction.y, direction.z];
    let closest = Infinity, triangleId = -1;
    this.stack.length = 0;
    this.stack.push(0);
    while (this.stack.length) {
      const branch = this.branches[this.stack.pop()!];
      let near = 0, far = closest;
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(d[axis]) < 1e-14) {
          if (o[axis] < branch.min[axis] || o[axis] > branch.max[axis]) { far = -1; break; }
        } else {
          const a = (branch.min[axis] - o[axis]) / d[axis], b = (branch.max[axis] - o[axis]) / d[axis];
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
        }
      }
      if (far < near) continue;
      if (branch.left >= 0) { this.stack.push(branch.left, branch.right); continue; }
      for (let i = branch.start; i < branch.end; i++) {
        const id = this.order[i], triangle = this.triangles[id];
        if (triangle.glass && triangle.owner === cameraId) continue;
        const p = triangle.p;
        const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
        const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
        const hx = d[1] * bz - d[2] * by, hy = d[2] * bx - d[0] * bz, hz = d[0] * by - d[1] * bx;
        const determinant = ax * hx + ay * hy + az * hz;
        if (Math.abs(determinant) < 1e-15) continue;
        const tx = o[0] - p[0], ty = o[1] - p[1], tz = o[2] - p[2];
        const u = (tx * hx + ty * hy + tz * hz) / determinant;
        if (u < 0 || u > 1) continue;
        const qx = ty * az - tz * ay, qy = tz * ax - tx * az, qz = tx * ay - ty * ax;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) / determinant;
        if (v < 0 || u + v > 1) continue;
        const distance = (bx * qx + by * qy + bz * qz) / determinant;
        if (distance > 1e-5 && distance < closest) { closest = distance; triangleId = id; }
      }
    }
    return triangleId < 0 ? null : { triangleId, distance: closest };
  }
}

/** Rigid camera mounts keep a local triangle index. Only rays and highlighted
 * vertices cross the mount/body boundary when a camera is moved or tilted. */
export class GuideOcclusion {
  private readonly parts;
  readonly triangleCount: number;
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(ship: THREE.Group) {
    ship.updateWorldMatrix(true, true);
    let offset = 0;
    const mounts = ship.children.filter((part): part is THREE.Group =>
      part instanceof THREE.Group && Boolean(part.userData.cameraId));
    this.parts = [ship, ...mounts].map(root => {
      const index = new TriangleIndex(root, root.userData.cameraId);
      const part = { mount: root === ship ? null : root, index, offset, inverse: new THREE.Matrix4() };
      offset += index.triangles.length;
      return part;
    });
    this.triangleCount = offset;
  }

  updateMounts() {
    for (const part of this.parts) {
      if (part.mount) {
        part.mount.updateMatrix();
        part.inverse.copy(part.mount.matrix).invert();
      }
    }
  }

  trace(origin: THREE.Vector3, direction: THREE.Vector3, cameraId: CameraId) {
    let closest: { triangleId: number; distance: number } | null = null;
    for (const part of this.parts) {
      // Same first-party lens masking rule as the hardware capture.
      if (part.mount?.userData.cameraId === cameraId && part.mount.userData.catalogLensHousing) continue;
      this.origin.copy(origin);
      this.direction.copy(direction);
      if (part.mount) {
        this.origin.applyMatrix4(part.inverse);
        this.direction.transformDirection(part.inverse);
      }
      const hit = part.index.trace(this.origin, this.direction, cameraId);
      if (hit && (!closest || hit.distance < closest.distance)) {
        closest = { triangleId: part.offset + hit.triangleId, distance: hit.distance };
      }
    }
    return closest;
  }

  vertex(triangleId: number, corner: number, target: THREE.Vector3) {
    for (const part of this.parts) {
      const triangle = part.index.triangles[triangleId - part.offset];
      if (!triangle) continue;
      target.fromArray(triangle.p, corner * 3);
      if (part.mount) target.applyMatrix4(part.mount.matrix);
      return target;
    }
    throw new RangeError('Unknown obstruction triangle');
  }
}

export function getGuideOcclusion(ship: THREE.Group): GuideOcclusion {
  let index = cache.get(ship);
  if (!index) { index = new GuideOcclusion(ship); cache.set(ship, index); }
  index.updateMounts();
  return index;
}
