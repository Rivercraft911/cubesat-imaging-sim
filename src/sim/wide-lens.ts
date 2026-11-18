import { createDefaultScenario } from './catalog';
import { applyLensProfile, getLensProfile } from './lens-profiles';
import type { CameraConfig, Lens, LensProfileId } from './types';

export type WideLensChoice = LensProfileId | 'study';
const studyCamera = createDefaultScenario().cameras.find(camera => camera.id === 'wideA')!;

// Dimensions are exterior diameter and pupil-to-rear setback in millimeters.
const housing: Record<WideLensChoice, Pick<CameraConfig, 'housingDiameterMm' | 'housingLengthMm'>> = {
  study: { housingDiameterMm: studyCamera.housingDiameterMm, housingLengthMm: studyCamera.housingLengthMm },
  'commonlands-cil220': { housingDiameterMm: 14, housingLengthMm: 13.1 },
  // FRAMOS module drawing: retaining-ring plane to holder joint, 26.76 − 14.10 mm.
  'framos-l185a': { housingDiameterMm: 25.8, housingLengthMm: 12.66 },
};

export function fitWideLens(camera: CameraConfig, choice: WideLensChoice): Pick<CameraConfig, 'lens' | 'housingDiameterMm' | 'housingLengthMm'> {
  const lens = choice === 'study'
    ? { ...studyCamera.lens, extraBlurPx: camera.lens.extraBlurPx }
    : applyLensProfile(camera.lens, choice);
  return { lens, ...housing[choice] };
}

/** Manual edits keep the physical barrel but release the catalog settings. */
export function wideLensChoice(lens: Lens): WideLensChoice | 'custom' {
  const nominal = lens.profileId ? getLensProfile(lens.profileId).optics : studyCamera.lens;
  const fields = ['focalLengthMm', 'projection', 'fNumber', 'imageCircleMm', 'maxFovDeg'] as const;
  return fields.every(key => nominal[key] === lens[key]) && (nominal.fThetaEdgeFactor ?? 0) === (lens.fThetaEdgeFactor ?? 0)
    ? lens.profileId ?? 'study' : 'custom';
}
