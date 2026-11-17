import { getSensor, SENSOR_PROFILES } from '../sim';
import type { CameraConfig, CameraId, Lens, Pointing, Projection, Scenario, Vec3 } from '../sim';
import { fmt, NumberField, SelectField } from './fields';
import { editCamera, wideMountBodyYM } from '../sim/camera-edit';

type InspectorProps = {
  section: 'optics' | 'orbit' | 'geometry';
  scenario: Scenario;
  onChange: (scenario: Scenario) => void;
  cameraId: CameraId;
};

type ScenarioSettings = Pick<InspectorProps, 'scenario' | 'onChange'>;
type CameraSettings = ScenarioSettings & { camera: CameraConfig; onCameraChange: (change: Partial<CameraConfig>) => void };

const PROJECTIONS: { value: Projection; label: string }[] = [
  { value: 'rectilinear', label: 'Rectilinear' },
  { value: 'equidistant', label: 'Equidistant fisheye' },
  { value: 'equisolid', label: 'Equisolid fisheye' },
];
const POINTING: { value: Pointing; label: string }[] = [
  { value: 'target', label: 'Track target' },
  { value: 'nadir', label: 'Nadir' },
  { value: 'sun', label: 'Track Sun' },
];

function Optics({ camera, scenario, onChange, onCameraChange }: CameraSettings) {
  const { lens } = camera;
  const sensor = getSensor(camera.sensorId, scenario.customSensor);
  const changeLens = (change: Partial<Lens>) => onCameraChange({ lens: { ...lens, ...change } });
  const changeCustom = (change: Partial<NonNullable<Scenario['customSensor']>>) => {
    const { width, height, pixelPitchUm, shutter } = sensor;
    onChange({ ...scenario, customSensor: { width, height, pixelPitchUm, shutter, ...change } });
  };

  return <>
    <h2 className="section-heading">{camera.id === 'main' ? camera.name : 'Wide pair'} optics</h2>
    {camera.id !== 'main' && <p className="note">Edits apply to both wide cameras.</p>}
    <SelectField label="Sensor" value={camera.sensorId} onChange={sensorId => onCameraChange({ sensorId })}
      options={SENSOR_PROFILES.map(profile => ({ value: profile.id, label: profile.name }))} />
    {sensor.id === 'custom' ? <div className="field-grid">
      <NumberField label="Recording width" unit="px" value={sensor.width} min={1} max={16384} digits={0} onChange={value => changeCustom({ width: Math.round(value) })} />
      <NumberField label="Recording height" unit="px" value={sensor.height} min={1} max={16384} digits={0} onChange={value => changeCustom({ height: Math.round(value) })} />
      <NumberField label="Pixel pitch" unit="µm" value={sensor.pixelPitchUm} min={0.05} max={200} step={0.05} digits={3} onChange={pixelPitchUm => changeCustom({ pixelPitchUm })} />
      <SelectField label="Shutter" value={sensor.shutter} onChange={value => changeCustom({ shutter: value === 'global' ? 'global' : 'rolling' })}
        options={[{ value: 'rolling', label: 'Rolling' }, { value: 'global', label: 'Global' }]} />
    </div> : <p className="note">
      {sensor.width} × {sensor.height} px · {sensor.pixelPitchUm} µm · {sensor.shutter} shutter.{' '}
      <a href={sensor.source} target="_blank" rel="noreferrer">Sensor specifications</a>
    </p>}
    <SelectField label="Lens projection" value={lens.projection} options={PROJECTIONS} onChange={value => {
      const projection = value as Projection;
      changeLens({ projection, maxFovDeg: Math.min(lens.maxFovDeg, projection === 'rectilinear' ? 180 : 360) });
    }} />
    <div className="field-grid">
      <NumberField label="Focal length" unit="mm" value={lens.focalLengthMm} min={0.01} max={10000} step={0.1} digits={4} onChange={focalLengthMm => changeLens({ focalLengthMm })} />
      <NumberField label="F-number" unit="f/" value={lens.fNumber} min={0.1} max={128} step={0.1} onChange={fNumber => changeLens({ fNumber })} />
      <NumberField label="Image circle" unit="mm" value={lens.imageCircleMm} min={0.001} max={1000} step={0.1} digits={3} onChange={imageCircleMm => changeLens({ imageCircleMm })} />
      <NumberField label="Lens angle limit" unit="°" value={lens.maxFovDeg} min={0.1} max={lens.projection === 'rectilinear' ? 180 : 360} onChange={maxFovDeg => changeLens({ maxFovDeg })} />
      <NumberField label="Exposure" unit="ms" value={camera.exposureMs} min={0} max={100000} step={0.1} digits={3} onChange={exposureMs => onCameraChange({ exposureMs })} />
      <NumberField label="Pointing jitter σ" unit="arcsec" value={camera.jitterArcsec} min={0} max={3600} step={0.1} onChange={jitterArcsec => onCameraChange({ jitterArcsec })} />
      <NumberField label="Frame readout" unit="ms" value={camera.readoutMs} min={0} max={100000} step={0.1} digits={3} onChange={readoutMs => onCameraChange({ readoutMs })} />
      <NumberField label="Extra blur σ" unit="px" value={lens.extraBlurPx} min={0} max={1000} step={0.1} onChange={extraBlurPx => changeLens({ extraBlurPx })} />
    </div>
    <p className="note">Diffraction uses 550 nm light. Smear describes motion at the image center. Frame readout is saved as metadata.</p>
  </>;
}

