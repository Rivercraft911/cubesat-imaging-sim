import type { CameraConfig, ExposureStudy } from '../sim';
import { DEFAULT_EXPOSURE_STUDY } from '../sim/exposure';
import { NumberField, SelectField } from './fields';

export function TwilightSettings({ camera, onChange }: {
  camera: CameraConfig; onChange: (change: Partial<CameraConfig>) => void;
}) {
  const study = camera.exposureStudy ?? DEFAULT_EXPOSURE_STUDY;
  const enabled = camera.exposureStudy?.enabled ?? false;
  const update = (change: Partial<ExposureStudy>) => onChange({ exposureStudy: { ...study, ...change } });
  return <>
    <SelectField label="Main image model" value={enabled ? 'twilight' : 'reference'}
      options={[{ value: 'reference', label: 'Daylight source reference' }, { value: 'twilight', label: 'Twilight exposure study' }]}
      onChange={value => update({ enabled: value === 'twilight' })} />
    {enabled && <>
      <p className="note">Actual Sun geometry; assumed sensitivity. Exposure and f-number above change signal and blur. Gain brightens signal and noise together. Switch back to the daylight reference to compare.</p>
      <div className="field-grid">
        <NumberField label="Diffuse / overhead sunlight" value={study.diffuseFraction} min={0} max={1} step={0.0001} digits={6} onChange={diffuseFraction => update({ diffuseFraction })} />
        <NumberField label="Reference rate at f/4" unit="e⁻/ms" value={study.referenceElectronsPerMs} min={0} max={1e9} onChange={referenceElectronsPerMs => update({ referenceElectronsPerMs })} />
        <NumberField label="Read noise σ" unit="e⁻" value={study.readNoiseElectrons} min={0} max={1e5} onChange={readNoiseElectrons => update({ readNoiseElectrons })} />
        <NumberField label="Full well" unit="e⁻" value={study.fullWellElectrons} min={1} max={1e9} onChange={fullWellElectrons => update({ fullWellElectrons })} />
        <NumberField label="Output gain" unit="×" value={study.gain} min={0.01} max={1e4} step={0.5} onChange={gain => update({ gain })} />
      </div>
      <p className="note">All defaults are illustrative, not sensor specifications. Reference rate means a unit linear source pixel at overhead Sun, f/4, for the current sensor. Replace with measured inputs when available. Diffuse light is a constant user assumption for this pass; it is not a predicted twilight sky. Source photos are reflectance proxies. Noise uses a Gaussian shot approximation (inaccurate at very low electron counts) plus read noise after optical blur. No atmosphere, spectral response, dark current, fixed-pattern noise or calibrated SNR prediction.</p>
    </>}
  </>;
}
