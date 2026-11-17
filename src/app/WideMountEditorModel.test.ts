import { describe, expect, it } from 'vitest';
import { advanceMountCoordinate, MAX_MOUNT_PITCH_DEG, mountRightSign, mountTravelMm } from '../sim/wide-mount';
import { padCoordinate, padValue } from './WideMountEditorModel';

describe('wide mount pad', () => {
  it('insets each body edge by the housing radius', () => {
    expect(mountTravelMm(0.1, 14)).toBe(43);
    expect(mountTravelMm(0.12, 14)).toBe(53);
    expect(padCoordinate(43, 50, 43)).toBeCloseTo(0.93);
    expect(padValue(1, 50, 43)).toBe(43);
    expect(padValue(0, 60, 53)).toBe(-53);
    expect(mountTravelMm(0.01, 14)).toBe(0);
    expect(padValue(0.75, 5, 0)).toBe(0);
  });

  it('uses the same aim range for pointer edits and the indicator', () => {
    expect(padValue(0.75, MAX_MOUNT_PITCH_DEG, MAX_MOUNT_PITCH_DEG)).toBe(45);
    expect(padCoordinate(45, MAX_MOUNT_PITCH_DEG, MAX_MOUNT_PITCH_DEG)).toBe(0.75);
    expect(padCoordinate(-127, MAX_MOUNT_PITCH_DEG, MAX_MOUNT_PITCH_DEG)).toBe(0);
  });

  it('nudges imported coordinates in place toward the editable range', () => {
    expect(advanceMountCoordinate(127, -1, 90)).toBe(126);
    expect(advanceMountCoordinate(127, 1, 90)).toBe(127);
    expect(advanceMountCoordinate(-127, 1, 90)).toBe(-126);
    expect(advanceMountCoordinate(-127, -1, 90)).toBe(-127);
    expect(advanceMountCoordinate(41, 5, 43)).toBe(43);
  });

  it('maps image right to opposite body axes on the two mount faces', () => {
    expect(mountRightSign('wideA')).toBe(1);
    expect(mountRightSign('wideB')).toBe(-1);
  });
});
