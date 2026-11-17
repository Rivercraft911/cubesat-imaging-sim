import { useEffect, useRef } from 'react';
import type { CameraConfig, CameraId, Scenario } from '../sim';
import { DownlinkControls } from './DownlinkControls';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import type { MountTool } from './WideMountEditor';
import { fmt } from './fields';
import type { useDownlink } from './useDownlink';
import type { LiveLinkControls } from './LinkStrip';

export type Panel = 'optics' | 'orbit' | 'geometry' | 'downlink';
const panels: Record<Panel, string> = { optics: 'Camera', orbit: 'Orbit', geometry: 'Spacecraft', downlink: 'Live link' };

export function OpticalControls({ camera, cameras, panel, pairedView, onCamera, onFocalLength, onPanel }: {
  camera: CameraConfig;
  cameras: readonly CameraConfig[];
  panel: Panel | null;
  pairedView: boolean;
  onCamera: (id: CameraId) => void;
  onFocalLength: (focalLengthMm: number) => void;
  onPanel: (panel: Panel) => void;
}) {
  const isMain = camera.id === 'main';
  const focalLength = camera.lens.focalLengthMm;
  return (
    <div className="optical-strip">
      <label className="camera-control">
        <select aria-label="Camera" value={pairedView && camera.id !== 'main' ? 'wideA' : camera.id} onChange={event => onCamera(event.target.value as CameraId)}>
          {cameras.filter(item => !pairedView || item.id !== 'wideB').map(item => <option value={item.id} key={item.id}>
            {item.id === 'main' ? 'Main camera' : pairedView ? '360° pair' : item.name}
          </option>)}
        </select>
      </label>
      <label className="focal-control">
        <span>{fmt(focalLength, focalLength < 10 ? 1 : 0)} <small>mm</small></span>
        <input aria-label="Focal length" aria-valuetext={`${fmt(focalLength, 4)} mm`} type="range"
          min={Math.log(isMain ? 4 : 0.5)} max={Math.log(isMain ? 2_000 : 20)} step="0.005"
          value={Math.log(focalLength)} onChange={event => onFocalLength(Math.exp(Number(event.target.value)))} />
      </label>
      <div className="optical-readout" aria-label="Exposure settings">
        <span>f/{fmt(camera.lens.fNumber, 1)}</span><small>{fmt(camera.exposureMs, 2)} ms</small>
      </div>
      <button className={`settings-button ${panel ? 'active' : ''}`} aria-expanded={panel !== null}
        onClick={() => onPanel(panel ?? (isMain ? 'optics' : 'geometry'))}><Icon name="settings" />Settings</button>
    </div>
  );
}

export function InspectorDrawer({ panel, scenario, cameraId, mountTool, onChange, onSelectPass, onClose, onPanel, downlink, linkControls, ready }: {
  panel: Panel;
  scenario: Scenario;
  cameraId: CameraId;
  mountTool: MountTool;
  onChange: (scenario: Scenario) => void;
  onSelectPass: (scenario: Scenario) => void;
  onClose: () => void;
  onPanel: (panel: Panel) => void;
  downlink: ReturnType<typeof useDownlink>;
  linkControls: LiveLinkControls;
  ready: boolean;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  return (
    <aside id="settings-drawer" className="inspector" aria-label="Settings" onKeyDown={event => {
      if (event.key === 'Escape') onClose();
    }}>
      <div className="inspector-title"><span>Settings</span>
        <button ref={closeButton} aria-label="Close settings" onClick={onClose}>×</button>
      </div>
      <nav className="inspector-tabs" aria-label="Settings sections">
        {(Object.keys(panels) as Panel[]).map(id => <button key={id}
          className={panel === id ? 'active' : ''} aria-pressed={panel === id}
          onClick={() => onPanel(id)}>{panels[id]}</button>)}
      </nav>
      {panel === 'downlink' ? (
        <div className="inspector-content">
          <DownlinkControls downlink={downlink} controls={linkControls} disabled={!ready} />
          <p className="note">
            Live capture advances the pass at 1×. The main feed preserves its sensor aspect ratio.
            Ground stitching uses square crops from the wide cameras. Codec support is measured in this browser.
            Rate assumes successful demodulation, 20% roll-off and 10% application reserve; RF lock is not simulated.
          </p>
        </div>
      ) : <Inspector section={panel} scenario={scenario} onChange={onChange} onSelectPass={onSelectPass} cameraId={cameraId} mountTool={mountTool} />}
    </aside>
  );
}