function Orbit({ scenario, onChange }: ScenarioSettings) {
  const update = (change: Partial<Scenario>) => onChange({ ...scenario, ...change });

  return <>
    <h2 className="section-heading">Orbit and attitude</h2>
    <div className="field-grid">
      <NumberField label="Orbit altitude" unit="km" value={scenario.altitudeM / 1000} min={100} max={2000} onChange={km => update({ altitudeM: km * 1000 })} />
      <NumberField label="Lateral pass offset" unit="km" value={scenario.passOffsetKm} min={-1500} max={1500} onChange={passOffsetKm => update({ passOffsetKm })} />
      <label className="select-field"><span>Pass date (UTC)</span>
        <input type="date" value={scenario.epochISO.slice(0, 10)} min="1800-01-01" max="2199-12-31" onChange={event => {
          const day = event.currentTarget.value;
          if (day && event.currentTarget.validity.valid) update({ epochISO: `${day}T00:00:00.000Z` });
        }} />
      </label>
      <NumberField label="Ascending node LTAN" unit="h" value={scenario.ltanHours} min={0} max={24} step={0.25} onChange={ltanHours => update({ ltanHours })} />
    </div>
    <p className="note">At time zero the spacecraft is closest to the target. Positive offset moves the pass to the right of its ground track.</p>
    <SelectField label="Pass heading" value={scenario.ascending ? 'ascending' : 'descending'}
      options={[{ value: 'ascending', label: 'Ascending · northbound' }, { value: 'descending', label: 'Descending · southbound' }]}
      onChange={value => update({ ascending: value === 'ascending' })} />
    <SelectField label="Pointing" value={scenario.pointing} options={POINTING} onChange={value => update({ pointing: value as Pointing })} />
    <div className="field-grid">
      {scenario.pointing !== 'sun' && <NumberField label="Look offset" unit="°" value={scenario.offNadirDeg} min={-180} max={180} onChange={offNadirDeg => update({ offNadirDeg })} />}
      <NumberField label="Spacecraft roll" unit="°" value={scenario.rollDeg} min={-360} max={360} onChange={rollDeg => update({ rollDeg })} />
    </div>
    <p className="note">The simulation constructs a circular Sun-synchronous pass on the selected UTC date.</p>
  </>;
}

const BODY_DIMENSIONS = [
  ['widthM', 'Body width X'], ['depthM', 'Body depth Y'], ['heightM', 'Body height Z'],
  ['panelWidthM', 'Panel width'], ['panelLengthM', 'Panel length'],
] as const;
const MOUNT_ANGLES = [['yawDeg', 'Yaw'], ['pitchDeg', 'Pitch'], ['rollDeg', 'Roll']] as const;
const MOUNT_AXES = ['X', 'Y', 'Z'] as const;

