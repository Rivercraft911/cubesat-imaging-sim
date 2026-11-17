function clampToPad(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

export function padCoordinate(value: number, displayLimit: number, travelLimit: number): number {
  return 0.5 + clampToPad(value, travelLimit) / (2 * displayLimit);
}

export function padValue(fraction: number, displayLimit: number, travelLimit: number): number {
  const value = (2 * fraction - 1) * displayLimit;
  return clampToPad(Math.round(value * 10) / 10, travelLimit);
}
