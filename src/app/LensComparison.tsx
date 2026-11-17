import { useEffect, useRef, useState } from 'react';
import { computeMetrics, getSensor, sampleState, type Scenario } from '../sim';
import type { ImagingEngine } from '../render';
import type { DownlinkConfig } from '../downlink';
import { decodeComparisonFrame, type ComparisonDecode } from './lens-comparison-codec';
import { fmt, NumberField } from './fields';
import './lens-comparison.css';

export function withMainFocalLength(scenario: Scenario, focalLengthMm: number): Scenario {
  return { ...scenario, cameras: scenario.cameras.map(camera => camera.id === 'main' ? { ...camera, lens: { ...camera.lens, focalLengthMm } } : camera) };
}

export interface ComparisonSnapshot { scenario: Scenario; timeS: number; config: DownlinkConfig }
interface Result { focal: number; source: ImageBitmap; received?: ComparisonDecode; error?: string; scenario: Scenario }

function FrameView({ image, target, label, targetVisible }: { image: ImageBitmap | HTMLCanvasElement; target: [number, number]; label: string; targetVisible: boolean }) {
  const overview = useRef<HTMLCanvasElement>(null);
  const crop = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = crop.current!;
    const context = canvas.getContext('2d')!;
    const full = overview.current!;
    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      const x = Math.round(target[0] - canvas.width / 2), y = Math.round(target[1] - canvas.height / 2);
      context.fillStyle = '#080a0c'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, -x, -y);
      full.width = Math.round(full.clientWidth * dpr); full.height = Math.round(full.clientHeight * dpr);
      const fullContext = full.getContext('2d')!;
      const scale = Math.min(full.width / image.width, full.height / image.height);
      const left = (full.width - image.width * scale) / 2, top = (full.height - image.height * scale) / 2;
      fullContext.fillStyle = '#080a0c'; fullContext.fillRect(0, 0, full.width, full.height);
      fullContext.drawImage(image, left, top, image.width * scale, image.height * scale);
      fullContext.strokeStyle = '#f7f7f7'; fullContext.lineWidth = dpr;
      fullContext.strokeRect(left + x * scale, top + y * scale, canvas.width * scale, canvas.height * scale);
    };
    const observer = new ResizeObserver(paint); observer.observe(canvas); paint();
    window.addEventListener('resize', paint);
    return () => { observer.disconnect(); window.removeEventListener('resize', paint); };
  }, [image, target[0], target[1]]);
  return <section className="comparison-frame"><h3>{label} · {image.width} × {image.height}</h3>
    <canvas className="comparison-overview" ref={overview} aria-label={`${label} full frame; box marks the crop`} />
    <canvas className="comparison-crop" ref={crop} aria-label={`${label} native pixel crop centered on ${targetVisible ? 'Stanford' : 'image center'}`} />
    <p>{targetVisible ? 'Stanford' : 'Image center'} crop · 1 image pixel = 1 display pixel</p>
  </section>;
}

export function LensComparison({ snapshot, engine, focalLengths, onFocalLengths, onClose, imageryReady, imageryMessage, imageryId, onBusy }: {
  snapshot: ComparisonSnapshot; engine: ImagingEngine; focalLengths: [number, number];
  onFocalLengths: (values: [number, number]) => void; onClose: () => void; imageryReady: boolean; imageryMessage: string; imageryId: string; onBusy: (busy: boolean) => void;
}) {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    if (busy || !imageryReady) return;
    const controller = new AbortController(); cancel.current = controller;
    setBusy(true); onBusy(true); setError(''); setCapturedImagery(imageryId);
    // Let React commit the imagery upload freeze before either capture.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    held.current.forEach(result => result.source.close()); held.current = []; setResults([]);
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
        try { result.received = await decodeComparisonFrame(result.source, config, controller.signal); }
        catch (cause) { controller.signal.throwIfAborted(); result.error = cause instanceof Error ? cause.message : String(cause); }
        setResults([...held.current]);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
    finally { if (!controller.signal.aborted) { setBusy(false); onBusy(false); } }
  };
  return <dialog ref={dialog} className="lens-comparison" onCancel={onClose}>
    <header><h2>Compare main lenses</h2><button onClick={onClose} aria-label="Close lens comparison">Close</button></header>
    <p>Frozen at {sampleState(snapshot.scenario, snapshot.timeS).epochISO} · same sensor, exposure and attitude. Ground-image uploads are held during capture; each footprint uses the available detail coverage.</p>
    <div className="comparison-controls">
      {focalLengths.map((focal, i) => <NumberField key={i} label={`Lens ${i === 0 ? 'A' : 'B'}`} unit="mm" value={focal} min={0.01} max={10000} step={1}
        onChange={value => { if (!busy) { const next: [number, number] = [...focalLengths]; next[i] = value; onFocalLengths(next); } }} />)}
      <button onClick={() => void run()} disabled={busy || !imageryReady}>{busy ? 'Rendering and decoding…' : 'Capture both lenses'}</button>
    </div>
    <p>{imageryMessage} · Capture uses the currently available imagery, including coarse coverage if detail is unavailable.</p>
    {capturedImagery && <p>Available detail image: {capturedImagery}</p>}
    <p>Received: {config.codec.toUpperCase()} · {config.resolution}p · {fmt(config.videoBitrateBps / 1e6, 2)} Mb/s target at {config.fps} fps · {fmt(config.linkBitrateBps / 1e6, 2)} Mb/s link. Each lens sends one real encoded keyframe through an independent empty queue, with the same link limits. This is a still-frame comparison; it does not measure sustained video quality.</p>
    {error && <p role="alert">{error}</p>}
    <div className="comparison-columns">{results.map((result, i) => {
      const metrics = computeMetrics(result.scenario, 'main', snapshot.timeS);
      const projected = metrics.targetPixel;
      const targetVisible = metrics.groundVisible && sampleState(result.scenario, snapshot.timeS).targetElevationDeg > 0 && !!projected
        && projected[0] >= 0 && projected[0] < sensor.width && projected[1] >= 0 && projected[1] < sensor.height;
      const target: [number, number] = targetVisible ? projected! : [sensor.width / 2, sensor.height / 2];
      const decoded = result.received?.image;
      return <article key={i}><h2>Lens {i === 0 ? 'A' : 'B'} · {result.focal} mm</h2>
        <p>Center GSD {metrics.groundVisible ? `${fmt(metrics.gsdXM, 2)} × ${fmt(metrics.gsdYM, 2)} m/pixel` : 'unavailable (no ground intersection)'}{!targetVisible && ' · Stanford is outside the visible image; showing center'}</p>
        <FrameView image={result.source} target={target} targetVisible={targetVisible} label="Source" />
        {decoded && <FrameView image={decoded} target={[target[0] * decoded.width / sensor.width, target[1] * decoded.height / sensor.height]} targetVisible={targetVisible} label="Received" />}
        {decoded && <p>Received center sampling: {metrics.groundVisible ? `${fmt(metrics.gsdXM * sensor.width / decoded.width, 2)} × ${fmt(metrics.gsdYM * sensor.height / decoded.height, 2)} m/pixel` : 'unavailable (no ground intersection)'}</p>}
        {result.received && <p>{fmt(result.received.bytes / 1000, 1)} kB including decoder description · {result.received.codec} · {result.received.dropped ? `not received: ${result.received.dropped} limit` : `${fmt(result.received.arrivalMs!, 1)} ms modeled arrival`}</p>}
        {result.error && <p role="alert">Source captured. Received unavailable: {result.error}</p>}
      </article>;
    })}</div>
  </dialog>;
}
