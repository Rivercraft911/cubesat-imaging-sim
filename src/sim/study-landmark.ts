import { cameraPose, projectVisibleGroundPoint } from './camera';
import { getSensor } from './catalog';
import { geodeticToEcef } from './earth';
import { sampleState } from './orbit';
import type { Scenario } from './types';

/** Stanford campus-map point for Building 200, Main Quad (surface, height 0 m).
 * This is a map landmark, not surveyed building elevation or a terrain model.
 * https://campus-map.stanford.edu/?id=01-200&lat=37.42807156&lng=-122.16855824&srch=building+200%2C+main+quad&zoom=17
 */
const STANFORD_LANDMARK = {
  name: 'Building 200, Main Quad', latitudeDeg: 37.42807156, longitudeDeg: -122.16855824, heightM: 0,
};

/** Project into the frozen main sensor at the supplied simulation time.
 * Null means Earth-occluded or outside the usable sensor/lens field of view.
 */
export function projectStudyLandmark(scenario: Scenario, timeS: number): {
  label: string; pixel: [number, number] | null;
} {
  const camera = scenario.cameras.find(config => config.id === 'main');
  if (!camera) throw new RangeError('Missing camera: main');
  const landmark = scenario.target.id === 'stanford' ? STANFORD_LANDMARK : scenario.target;
  const point = geodeticToEcef(landmark.latitudeDeg, landmark.longitudeDeg, landmark.heightM);
  return {
    label: landmark.name,
    pixel: projectVisibleGroundPoint(camera, getSensor(camera.sensorId, scenario.customSensor),
      cameraPose(sampleState(scenario, timeS), camera), point),
  };
}
