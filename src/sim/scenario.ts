import { getSensor } from './catalog';
import { LENS_PROFILES } from './lens-profiles';
import { sampleState } from './orbit';
import type { CameraConfig, CameraId, ExposureStudy, Lens, MainImageModel, Scenario, Vec3 } from './types';

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function label(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new TypeError(`${field} must be nonempty text up to 120 characters.`);
  }
  return value;
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${field} must be between ${min} and ${max}.`);
  }
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const result = number(value, field, min, max);
  if (!Number.isInteger(result)) throw new RangeError(`${field} must be an integer.`);
  return result;
}

function choice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  const result = choices.find(option => option === value);
  if (result === undefined) throw new TypeError(`${field} is invalid.`);
  return result;
}

function date(value: unknown): string {
  const dateValue = label(value, 'Epoch');
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.exec(dateValue);
  const time = Date.parse(dateValue);
  if (!match || !Number.isFinite(time)) throw new TypeError('Epoch must be an ISO UTC date.');
  const iso = new Date(time).toISOString();
  if (iso.slice(0, 10) !== match[1] || time < Date.UTC(1800, 0, 1) || time >= Date.UTC(2200, 0, 1)) {
    throw new RangeError('Epoch must be a valid date from 1800 through 2199.');
  }
  return iso;
}

function parseLens(value: unknown): Lens {
  const lens = object(value, 'Lens');
  const projection = choice(lens.projection, 'Lens projection', ['rectilinear', 'equidistant', 'equisolid']);
  const profileId = lens.profileId === undefined ? undefined
    : choice(lens.profileId, 'Lens profile', LENS_PROFILES.map(profile => profile.id));
  const fThetaEdgeFactor = lens.fThetaEdgeFactor === undefined ? undefined
    : number(lens.fThetaEdgeFactor, 'F-theta edge factor', -0.25, 1);
  if (fThetaEdgeFactor && projection !== 'equidistant') {
    throw new TypeError('A nonzero F-theta edge factor requires the equidistant projection.');
  }
  return {
    projection,
    focalLengthMm: number(lens.focalLengthMm, 'Focal length (mm)', 0.01, 10_000),
    fNumber: number(lens.fNumber, 'F-number', 0.1, 128),
    maxFovDeg: number(lens.maxFovDeg, 'Lens FOV (deg)', 0.1, projection === 'rectilinear' ? 180 : 360),
    imageCircleMm: number(lens.imageCircleMm, 'Image circle (mm)', 0.001, 1000),
    extraBlurPx: number(lens.extraBlurPx, 'Extra blur (px)', 0, 1000),
    ...(profileId === undefined ? {} : { profileId }),
    ...(fThetaEdgeFactor === undefined ? {} : { fThetaEdgeFactor }),
  };
}

const CAMERA_IDS = ['main', 'wideA', 'wideB'] as const;
const MAIN_IMAGE_MODELS = ['pass', 'reference', 'twilight'] as const;

function parseExposureStudy(study: Record<string, unknown>): ExposureStudy {
  return {
    diffuseFraction: number(study.diffuseFraction, 'Diffuse irradiance fraction', 0, 1),
    referenceElectronsPerMs: number(study.referenceElectronsPerMs, 'Reference electrons/ms', 0, 1e9),
    readNoiseElectrons: number(study.readNoiseElectrons, 'Read noise (electrons)', 0, 1e5),
    fullWellElectrons: number(study.fullWellElectrons, 'Full well (electrons)', 1, 1e9),
    gain: number(study.gain, 'Study gain', 0.01, 1e4),
  };
}

function parseCamera(value: unknown, customSensor: Scenario['customSensor']): CameraConfig {
  const camera = object(value, 'Camera');
  const id = choice(camera.id, 'Camera ID', CAMERA_IDS);
  const sensorId = label(camera.sensorId, 'Sensor ID');
  getSensor(sensorId, customSensor);
  const position = camera.positionBodyM;
  if (!Array.isArray(position) || position.length !== 3) throw new TypeError('Camera position requires three body coordinates.');
  const positionBodyM: Vec3 = [0, 1, 2].map(axis => number(position[axis], 'Camera position (m)', -10, 10)) as Vec3;
  const yawDeg = number(camera.yawDeg, 'Camera yaw (deg)', -360, 360);
  const pitchDeg = number(camera.pitchDeg, 'Camera pitch (deg)', -360, 360);
  const rollDeg = number(camera.rollDeg, 'Camera roll (deg)', -360, 360);
  const study = camera.exposureStudy === undefined ? undefined : object(camera.exposureStudy, 'Exposure study');
  const legacyEnabled = study?.enabled;
  if (legacyEnabled !== undefined && typeof legacyEnabled !== 'boolean') {
    throw new TypeError('Exposure study enabled must be true or false.');
  }
  const legacyModel: MainImageModel | undefined =
    legacyEnabled === undefined ? undefined : legacyEnabled ? 'twilight' : 'reference';
  const imageModel = camera.mainImageModel === undefined
    ? legacyModel
    : choice(camera.mainImageModel, 'Main image model', MAIN_IMAGE_MODELS);
  return {
    id, name: label(camera.name, 'Camera name'), sensorId,
    positionBodyM, lens: parseLens(camera.lens),
    yawDeg: id === 'main' ? 0 : yawDeg,
    pitchDeg: id === 'main' ? 0 : pitchDeg,
    rollDeg: id === 'main' ? 0 : rollDeg,
    ...(id === 'main' && imageModel !== undefined ? { mainImageModel: imageModel } : {}),
    ...(study ? { exposureStudy: parseExposureStudy(study) } : {}),
    exposureMs: number(camera.exposureMs, 'Exposure (ms)', 0, 100_000),
    jitterArcsec: number(camera.jitterArcsec, 'Jitter (arcsec)', 0, 3600),
    readoutMs: number(camera.readoutMs, 'Readout (ms)', 0, 100_000),
    housingDiameterMm: number(camera.housingDiameterMm, 'Housing diameter (mm)', 0.1, 1000),
    housingLengthMm: number(camera.housingLengthMm, 'Housing length (mm)', 0.1, 1000),
  };
}

function parseCustomSensor(value: unknown): Scenario['customSensor'] {
  if (value === undefined) return undefined;
  const sensor = object(value, 'Custom sensor');
  return {
    width: integer(sensor.width, 'Custom width (px)', 1, 16_384),
    height: integer(sensor.height, 'Custom height (px)', 1, 16_384),
    pixelPitchUm: number(sensor.pixelPitchUm, 'Custom pixel pitch (µm)', 0.05, 200),
    shutter: choice(sensor.shutter, 'Custom shutter', ['rolling', 'global']),
  };
}

/** Validate a decoded version-1 scenario and return an independent copy. */
export function parseScenario(value: unknown): Scenario {
  const input = object(value, 'Scenario');
  if (input.version !== 1) throw new TypeError('This scenario version is unsupported.');
  if (typeof input.ascending !== 'boolean') throw new TypeError('Ascending must be true or false.');
  if (!Array.isArray(input.cameras) || input.cameras.length !== CAMERA_IDS.length) {
    throw new TypeError('Scenario requires exactly three cameras.');
  }
  const body = object(input.body, 'Spacecraft body');
  const target = object(input.target, 'Target');
  const customSensor = parseCustomSensor(input.customSensor);
  const cameras = input.cameras.map(camera => parseCamera(camera, customSensor));
  if (new Set<CameraId>(cameras.map(camera => camera.id)).size !== CAMERA_IDS.length) {
    throw new TypeError('Scenario must include Main, Wide A and Wide B once each.');
  }
  const scenario: Scenario = {
    version: 1,
    epochISO: date(input.epochISO),
    altitudeM: number(input.altitudeM, 'Orbit altitude (m)', 100_000, 2_000_000),
    ltanHours: number(input.ltanHours, 'LTAN (h)', 0, 24),
    ascending: input.ascending,
    passOffsetKm: number(input.passOffsetKm ?? 0, 'Pass offset (km)', -1500, 1500),
    pointing: choice(input.pointing, 'Pointing mode', ['target', 'nadir', 'sun']),
    offNadirDeg: number(input.offNadirDeg, 'Look offset (deg)', -180, 180),
    rollDeg: number(input.rollDeg, 'Spacecraft roll (deg)', -360, 360),
    target: {
      id: label(target.id, 'Target ID'),
      name: label(target.name, 'Target name'),
      latitudeDeg: number(target.latitudeDeg, 'Target latitude (deg)', -90, 90),
      longitudeDeg: number(target.longitudeDeg, 'Target longitude (deg)', -180, 180),
      heightM: number(target.heightM, 'Target height (m)', -1000, 10_000),
    },
    cameras,
    ...(customSensor ? { customSensor } : {}),
    body: {
      widthM: number(body.widthM, 'Body width (m)', 0.001, 10),
      depthM: number(body.depthM, 'Body depth (m)', 0.001, 10),
      heightM: number(body.heightM, 'Body height (m)', 0.001, 10),
      panelWidthM: number(body.panelWidthM, 'Panel width (m)', 0.001, 10),
      panelLengthM: number(body.panelLengthM, 'Panel length (m)', 0.001, 10),
      panelAngleDeg: number(body.panelAngleDeg, 'Panel angle (deg)', -180, 180),
    },
  };
  sampleState(scenario);
  return scenario;
}
