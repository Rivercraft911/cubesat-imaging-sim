/** Scientific camera frame: +X image-right, +Y image-down, +Z optical-forward.
 * Body frame: +Y panel-opening/front, +Z top. Lengths carry units in names. */
export type Vec3 = [number, number, number];
/** Active rotation, ordered [x, y, z, w]. */
export type Quat = [number, number, number, number];
export type CameraId = 'main' | 'wideA' | 'wideB';
export type Projection = 'rectilinear' | 'equidistant' | 'equisolid';
export type Pointing = 'target' | 'nadir' | 'sun';

export interface SensorProfile {
  id: string; name: string; width: number; height: number; pixelPitchUm: number;
  shutter: 'rolling' | 'global'; source: string; note?: string;
}
export interface Lens {
  focalLengthMm: number; fNumber: number; projection: Projection;
  maxFovDeg: number; imageCircleMm: number; extraBlurPx: number;
}
/** Optional illustrative sensitivity study. Inputs are assumptions unless measured by the user. */
export interface ExposureStudy {
  enabled: boolean;
  diffuseFraction: number; // diffuse irradiance / overhead direct irradiance, constant across this pass
  referenceElectronsPerMs: number; // unit linear source value, overhead Sun, f/4, current sensor
  readNoiseElectrons: number;
  fullWellElectrons: number;
  gain: number;
}
export interface CameraConfig {
  id: CameraId; name: string; sensorId: string; lens: Lens;
  positionBodyM: Vec3; yawDeg: number; pitchDeg: number; rollDeg: number;
  exposureStudy?: ExposureStudy;
  exposureMs: number; jitterArcsec: number; readoutMs: number;
  housingDiameterMm: number; housingLengthMm: number;
}
export interface Target {
  id: string; name: string; latitudeDeg: number; longitudeDeg: number; heightM: number;
}
export interface Scenario {
  version: 1; target: Target; altitudeM: number; epochISO: string; ltanHours: number;
  ascending: boolean; passOffsetKm: number; pointing: Pointing; offNadirDeg: number; rollDeg: number;
  cameras: CameraConfig[];
  customSensor?: Pick<SensorProfile, 'width' | 'height' | 'pixelPitchUm' | 'shutter'>;
  body: { widthM: number; depthM: number; heightM: number; panelWidthM: number; panelLengthM: number; panelAngleDeg: number };
}
export interface SimulationSample {
  timeS: number; positionEcefM: Vec3; velocityEcefMps: Vec3;
  qEcefFromBody: Quat; sunDirectionEcef: Vec3; targetEcefM: Vec3;
  inclinationDeg: number; sunElevationDeg: number; epochISO: string;
  targetElevationDeg: number; targetSlantRangeM: number; groundSpeedMps: number;
}
export interface CameraPose { positionEcefM: Vec3; qEcefFromCamera: Quat }
export interface CameraMetrics {
  horizontalFovDeg: number; verticalFovDeg: number; gsdM: number;
  gsdXM: number; gsdYM: number;
  footprintWidthM: number; footprintHeightM: number; apertureMm: number;
  airyDiameterPx: number; jitterSigmaPx: number; smearPx: number;
  offNadirDeg: number; slantRangeM: number; groundVisible: boolean;
  centerGroundVisible: boolean; targetPixel: [number, number] | null;
  targetVisible: boolean;
}
