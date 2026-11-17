import { buildStreams, type DownlinkConfig, type DownlinkResolution, type StreamId } from '../downlink';
import { DOWNLINK_RESOLUTIONS } from '../downlink/types';
import { fmt, NumberField, SelectField } from './fields';
import { formatRate, LinkTuning, type LiveLinkControls } from './LinkStrip';
import type { useDownlink } from './useDownlink';

const labels: Record<StreamId, string> = {
  main: 'Main camera',
  panorama: '360° panorama',
  wideA: 'Wide A',
  wideB: 'Wide B',
};

const programs = [
  { value: 'main', label: 'Main camera' },
  { value: '360', label: '360° panorama' },
  { value: 'both', label: 'Main + 360°' },
];

const resolutions = DOWNLINK_RESOLUTIONS.map(height => ({ value: String(height), label: height + 'p' }));

export function DownlinkControls({ downlink, disabled = false, controls }: {
  downlink: ReturnType<typeof useDownlink>;
  disabled?: boolean;
  controls?: LiveLinkControls;
}) {
  const { config, state, stats, outage, receiver, receiverHeight, error, activeConfig, reconfiguring } = downlink;
  const active = state === 'receiving';
  const starting = state === 'starting';
  const set = <K extends keyof DownlinkConfig>(key: K, value: DownlinkConfig[K]) => {
    if (config[key] !== value) downlink.setConfig(current => ({ ...current, [key]: value }));
  };
  const streams = buildStreams(activeConfig ?? config);
  const status = starting ? 'Checking browser codecs…'
    : active ? (outage || stats?.inOutage) ? 'Link interrupted'
      : reconfiguring ? 'Adjusting video…'
        : stats?.streams.some(stream => stream.waitingForKeyframe) ? 'Waiting for keyframes' : null
      : null;

  return <div className="downlink-controls">
    <div className="downlink-actions">
      <button type="button" disabled={disabled && !active && !starting}
        onClick={() => active || starting ? downlink.stop() : void downlink.start()}>
        {starting ? 'Cancel startup' : active ? 'Stop live link' : 'Start live link'}
      </button>
      {active && <button type="button" aria-pressed={outage} onClick={() => downlink.setOutage(!outage)}>
        {outage ? 'Restore link' : 'Interrupt link'}
      </button>}
      {active && <span className="downlink-rate">
        Received {stats ? formatRate(stats.deliveredBitrateBps) : '—'}
        {receiverHeight !== null && ' · ' + receiverHeight + 'p'}
      </span>}
      {status && <span role="status">{status}</span>}
    </div>
    {error && <p className="downlink-error" role="alert">{error}</p>}
    {controls && <LinkTuning controls={controls} />}
    {config.program === 'both' && <SelectField label="Receiver view" value={receiver} options={programs.slice(0, 2)}
      onChange={value => downlink.setReceiver(value as 'main' | '360')} />}

    <div className="downlink-settings">
      <SelectField label="Program" value={config.program} options={programs}
        onChange={value => set('program', value as DownlinkConfig['program'])} />
      {config.program !== 'main' && <SelectField label="Stitching" value={config.architecture}
        options={[{ value: 'onboard', label: 'Onboard · one panorama' }, { value: 'ground', label: 'Ground · two camera feeds' }]}
        onChange={value => set('architecture', value as DownlinkConfig['architecture'])} />}
      <SelectField label="Codec" value={config.codec}
        options={[{ value: 'h264', label: 'H.264 / AVC' }, { value: 'h265', label: 'H.265 / HEVC' }, { value: 'av1', label: 'AV1' }, { value: 'vp9', label: 'VP9' }]}
        onChange={value => set('codec', value as DownlinkConfig['codec'])} />
      <SelectField label="Capture rate" value={String(config.fps)}
        options={[{ value: '15', label: '15 fps' }, { value: '30', label: '30 fps' }]}
        onChange={value => set('fps', Number(value) as DownlinkConfig['fps'])} />
      {!controls && <SelectField label="Encoded height" value={String(config.resolution)} options={resolutions}
        onChange={value => set('resolution', Number(value) as DownlinkResolution)} />}
      {!controls?.adaptive && <NumberField label="Total video target" unit="Mbps" min={0.001} max={50} step={0.001} digits={3}
        value={config.videoBitrateBps / 1_000_000} onChange={value => set('videoBitrateBps', Math.round(value * 1_000_000))} />}
      {!controls && <NumberField label="Net link capacity" unit="Mbps" min={0.01} max={100} step={0.01}
        value={config.linkBitrateBps / 1_000_000} onChange={value => set('linkBitrateBps', value * 1_000_000)} />}
    </div>

    <details className="downlink-details">
      <summary>Transport settings</summary>
      <div className="downlink-settings">
        <NumberField label="One-way delay" unit="ms" min={0} max={2_000} step={5} digits={0}
          value={config.propagationMs} onChange={value => set('propagationMs', value)} />
        <NumberField label="Queue service limit" unit="ms" min={25} max={2_000} step={25} digits={0}
          value={config.maxQueueMs} onChange={value => set('maxQueueMs', value)} />
        <NumberField label="Keyframe interval" unit="ms" min={250} max={10_000} step={250} digits={0}
          value={config.keyIntervalMs} onChange={value => set('keyIntervalMs', value)} />
      </div>
    </details>

    <details className="downlink-details">
      <summary>Stream details</summary>
      {stats && <dl className="downlink-readout">
        <div><dt>Encoded</dt><dd>{formatRate(stats.encodedBitrateBps)}</dd></div>
        <div><dt>Receiver view</dt><dd>{downlink.receiverFps} fps</dd></div>
        <div><dt>Queue age</dt><dd>{fmt(stats.queueAgeMs, 0)} ms</dd></div>
        <div><dt>Source / link drops</dt><dd>{stats.sourceDrops} / {stats.channelDrops}</dd></div>
        <div><dt>Dependency / decode drops</dt><dd>{stats.dependencyDrops} / {stats.decoderDrops}</dd></div>
      </dl>}
      <ul className="downlink-streams">
        {streams.map(stream => {
          const result = stats?.streams.find(item => item.id === stream.id);
          return <li key={stream.id}>
            <span>{labels[stream.id]}</span>
            <small>{stream.width} × {stream.height} · {formatRate(stream.bitrateBps)} target</small>
            {result && <small>{result.codecString} · {result.decodedFps} fps decoded</small>}
          </li>;
        })}
      </ul>
    </details>
  </div>;
}
