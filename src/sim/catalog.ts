import type { CameraConfig, Scenario, SensorProfile, Target } from './types';

const PI_CAMERAS = 'https://www.raspberrypi.com/documentation/accessories/camera.html';
const DEFAULT_SENSOR_ID = 'imx676';

export const SENSOR_PROFILES: readonly SensorProfile[] = [
  {
    id: 'imx676', name: 'Sony IMX676', width: 3536, height: 3536, pixelPitchUm: 2,
    shutter: 'rolling', source: 'https://www.sony-semicon.com/files/62/flyer_security/IMX676-AACR1_Flyer.pdf',
    note: 'Sony recommended recording area, all-pixel mode.',
  },
  {
    id: 'imx678', name: 'Sony IMX678', width: 3840, height: 2160, pixelPitchUm: 2,
    shutter: 'rolling', source: 'https://www.sony-semicon.com/files/62/flyer_security/IMX678-AAQR1_Flyer.pdf',
    note: 'Sony recommended recording area, all-pixel mode.',
  },
  {
    id: 'imx900', name: 'Sony IMX900', width: 2048, height: 1536, pixelPitchUm: 2.25,
    shutter: 'global', source: 'https://www.sony-semicon.com/files/62/flyer_industry/IMX900-AMR_Flyer.pdf',
    note: 'Sony recommended recording area, all-pixel mode.',
  },
  {
    id: 'imx219', name: 'Pi Camera Module 2 · IMX219', width: 3280, height: 2464, pixelPitchUm: 1.12,
    shutter: 'rolling', source: PI_CAMERAS,
  },
  {
    id: 'imx355', name: 'Pi Camera Module 2 · IMX355', width: 3280, height: 2464, pixelPitchUm: 1.12,
    shutter: 'rolling', source: PI_CAMERAS,
    note: 'Raspberry Pi Camera Module 2 produced from November 2026.',
  },
  {
    id: 'imx708', name: 'Pi Camera Module 3 · IMX708', width: 4608, height: 2592, pixelPitchUm: 1.4,
    shutter: 'rolling', source: PI_CAMERAS,
  },
  {
    id: 'imx477', name: 'Pi HQ Camera · IMX477', width: 4056, height: 3040, pixelPitchUm: 1.55,
    shutter: 'rolling', source: PI_CAMERAS,
  },
  {
    id: 'imx296', name: 'Pi Global Shutter Camera · IMX296', width: 1456, height: 1088, pixelPitchUm: 3.45,
    shutter: 'global', source: PI_CAMERAS,
  },
  {
    id: 'custom', name: 'Custom sensor', width: 3840, height: 2160, pixelPitchUm: 2,
    shutter: 'rolling', source: '', note: 'Editable recording dimensions, pixel pitch and shutter type.',
  },
];

export function getSensor(id: string, customSensor?: Scenario['customSensor']): SensorProfile {
  const profile = SENSOR_PROFILES.find(sensor => sensor.id === id);
  if (!profile) throw new RangeError(`Unknown sensor profile: ${id}`);
  return id === 'custom' ? { ...profile, ...customSensor } : profile;
}

// Approximate scene centers on the reference ellipsoid. Landmark elevations are omitted.
export const TARGETS: readonly Target[] = [
  { id: 'stanford', name: 'Stanford', latitudeDeg: 37.4275, longitudeDeg: -122.1697, heightM: 0 },
];

function wideCamera(id: 'wideA' | 'wideB', faceY: number): CameraConfig {
  const sensor = getSensor(DEFAULT_SENSOR_ID);
  const imageCircleMm = Math.min(sensor.width, sensor.height) * sensor.pixelPitchUm / 1000;
  return {
    id, name: id === 'wideA' ? 'Wide A' : 'Wide B', sensorId: sensor.id,
    lens: {
      focalLengthMm: imageCircleMm / 2 / (95 * Math.PI / 180), fNumber: 2.8,
      projection: 'equidistant', maxFovDeg: 190, imageCircleMm, extraBlurPx: 0,
    },
    positionBodyM: [id === 'wideA' ? -0.035 : 0.035, faceY, 0.040],
    yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    exposureMs: 1, jitterArcsec: 0, readoutMs: 0, housingDiameterMm: 14, housingLengthMm: 10,
  };
}

export function createDefaultScenario(): Scenario {
  return {
    version: 1, target: { ...TARGETS[0] }, altitudeM: 550_000,
    epochISO: '2026-11-17T00:00:00.000Z', ltanHours: 18, ascending: true, passOffsetKm: 0,
    pointing: 'target', offNadirDeg: 0, rollDeg: 0,
    body: {
      widthM: 0.1, depthM: 0.1, heightM: 0.1135,
      panelWidthM: 0.088, panelLengthM: 0.101, panelAngleDeg: 90,
    },
    cameras: [
      {
        id: 'main', name: 'Main', sensorId: DEFAULT_SENSOR_ID,
        lens: {
          focalLengthMm: 25, fNumber: 4, projection: 'rectilinear',
          maxFovDeg: 180, imageCircleMm: 11, extraBlurPx: 0,
        },
        positionBodyM: [-0.023, 0.055, -0.022], yawDeg: 0, pitchDeg: 0, rollDeg: 0,
        exposureMs: 1, jitterArcsec: 0, readoutMs: 0, housingDiameterMm: 24, housingLengthMm: 35,
      },
      wideCamera('wideA', 0.055),
      wideCamera('wideB', -0.055),
    ],
  };
}
