import type { Quat, Vec3 } from './types';

export const DEG = Math.PI / 180;
export const TAU = 2 * Math.PI;

export const clamp = (x: number, low: number, high: number): number => Math.min(high, Math.max(low, x));
export const wrap = (x: number, period: number): number => ((x % period) + period) % period;
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(...a);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));
export const inverseRotation = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];

export function rotationZ([x, y, z]: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c * x - s * y, s * x + c * y, z];
}

export function axisRotation(axis: Vec3, angleRad: number): Quat {
  const [x, y, z] = scale(axis, Math.sin(angleRad / 2));
  return [x, y, z, Math.cos(angleRad / 2)];
}

/** Compose active rotations, applying b first. */
export function composeRotation(a: Quat, b: Quat): Quat {
  const av: Vec3 = [a[0], a[1], a[2]];
  const bv: Vec3 = [b[0], b[1], b[2]];
  const [x, y, z] = add(add(scale(av, b[3]), scale(bv, a[3])), cross(av, bv));
  return [x, y, z, a[3] * b[3] - dot(av, bv)];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const axis: Vec3 = [q[0], q[1], q[2]];
  const twiceCross = scale(cross(axis, v), 2);
  return add(v, add(scale(twiceCross, q[3]), cross(axis, twiceCross)));
}

/** Convert right-handed, orthonormal matrix columns to an active rotation. */
export function basisRotation(x: Vec3, y: Vec3, z: Vec3): Quat {
  const trace = x[0] + y[1] + z[2];
  if (trace > 0) {
    const s = 2 * Math.sqrt(1 + trace);
    return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = 2 * Math.sqrt(1 + x[0] - y[1] - z[2]);
    return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  }
  if (y[1] > z[2]) {
    const s = 2 * Math.sqrt(1 + y[1] - x[0] - z[2]);
    return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  }
  const s = 2 * Math.sqrt(1 + z[2] - x[0] - y[1]);
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}
