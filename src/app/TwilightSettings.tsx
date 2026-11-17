import { mainImageModel, type CameraConfig, type ExposureStudy, type MainImageModel } from '../sim';
import { DEFAULT_EXPOSURE_STUDY } from '../sim/exposure';
import { NumberField, SelectField } from './fields';

export const MAIN_IMAGE_MODEL_LABELS: Record<MainImageModel, string> = {
  pass: 'Pass lighting',
  reference: 'Daylight source reference',
  twilight: 'Twilight exposure study',
};

export function TwilightSettings({ camera, onChange }: {
  camera: CameraConfig; onChange: (change: Partial<CameraConfig>) => void;
}) {
  const study = camera.exposureStudy ?? DEFAULT_EXPOSURE_STUDY;
  const model = mainImageModel(camera);
  const update = (change: Partial<ExposureStudy>) => onChange({ exposureStudy: { ...study, ...change } });
  return <>
    <SelectField label="Main image model" value={model}
      options={Object.entries(MAIN_IMAGE_MODEL_LABELS).map(([value, label]) => ({ value, label }))}
      onChange={value => onChange({ mainImageModel: value as MainImageModel })} />
    {model === 'twilight' && <>
      <p className="note">Exposure and f-number set the light collected. Output gain amplifies both signal and noise.</p>
      <div className="field-grid">
        <NumberField label="Diffuse / overhead sunlight" value={study.diffuseFraction} min={0} max={1} step={0.0001} digits={6} onChange={diffuseFraction => update({ diffuseFraction })} />
        <NumberField label="Reference rate at f/4" unit="e⁻/ms" value={study.referenceElectronsPerMs} min={0} max={1e9} onChange={referenceElectronsPerMs => update({ referenceElectronsPerMs })} />
        <NumberField label="Read noise σ" unit="e⁻" value={study.readNoiseElectrons} min={0} max={1e5} onChange={readNoiseElectrons => update({ readNoiseElectrons })} />
        <NumberField label="Full well" unit="e⁻" value={study.fullWellElectrons} min={1} max={1e9} onChange={fullWellElectrons => update({ fullWellElectrons })} />
        <NumberField label="Output gain" unit="×" value={study.gain} min={0.01} max={1e4} step={0.5} onChange={gain => update({ gain })} />
      </div>
      <p className="note">Defaults are illustrative. The reference rate assumes a unit linear pixel in overhead sun. Set the diffuse fraction for the sky you expect. At very low signal the Gaussian noise approximation loses accuracy.</p>
    </>}
  </>;
}
