import { BANDWIDTH_MAX_HZ, BANDWIDTH_MIN_HZ } from '../downlink/radio';
import { DOWNLINK_RESOLUTIONS, type DownlinkResolution } from '../downlink/types';
import { fmt } from './fields';
import { Icon } from './Icon';
import type { useDownlink } from './useDownlink';
import './link-strip.css';

export interface LiveLinkControls {
  bandwidthHz: number;
  throughputBps: number;
  minThroughputBps: number;
  maxThroughputBps: number;
  modcod: string;
  modcods: readonly { id: string; label: string }[];
  adaptive: boolean;
  quality: DownlinkResolution;
  onBandwidthChange: (bandwidthHz: number) => void;
  onThroughputChange: (throughputBps: number) => void;
  onModcodChange: (id: string) => void;
  onAdaptiveChange: (adaptive: boolean) => void;
  onQualityChange: (quality: DownlinkResolution) => void;
}

export function formatRate(bps: number): string {
  if (bps >= 1_000_000) return fmt(bps / 1_000_000, 2) + ' Mbps';
  if (bps >= 1_000) return fmt(bps / 1_000, 1) + ' kbps';
  return fmt(bps, 0) + ' bps';
}

function formatBandwidth(hz: number): string {
  return hz >= 1_000_000 ? fmt(hz / 1_000_000, 2) + ' MHz' : fmt(hz / 1_000, 1) + ' kHz';
}

const sliderSteps = 200;

function LogSlider({ label, value, min, max, format, onChange, title }: {
  label: string;
  value: number;
  min: number;
  max: number;
  title?: string;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const text = format(value);
  const span = Math.log(max / min);
  const position = Math.min(sliderSteps, Math.max(0, Math.round(sliderSteps * Math.log(value / min) / span)));
  return <label className="link-slider" title={title}>
    <span>{label}<span>{text}</span></span>
    <input type="range" aria-label={label} aria-valuetext={text} min={0} max={sliderSteps} value={position}
      onChange={event => {
        const fraction = Number(event.currentTarget.value) / sliderSteps;
        onChange(fraction === 1 ? max : min * Math.exp(fraction * span));
      }} />
  </label>;
}

export function LinkTuning({ controls }: { controls: LiveLinkControls }) {
  const { adaptive, quality } = controls;
  const qualityLabel = adaptive ? 'Quality limit' : 'Encoded height';
  const qualityText = quality + 'p';
  return <div className="link-tuning">
    <LogSlider label="Data throughput" value={controls.throughputBps}
      min={controls.minThroughputBps} max={controls.maxThroughputBps}
      title="Net capacity assuming successful demodulation"
      format={formatRate} onChange={controls.onThroughputChange} />
    <LogSlider label="Bandwidth" value={controls.bandwidthHz} min={BANDWIDTH_MIN_HZ} max={BANDWIDTH_MAX_HZ}
      title="Occupied RF bandwidth" format={formatBandwidth} onChange={controls.onBandwidthChange} />
    <label className="link-modcod">
      <span>ModCod</span>
      <select aria-label="ModCod (modulation and coding)" value={controls.modcod}
        onChange={event => controls.onModcodChange(event.currentTarget.value)}>
        {controls.modcods.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    <label className="link-slider">
      <span>{qualityLabel}<span>{qualityText}</span></span>
      <input type="range" aria-label={qualityLabel} aria-valuetext={qualityText}
        min={0} max={DOWNLINK_RESOLUTIONS.length - 1} value={DOWNLINK_RESOLUTIONS.indexOf(quality)}
        onChange={event => controls.onQualityChange(DOWNLINK_RESOLUTIONS[Number(event.currentTarget.value)])} />
    </label>
    <label className="link-adaptive">
      <input type="checkbox" checked={adaptive} onChange={event => controls.onAdaptiveChange(event.currentTarget.checked)} />
      Adapt quality to link
    </label>
  </div>;
}

export function LinkStrip({ downlink, controls, onOpenSettings }: {
  downlink: ReturnType<typeof useDownlink>;
  controls: LiveLinkControls;
  onOpenSettings: () => void;
}) {
  const { state, stats, outage, error, receiverHeight, receiverWidth, reconfiguring } = downlink;
  if (state === 'off') return null;
  if (state === 'error') return <p className="link-strip link-strip-message" role="alert">{error}</p>;
  if (state === 'starting') {
    return <p className="link-strip link-strip-message" role="status">Checking browser codecs…</p>;
  }
  const status = outage || stats?.inOutage ? 'Link interrupted'
    : reconfiguring ? 'Adjusting video…'
      : receiverHeight === null ? 'Waiting for decoded video…' : null;

  return <details className="link-strip" onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.stopPropagation();
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }}>
    <summary title="Adjust live link">
      <span className="link-strip-sr-only">Live link controls. </span>
      <span className="link-strip-copy">
        <span className="link-strip-measurement">
          <span title="Downlink payload received over the past second">
            <span className="link-strip-muted">Received </span>{stats ? formatRate(stats.deliveredBitrateBps) : '—'}
          </span>
          {receiverHeight !== null && <span className="link-strip-height"
            title={receiverWidth + ' × ' + receiverHeight + ' px decoded'}>{receiverHeight}p</span>}
        </span>
        {error ? <span className="link-strip-status link-strip-error" role="alert">{error}</span>
          : status && <span className="link-strip-status" role="status">{status}</span>}
      </span>
      <span className="link-strip-icon"><Icon name="settings" size={15} /></span>
    </summary>
    <div className="link-strip-body">
      <LinkTuning controls={controls} />
      <button className="link-strip-settings" type="button" onClick={onOpenSettings}>Link settings</button>
    </div>
  </details>;
}
