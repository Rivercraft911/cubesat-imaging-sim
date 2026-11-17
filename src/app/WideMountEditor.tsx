import { useId, type PointerEvent } from 'react';
import type { WideMountDragMode } from '../render/types';
import type { CameraConfig, Scenario } from '../sim';
import { wideMountBodyYM } from '../sim/camera-edit';
import { fmt } from './fields';
import { advanceMountCoordinate, MAX_MOUNT_PITCH_DEG, MAX_MOUNT_YAW_DEG, mountRightSign, mountTravelMm } from '../sim/wide-mount';
import { padCoordinate, padValue } from './WideMountEditorModel';
import './WideMountEditor.css';

export type MountTool = { mode: WideMountDragMode; onMode: (mode: WideMountDragMode) => void };

type WideMountEditorProps = {
  tool: MountTool;
  camera: CameraConfig;
  face: 'wideA' | 'wideB';
  body: Scenario['body'];
  onChange: (change: Partial<CameraConfig>) => void;
};

export function WideMountEditor({ camera, face, body, onChange, tool }: WideMountEditorProps) {
  const { mode, onMode } = tool;
  const helpId = useId();
  const isMove = mode === 'move';
  const rightSign = mountRightSign(face);
  const halfWidthMm = body.widthM * 500;
  const halfHeightMm = body.heightM * 500;
  const displayX = isMove ? halfWidthMm : MAX_MOUNT_YAW_DEG;
  const displayY = isMove ? halfHeightMm : MAX_MOUNT_PITCH_DEG;
  const travelX = isMove ? mountTravelMm(body.widthM, camera.housingDiameterMm) : displayX;
  const travelY = isMove ? mountTravelMm(body.heightM, camera.housingDiameterMm) : displayY;
  const [bodyX, bodyY, bodyZ] = camera.positionBodyM;
  const x = isMove ? bodyX * 1000 * rightSign : camera.yawDeg;
  const y = isMove ? bodyZ * 1000 : camera.pitchDeg;
  const offPad = Math.abs(x) > travelX + 1e-9 || Math.abs(y) > travelY + 1e-9;
  const standOffMm = Number(((bodyY - wideMountBodyYM(face, body.depthM)) * rightSign * 1000).toFixed(1)) || 0;
  const sliderMm = Math.max(0, Math.min(10, standOffMm));

  const setPad = (nextX: number, nextY: number) => {
    if (Math.abs(nextX - x) < 1e-9 && Math.abs(nextY - y) < 1e-9) return;
    if (isMove) onChange({ positionBodyM: [nextX === x ? bodyX : rightSign * nextX / 1000, bodyY, nextY === y ? bodyZ : nextY / 1000] });
    else onChange({ yawDeg: nextX, pitchDeg: nextY });
  };

  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const pad = event.currentTarget;
    const { left, top } = pad.getBoundingClientRect();
    setPad(
      padValue((event.clientX - left - pad.clientLeft) / pad.clientWidth, displayX, travelX),
      padValue(1 - (event.clientY - top - pad.clientTop) / pad.clientHeight, displayY, travelY),
    );
  };

  const location = isMove
    ? `Body X ${fmt(bodyX * 1000, 2)} mm · Z ${fmt(y, 2)} mm`
    : `Yaw ${fmt(x, 2)}° · Pitch ${fmt(y, 2)}°`;

  return <div className="wide-mount-editor">
    <div className="wide-mount-toolbar">
      <div className="wide-mount-modes" role="group" aria-label="Mount editing mode">
        <button type="button" aria-pressed={isMove} onClick={() => onMode('move')}>Move</button>
        <button type="button" aria-pressed={!isMove} onClick={() => onMode('aim')}>Aim</button>
      </div>
      {!isMove && <button type="button" className="wide-mount-reset" disabled={x === 0 && y === 0}
        onClick={() => setPad(0, 0)}>Zero yaw and pitch</button>}
    </div>
    <div className="wide-mount-map" style={{ maxWidth: Math.max(110, 180 * displayX / displayY) }}>
      <div className="wide-mount-plot" aria-hidden="true">
        <span>{isMove ? '↑ Body +Z' : '↑ Pitch +'}</span>
        <span>{isMove ? `Body ${rightSign > 0 ? '+' : '−'}X →` : 'Yaw + →'}</span>
      </div>
      <div className="wide-mount-pad" style={{ aspectRatio: displayX / displayY }} role="group" tabIndex={0} aria-label={isMove ? 'Move camera on its mount face' : 'Adjust mount yaw and pitch'}
        aria-describedby={helpId}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) followPointer(event);
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) followPointer(event);
        }}
        onKeyDown={event => {
          const step = event.shiftKey ? 5 : 1;
          switch (event.key) {
            case 'ArrowLeft': setPad(advanceMountCoordinate(x, -step, travelX), y); break;
            case 'ArrowRight': setPad(advanceMountCoordinate(x, step, travelX), y); break;
            case 'ArrowDown': setPad(x, advanceMountCoordinate(y, -step, travelY)); break;
            case 'ArrowUp': setPad(x, advanceMountCoordinate(y, step, travelY)); break;
            default: return;
          }
          event.preventDefault();
        }}>
        {isMove && <div className="wide-mount-travel" aria-hidden="true" style={{
          inset: `${50 * (1 - travelY / displayY)}% ${50 * (1 - travelX / displayX)}%`,
        }} />}
        <div className={`wide-mount-marker${offPad ? ' outside' : ''}`} aria-hidden="true" style={{
          left: `${100 * padCoordinate(x, displayX, travelX)}%`,
          bottom: `${100 * padCoordinate(y, displayY, travelY)}%`,
        }} />
      </div>
    </div>
    <p className="wide-mount-readout" role="status">{location}{offPad && ' · Outside pad'}</p>
    <p className="note wide-mount-help" id={helpId}>
      {isMove ? 'The dashed line shows how far the lens center can move.' : 'Yaw ±180° · Pitch ±90°.'}
      {' '}Arrow keys step {isMove ? '1 mm' : '1°'}. Hold Shift for 5.
    </p>
    <label className="select-field wide-mount-stand-off">
      <span>Extra stand-off · {fmt(standOffMm, 1)} mm</span>
      <input type="range" min={0} max={10} step={0.1} value={sliderMm} aria-label="Extra stand-off"
        aria-valuetext={`${fmt(sliderMm, 1)} mm`} aria-describedby={`${helpId}-stand-off`}
        onChange={event => onChange({ positionBodyM: [bodyX, wideMountBodyYM(face, body.depthM, event.currentTarget.valueAsNumber), bodyZ] })} />
    </label>
    <p className="note wide-mount-help" id={`${helpId}-stand-off`}>0 mm puts the optical centers 5 mm beyond their body faces.</p>
  </div>;
}
