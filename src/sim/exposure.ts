import type { CameraConfig, ExposureStudy, MainImageModel } from './types';

/** Illustrative inputs, deliberately independent of sensor catalog specifications. */
export const DEFAULT_EXPOSURE_STUDY: ExposureStudy = {
  diffuseFraction: 0.001, referenceElectronsPerMs: 10_000,
  readNoiseElectrons: 3, fullWellElectrons: 10_000, gain: 1,
};

export function mainImageModel(camera: CameraConfig): MainImageModel {
  return camera.mainImageModel ?? 'pass';
}

/** Extended Lambertian scene: image irradiance scales as t / N².
 * Reference rate is for THIS sensor at f/4, unit linear source value, overhead Sun.
 * The source photograph is only a reflectance proxy, not measured radiance.
 * Shot variance equals mean electrons; independent read variance adds.
 * EMVA 1288 Release 4.0 Linear (16 June 2021), §2.4, Eqs. 13–14, printed p.9.
 * https://www.emva.org/wp-content/uploads/EMVA1288Linear_4.0Release.pdf
 */
export function exposureScale(camera: CameraConfig): number {
  const study = camera.exposureStudy ?? DEFAULT_EXPOSURE_STUDY;
  return study.referenceElectronsPerMs * camera.exposureMs * (4 / camera.lens.fNumber) ** 2;
}
export function exposurePrediction(camera: CameraConfig, sourceValue: number, sunElevationDeg: number) {
  const study = camera.exposureStudy ?? DEFAULT_EXPOSURE_STUDY;
  const illumination = Math.max(0, Math.sin(sunElevationDeg * Math.PI / 180)) + study.diffuseFraction;
  const electrons = Math.max(0, sourceValue) * illumination * exposureScale(camera);
  const noise = Math.sqrt(electrons + study.readNoiseElectrons ** 2);
  return { electrons, snr: noise > 0 ? electrons / noise : 0,
    output: Math.min(1, Math.min(electrons, study.fullWellElectrons) * study.gain / study.fullWellElectrons) };
}
