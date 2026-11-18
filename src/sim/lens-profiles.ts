import type { Lens, LensProfileId } from './types';

export type { LensProfileId } from './types';

interface LensProfile {
  id: LensProfileId;
  name: string;
  partNumber: string;
  source: string;
  note: string;
  optics: Readonly<Omit<Lens, 'profileId' | 'extraBlurPx'>>;
}

function fisheye(focalLengthMm: number, fNumber: number, maxFovDeg: number, imageCircleMm: number): LensProfile['optics'] {
  const edgeAngleRad = maxFovDeg * Math.PI / 360;
  return {
    focalLengthMm, fNumber, maxFovDeg, imageCircleMm, projection: 'equidistant',
    fThetaEdgeFactor: (imageCircleMm / 2) / (focalLengthMm * edgeAngleRad) - 1,
  };
}

export const LENS_PROFILES: readonly LensProfile[] = [
  {
    id: 'commonlands-cil220',
    name: 'Commonlands CIL220',
    partNumber: 'CIL220-F2.3-M12C650',
    // Commonlands drawing rev. 1, sheet 1, dated 2024-12-15.
    source: 'https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/6504/CIL220-F2.3-M12C650.pdf',
    note: '215° at the 6.8 mm maximum circle (6.2 mm design circle). Near-equidistant model fitted to the nominal edge. The outer image quality is unspecified in the sim.',
    optics: fisheye(1.83, 2.3, 215, 6.8),
  },
  {
    id: 'framos-l185a',
    name: 'FRAMOS L185A',
    partNumber: 'FLP-AM-017-00-V-00',
    // FSM:GO IMX676C, Lens Options, Module Specifications and Lens Specifications.
    source: 'https://docs.framos.com/en/latest/FSMEcosystem/ProductDocumentation/FSMGO/IMX676.html#lens-options',
    note: '185° horizontal, vertical and diagonal on the FRAMOS IMX676C module, with a 7.07 mm maximum circle. The radial model interpolates to the nominal edge. FRAMOS reports +27.4% F-theta distortion but supplies no radial calibration curve here.',
    optics: fisheye(1.7, 2, 185, 7.07),
  },
];

export function getLensProfile(id: LensProfileId): LensProfile {
  const profile = LENS_PROFILES.find(candidate => candidate.id === id);
  if (!profile) throw new RangeError(`Unknown lens profile: ${id}`);
  return profile;
}

export function applyLensProfile(lens: Lens, id: LensProfileId): Lens {
  return { ...getLensProfile(id).optics, profileId: id, extraBlurPx: lens.extraBlurPx };
}
