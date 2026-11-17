import type { CameraConfig, Scenario, SensorProfile, Target } from './types';

const PI_CAMERAS = 'https://www.raspberrypi.com/documentation/accessories/camera.html';

export const SENSOR_PROFILES: readonly SensorProfile[] = [
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
  { id: 'goldenGate', name: 'Golden Gate Bridge', latitudeDeg: 37.8199, longitudeDeg: -122.4783, heightM: 0 },
  { id: 'sanFrancisco', name: 'San Francisco', latitudeDeg: 37.7920, longitudeDeg: -122.4070, heightM: 0 },
  { id: 'bayBridge', name: 'Bay Bridge', latitudeDeg: 37.8042, longitudeDeg: -122.3750, heightM: 0 },
  { id: 'southBay', name: 'South Bay', latitudeDeg: 37.4800, longitudeDeg: -122.0950, heightM: 0 },
  { id: 'wholeBay', name: 'San Francisco Bay', latitudeDeg: 37.6820, longitudeDeg: -122.2770, heightM: 0 },
];

function wideCamera(id: 'wideA' | 'wideB', faceY: number): CameraConfig {
  const sensor = getSensor('imx678');
  const imageCircleMm = sensor.height * sensor.pixelPitchUm / 1000;
  return {
    id, name: id === 'wideA' ? 'Wide A' : 'Wide B', sensorId: sensor.id,
    lens: {
      focalLengthMm: imageCircleMm / 2 / (95 * Math.PI / 180), fNumber: 2.8,
      projection: 'equidistant', maxFovDeg: 190, imageCircleMm, extraBlurPx: 0,
    },
    positionBodyM: [id === 'wideA' ? -0.034 : 0.034, faceY, 0.038],
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
        id: 'main', name: 'Main', sensorId: 'imx678',
        lens: {
          focalLengthMm: 50, fNumber: 4, projection: 'rectilinear',
          maxFovDeg: 180, imageCircleMm: 9, extraBlurPx: 0,
        },
        positionBodyM: [-0.023, 0.055, 0.012], yawDeg: 0, pitchDeg: 0, rollDeg: 0,
        exposureMs: 1, jitterArcsec: 0, readoutMs: 0, housingDiameterMm: 24, housingLengthMm: 35,
      },
      wideCamera('wideA', 0.055),
      wideCamera('wideB', -0.055),
    ],
  };
}
