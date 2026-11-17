import { describe, expect, it } from 'vitest';
import { createDefaultScenario, getSensor, projectStudyLandmark, computeMetrics } from './index';

function withLens(focalLengthMm: number) {
  const scenario = createDefaultScenario();
  scenario.cameras = scenario.cameras.map(camera => camera.id === 'main'
    ? { ...camera, lens: { ...camera.lens, focalLengthMm } } : camera);
  return scenario;
}

describe('frozen main study landmark', () => {
  it('projects named Main Quad landmark inside both 25 and 100 mm frames', () => {
    const short = withLens(25), long = withLens(100);
    const a = projectStudyLandmark(short, 0), b = projectStudyLandmark(long, 0);
    expect(a.label).toBe('Building 200, Main Quad');
    expect(a.pixel).not.toBeNull(); expect(b.pixel).not.toBeNull();
    const sensor = getSensor(short.cameras.find(c => c.id === 'main')!.sensorId, short.customSensor);
    for (const pixel of [a.pixel!, b.pixel!]) {
      expect(pixel[0]).toBeGreaterThan(0); expect(pixel[0]).toBeLessThan(sensor.width);
      expect(pixel[1]).toBeGreaterThan(0); expect(pixel[1]).toBeLessThan(sensor.height);
    }
    expect(b.pixel![0] - sensor.width / 2).toBeCloseTo(4 * (a.pixel![0] - sensor.width / 2), 6);
    expect(b.pixel![1] - sensor.height / 2).toBeCloseTo(4 * (a.pixel![1] - sensor.height / 2), 6);
  });
  it('uses the requested frozen time, and rejects an outside-frame landmark', () => {
    const scenario = withLens(25);
    scenario.pointing = 'nadir';
    const a = projectStudyLandmark(scenario, 0).pixel;
    const b = projectStudyLandmark(scenario, 5).pixel;
    expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(a).not.toEqual(b);
    scenario.offNadirDeg = 60;
    expect(projectStudyLandmark(scenario, 0).pixel).toBeNull();
  });
  it('rejects a landmark behind Earth even while tracking it', () => {
    const scenario = withLens(25);
    expect(projectStudyLandmark(scenario, 2800).pixel).toBeNull();
  });
  it('uses the imported target and shares the metrics visibility convention', () => {
    const scenario = withLens(25);
    scenario.target = { id: 'custom', name: 'Imported landmark', latitudeDeg: 40, longitudeDeg: -120, heightM: 0 };
    expect(projectStudyLandmark(scenario, 7)).toEqual({ label: 'Imported landmark', pixel: computeMetrics(scenario, 'main', 7).targetPixel });
  });
});