function Geometry({ camera, scenario, onChange, onCameraChange }: CameraSettings) {
  const body = scenario.body;
  const wideId = camera.id === 'main' ? null : camera.id;
  const nominalY = wideId ? wideMountBodyYM(wideId, body.depthM) : 0;
  const offsetMm = (camera.positionBodyM[1] - nominalY) * Math.sign(nominalY) * 1_000;
  const standOffMm = Number(offsetMm.toFixed(1)) || 0;
  const standOffSliderMm = Math.max(0, Math.min(10, standOffMm));
  const changeBody = (change: Partial<Scenario['body']>) => onChange({ ...scenario, body: { ...body, ...change } });
  const changePosition = (axis: number, positionM: number) => {
    const positionBodyM: Vec3 = [...camera.positionBodyM];
    positionBodyM[axis] = positionM;
    onCameraChange({ positionBodyM });
  };

  return <>
    <h2 className="section-heading">{camera.id === 'main' ? 'Main camera' : '360° pair'} mount</h2>
    {camera.id !== 'main' && <p className="note">The opposite mount follows these edits, rotated 180° around body Z.</p>}
    {wideId && <>
      <label className="select-field">
        <span>Extra stand-off · {fmt(standOffMm, 1)} mm</span>
        <input type="range" min={0} max={10} step={0.1} value={standOffSliderMm}
          aria-label="Extra stand-off" aria-valuetext={`${fmt(standOffSliderMm, 1)} mm`}
          aria-describedby="wide-stand-off-help"
          onChange={event => changePosition(1, wideMountBodyYM(wideId, body.depthM, event.currentTarget.valueAsNumber))} />
      </label>
      <p className="note" id="wide-stand-off-help">Increasing stand-off moves both cameras outward from their nominal mounts.</p>
    </>}
    <div className="field-grid">
      {MOUNT_AXES.map((axis, i) => <NumberField key={axis} label={`Body ${axis}`} unit="mm" value={camera.positionBodyM[i] * 1000}
        min={-10000} max={10000} digits={2} onChange={mm => changePosition(i, mm / 1000)} />)}
      {camera.id !== 'main' && MOUNT_ANGLES.map(([key, label]) => <NumberField key={key} label={label} unit="°" value={camera[key]}
        min={-360} max={360} onChange={value => onCameraChange({ [key]: value })} />)}
      <NumberField label="Housing diameter" unit="mm" value={camera.housingDiameterMm} min={0.1} max={1000} onChange={housingDiameterMm => onCameraChange({ housingDiameterMm })} />
      <NumberField label="Housing length" unit="mm" value={camera.housingLengthMm} min={0.1} max={1000} onChange={housingLengthMm => onCameraChange({ housingLengthMm })} />
    </div>
    <p className="note">{camera.id === 'main' ? 'Main points along body +Y. Image right is +X and image up is +Z.' : `Zero mount angles point along body ${camera.id === 'wideA' ? '+Y' : '−Y'}. Positive yaw turns right and positive pitch tilts up.`}</p>
    <h2 className="section-heading">Spacecraft and panels</h2>
    <div className="field-grid">
      {BODY_DIMENSIONS.map(([key, label]) => <NumberField key={key} label={label} unit="mm" value={body[key] * 1000}
        min={1} max={10000} digits={2} onChange={mm => changeBody({ [key]: mm / 1000 })} />)}
      <NumberField label="Panel angle" unit="°" value={body.panelAngleDeg} min={-180} max={180} onChange={panelAngleDeg => changeBody({ panelAngleDeg })} />
    </div>
    <p className="note">These spacecraft dimensions are provisional.</p>
  </>;
}

export function Inspector({ section, scenario, onChange, cameraId }: InspectorProps) {
  const camera = scenario.cameras.find(config => config.id === cameraId);
  const onCameraChange = (change: Partial<CameraConfig>) => onChange(editCamera(scenario, cameraId, change));

  return <div className="inspector-content" key={section === 'orbit' ? section : `${section}-${cameraId}`}>
    {section === 'orbit' && <Orbit scenario={scenario} onChange={onChange} />}
    {section === 'optics' && camera && <Optics camera={camera} scenario={scenario} onChange={onChange} onCameraChange={onCameraChange} />}
    {section === 'geometry' && camera && <Geometry camera={camera} scenario={scenario} onChange={onChange} onCameraChange={onCameraChange} />}
  </div>;
}
