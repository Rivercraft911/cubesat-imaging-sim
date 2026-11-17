import { useEffect, useRef, useState } from 'react';
import { computeMetrics, getSensor, projectStudyLandmark, sampleState, type Scenario } from '../sim';
import type { ImagingEngine } from '../render';
import type { DownlinkConfig } from '../downlink';
import { decodeComparisonFrame, type ComparisonDecode } from './lens-comparison-codec';
import { fmt, NumberField } from './fields';
import { ComparisonFrame } from './ComparisonFrame';
import './lens-comparison.css';

export function withMainFocalLength(scenario: Scenario, focalLengthMm: number): Scenario {
  return { ...scenario, cameras: scenario.cameras.map(camera => camera.id === 'main' ? { ...camera, lens: { ...camera.lens, focalLengthMm } } : camera) };
}

export interface ComparisonSnapshot { scenario: Scenario; timeS: number; config: DownlinkConfig }
interface Result { focal: number; source: ImageBitmap; received?: ComparisonDecode; error?: string; scenario: Scenario }

export function LensComparison({ snapshot, engine, focalLengths, onFocalLengths, onClose, imageryReady, imageryMessage, imageryId, onBusy }: {
  snapshot: ComparisonSnapshot; engine: ImagingEngine; focalLengths: [number, number];
  onFocalLengths: (values: [number, number]) => void; onClose: () => void; imageryReady: boolean; imageryMessage: string; imageryId: string; onBusy: (busy: boolean) => void;
}) {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feed, setFeed] = useState<'source' | 'received'>('source');
  const [fit, setFit] = useState(false);
  const started = useRef(false);
  const [capturedImagery, setCapturedImagery] = useState('');
  const cancel = useRef<AbortController | null>(null);
  const held = useRef<Result[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => { cancel.current?.abort(); held.current.forEach(result => result.source.close()); };
  }, []);
  const main = snapshot.scenario.cameras.find(camera => camera.id === 'main')!;
  const sensor = getSensor(main.sensorId, snapshot.scenario.customSensor);
  const config = { ...snapshot.config, program: 'main' as const,
    videoBitrateBps: snapshot.config.program === 'both' ? Math.floor(snapshot.config.videoBitrateBps / 2) : snapshot.config.videoBitrateBps,
    mainAspectRatio: sensor.width / sensor.height };
  const run = async () => {
    if (busy) return;
    started.current = true;
    const controller = new AbortController(); cancel.current = controller;
    setBusy(true); onBusy(true); setError(''); setCapturedImagery(imageryId);
    // Let React commit the imagery upload freeze before either capture.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    held.current.forEach(result => result.source.close());
    held.current = [];
    setResults([]);
    try {
      controller.signal.throwIfAborted();
      const groundRevision = engine.getGroundRevision();
      for (const focal of focalLengths) {
        const scenario = withMainFocalLength(snapshot.scenario, focal);
        const blob = await engine.capture({ cameraId: 'main', study: { scenario, timeS: snapshot.timeS, groundRevision } });
        controller.signal.throwIfAborted();
        const source = await createImageBitmap(blob);
        if (controller.signal.aborted) { source.close(); controller.signal.throwIfAborted(); }
        const result: Result = { focal, source, scenario }; held.current.push(result);
      }
      setResults([...held.current]);
      for (const result of held.current) {
        try {
          const study = { scenario: result.scenario, timeS: snapshot.timeS, groundRevision };
          result.received = await decodeComparisonFrame((width, height, init) =>
            engine.getEncoderFrame('main', width, height, snapshot.timeS * 1e6, init, study), config, controller.signal);
        }
        catch (cause) { controller.signal.throwIfAborted(); result.error = cause instanceof Error ? cause.message : String(cause); }
        setResults([...held.current]);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
    finally { if (!controller.signal.aborted) { setBusy(false); onBusy(false); } }
  };
  // Capture the opening pair once the requested imagery settles. A slow source
  // can still be inspected immediately using the manual capture action.
  useEffect(() => {
    if (started.current || !imageryReady) return;
    // Opening changes the requested footprint; let its image effects publish first.
    const timer = setTimeout(() => { if (!started.current) void run(); }, 160);
    return () => clearTimeout(timer);
  }, [imageryReady, imageryId, focalLengths]);
  const sample = sampleState(snapshot.scenario, snapshot.timeS);
  const utc = sample.epochISO.replace('T', ' ').slice(0, 19);
  return <dialog ref={dialog} className="lens-comparison" aria-labelledby="comparison-title" onCancel={onClose}>
    <header className="comparison-heading">
      <div><h2 id="comparison-title">Lens comparison</h2><p>{snapshot.scenario.target.name} · {utc} UTC · {fmt(snapshot.scenario.altitudeM / 1000, 0)} km</p></div>
      <button onClick={onClose} aria-label="Close lens comparison">Close</button>
    </header>
    <div className="comparison-controls">
      <fieldset disabled={busy}>
        {focalLengths.map((focal, i) => <NumberField key={i} label={`Lens ${i === 0 ? 'A' : 'B'}`} unit="mm" value={focal} min={0.01} max={10000} step={1}
          onChange={value => { const next: [number, number] = [...focalLengths]; next[i] = value; onFocalLengths(next); }} />)}
      </fieldset>
      <button className="comparison-capture" onClick={() => void run()} disabled={busy}>{busy ? 'Capturing…' : 'Capture both lenses'}</button>
      <div className="comparison-toggles">
        <div className="inspection-buttons" aria-label="Comparison feed">
          {(['source', 'received'] as const).map(value => <button key={value} aria-pressed={value === feed}
            className={value === feed ? 'active' : ''} onClick={() => setFeed(value)}>{value === 'source' ? 'Source' : 'Received'}</button>)}
        </div>
        <div className="inspection-buttons" aria-label="Comparison scale">
          <button aria-pressed={fit} className={fit ? 'active' : ''} onClick={() => setFit(true)}>Fit</button>
          <button aria-pressed={!fit} className={!fit ? 'active' : ''} onClick={() => setFit(false)}>1:1</button>
        </div>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    {results.length === 0 && !error && <p className="comparison-pending" role="status">{busy ? 'Rendering the two native exposures…' : imageryMessage}</p>}
    <div className="comparison-columns">{results.map((result, i) => {
      const metrics = computeMetrics(result.scenario, 'main', snapshot.timeS);
      const landmark = projectStudyLandmark(result.scenario, snapshot.timeS);
      const image = feed === 'source' ? result.source : result.received?.image;
      const received = result.received;
      const scaleX = sensor.width / (image?.width ?? sensor.width);
      const scaleY = sensor.height / (image?.height ?? sensor.height);
      const point: [number, number] | null = landmark.pixel ? [landmark.pixel[0] / scaleX, landmark.pixel[1] / scaleY] : null;
      return <article key={i}>
        <header><h3>{fmt(result.focal, 2)} <small>mm</small></h3>
          <span>{metrics.centerGroundVisible
            ? `${fmt(metrics.gsdXM * scaleX, 1)} × ${fmt(metrics.gsdYM * scaleY, 1)} m/px at center` : 'Center looks into space'}</span></header>
        {image ? <>
          <ComparisonFrame image={image} point={point} fit={fit} label={`Lens ${i === 0 ? 'A' : 'B'}, ${feed}`} />
          <p className="comparison-caption"><span>{point ? landmark.label : 'Image center · landmark out of view'}</span><span>{image.width} × {image.height}</span></p>
        </> : <p className="comparison-pending" role="status">{result.error ?? (received?.dropped ? `Keyframe exceeded the ${received.dropped} limit.` : 'Decoding keyframe…')}</p>}
        {feed === 'received' && received?.arrivalMs !== undefined && <p>{fmt(received.bytes / 1000, 1)} kB · {fmt(received.arrivalMs, 0)} ms modeled arrival</p>}
      </article>;
    })}</div>
    <details className="comparison-details"><summary>Capture details</summary>
      <p>{main.exposureStudy?.enabled ? 'Twilight exposure study' : 'Daylight source reference'} · {sensor.name} · f/{fmt(main.lens.fNumber, 1)} · {fmt(main.exposureMs, 2)} ms.
        Each lens sees the same pass instant with the finest loaded image that covers its footprint.</p>
      <p>{capturedImagery || imageryId || imageryMessage}</p>
      <p>{config.codec.toUpperCase()} · {config.resolution}p · {fmt(config.videoBitrateBps / 1e6, 2)} Mb/s at {config.fps} fps · {fmt(config.linkBitrateBps / 1e6, 2)} Mb/s link.
        Each received view decodes a single keyframe sent through its own empty queue. Use Live link to evaluate motion.</p>
    </details>
  </dialog>;
}
