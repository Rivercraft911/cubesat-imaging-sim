export const MAX_MOUNT_YAW_DEG = 180;
export const MAX_MOUNT_PITCH_DEG = 90;

export function mountTravelMm(faceSizeM: number, housingDiameterMm: number): number {
  return Math.max(0, (faceSizeM * 1000 - housingDiameterMm) / 2);
}

export function advanceMountCoordinate(value: number, step: number, travelLimit: number): number {
  // An imported coordinate outside the travel limits can be nudged back without jumping to its edge.
  const lower = Math.min(value, -travelLimit);
  const upper = Math.max(value, travelLimit);
  return Math.min(upper, Math.max(lower, value + step));
}

export function mountRightSign(id: 'wideA' | 'wideB'): 1 | -1 {
  return id === 'wideA' ? 1 : -1;
}
