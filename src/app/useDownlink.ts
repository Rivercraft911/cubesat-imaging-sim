import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SetStateAction } from 'react';
import { DEFAULT_DOWNLINK_CONFIG, DownlinkSession, type DownlinkConfig, type DownlinkStats } from '../downlink';
import type { ImagingEngine } from '../render';
import { getSensor, type Scenario } from '../sim';

type Receiver = 'main' | '360';
type State = 'off' | 'starting' | 'receiving' | 'error';
type EyePair = { wideA?: VideoFrame; wideB?: VideoFrame };

interface Run {
  session: DownlinkSession;
  pendingPairs: Map<number, EyePair>;
  stills: Partial<Record<Receiver, HTMLCanvasElement>>;
  presentationTimes: Record<Receiver, number[]>;
  lastStitchedPts: number;
}

function closePair(pair: EyePair): void {
  pair.wideA?.close();
  pair.wideB?.close();
}

function paint(canvas: HTMLCanvasElement, source: VideoFrame | HTMLCanvasElement): void {
  const width = 'displayWidth' in source ? source.displayWidth : source.width;
  const height = 'displayHeight' in source ? source.displayHeight : source.height;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not open the receiver canvas.');
  context.drawImage(source, 0, 0, width, height);
}

function recentFps(times: number[], now: number): number {
  while (times.length > 0 && times[0] <= now - 1_000) times.shift();
  return times.length;
}

/** Receiver callbacks borrow a canvas whose pixels are updated in place on each presented frame. */
export function useDownlink(
  engine: RefObject<ImagingEngine | null>,
  scenario: Scenario,
  timeS: number,
  onFrameTime?: (timeS: number) => void,
  onReceiverFrame?: (canvas: HTMLCanvasElement | null, receiver: Receiver) => void,
) {
  const [settings, setConfigValue] = useState<DownlinkConfig>({ ...DEFAULT_DOWNLINK_CONFIG });
  const mainCamera = scenario.cameras.find(camera => camera.id === 'main')!;
  const mainSensor = getSensor(mainCamera.sensorId, scenario.customSensor);
  const mainAspectRatio = mainSensor.width / mainSensor.height;
  const config = useMemo(() => ({ ...settings, mainAspectRatio }), [settings, mainAspectRatio]);
  const [state, setState] = useState<State>('off');
  const [outage, setOutageValue] = useState(false);
  const [stats, setStats] = useState<DownlinkStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiverValue] = useState<Receiver>('main');
  const [receiverHasFrame, setReceiverHasFrame] = useState(false);
  const [receiverRates, setReceiverRates] = useState<Record<Receiver, number>>({ main: 0, '360': 0 });
  const runRef = useRef<Run | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const receiverRef = useRef<Receiver>('main');
  const onFrameTimeRef = useRef(onFrameTime);
  const onReceiverFrameRef = useRef(onReceiverFrame);
  const capturingRef = useRef(false);
  const stitchingRef = useRef(false);

  useLayoutEffect(() => { onFrameTimeRef.current = onFrameTime; }, [onFrameTime]);
  useLayoutEffect(() => { onReceiverFrameRef.current = onReceiverFrame; }, [onReceiverFrame]);

  const refreshReceiver = useCallback(() => {
    const canvas = canvasRef.current;
    const source = runRef.current?.stills[receiverRef.current];
    if (canvas && source) paint(canvas, source);
    if (canvas && !source) {
      canvas.width = 1;
      canvas.height = 1;
    }
    setReceiverHasFrame(Boolean(source));
    return source ?? null;
  }, []);

  const receiverCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas) refreshReceiver();
  }, [refreshReceiver]);

  const setReceiver = useCallback((next: Receiver) => {
    receiverRef.current = next;
    setReceiverValue(next);
    const still = refreshReceiver();
    onReceiverFrameRef.current?.(still, next);
  }, [refreshReceiver]);

  const release = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (!run) return;
    run.session.stop();
    for (const pair of run.pendingPairs.values()) closePair(pair);
    run.pendingPairs.clear();
    run.stills = {};
  }, []);

  const stop = useCallback(() => {
    release();
    setState('off');
    setStats(null);
    setError(null);
    setOutageValue(false);
    setReceiverRates({ main: 0, '360': 0 });
    refreshReceiver();
    onReceiverFrameRef.current?.(null, receiverRef.current);
  }, [refreshReceiver, release]);

  useLayoutEffect(() => {
    stop();
    return release;
  }, [scenario, stop, release]);

  const setConfig = useCallback((next: SetStateAction<DownlinkConfig>) => {
    stop();
    setConfigValue(previous => typeof next === 'function' ? next({ ...previous, mainAspectRatio }) : next);
  }, [mainAspectRatio, stop]);

  useLayoutEffect(() => {
    if (config.program !== 'both') setReceiver(config.program);
  }, [config.program, setReceiver]);

  const setOutage = useCallback((active: boolean) => {
    runRef.current?.session.setOutage(active);
    setOutageValue(active);
  }, []);

  const start = useCallback(async () => {
    stop();
    const source = engine.current;
    if (!source) {
      setError('The imaging renderer is still initializing.');
      setState('error');
      return;
    }
    setState('starting');
    let initialPts: number | undefined;
    let lastCapturePts: number | undefined;

    const fail = (cause: unknown) => {
      if (runRef.current !== run) return;
      stop();
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    };

    const present = (id: Receiver, frame: VideoFrame | HTMLCanvasElement) => {
      if (runRef.current !== run) return;
      const still = run.stills[id] ?? document.createElement('canvas');
      paint(still, frame);
      run.stills[id] = still;
      const now = performance.now();
      const times = run.presentationTimes[id];
      recentFps(times, now);
      times.push(now);
      if (receiverRef.current === id) {
        refreshReceiver();
        onReceiverFrameRef.current?.(still, id);
      }
    };

    const stitchNext = async () => {
      if (stitchingRef.current || runRef.current !== run) return;
      const ready = [...run.pendingPairs.entries()].sort(([a], [b]) => b - a).find(([, pair]) => pair.wideA && pair.wideB);
      if (!ready) return;
      const [ptsUs, pair] = ready;
      run.pendingPairs.delete(ptsUs);
      run.lastStitchedPts = ptsUs;
      for (const [older, pending] of run.pendingPairs) {
        if (older <= ptsUs) {
          closePair(pending);
          run.pendingPairs.delete(older);
        }
      }
      stitchingRef.current = true;
      try {
        const height = config.resolution;
        const image = await source.stitchDecodedFrames(pair.wideA!, pair.wideB!, height * 2, height);
        present('360', image);
      } catch (cause) {
        fail(cause);
      } finally {
        closePair(pair);
        stitchingRef.current = false;
        void stitchNext();
      }
    };

    const session = new DownlinkSession({
      async getFrame(stream, ptsUs) {
        if (runRef.current !== run || engine.current !== source || capturingRef.current) return null;
        initialPts ??= ptsUs;
        const captureUs = Math.round(timeS * 1_000_000) + ptsUs - initialPts;
        if (ptsUs !== lastCapturePts) {
          lastCapturePts = ptsUs;
          onFrameTimeRef.current?.(captureUs / 1_000_000);
        }
        capturingRef.current = true;
        try {
          const canvas = await source.getEncoderCanvas(stream.id, stream.width, stream.height, captureUs);
          if (runRef.current !== run || engine.current !== source) return null;
          return new VideoFrame(canvas, { timestamp: ptsUs, duration: Math.round(1_000_000 / config.fps) });
        } finally {
          capturingRef.current = false;
        }
      },
      onDecoded(stream, frame) {
        if (runRef.current !== run) return;
        if (stream.id === 'main' || stream.id === 'panorama') {
          present(stream.id === 'main' ? 'main' : '360', frame);
          return;
        }
        const ptsUs = frame.timestamp;
        if (ptsUs <= run.lastStitchedPts) return;
        const pair = run.pendingPairs.get(ptsUs) ?? {};
        pair[stream.id]?.close();
        pair[stream.id] = frame.clone();
        run.pendingPairs.set(ptsUs, pair);
        const limit = stitchingRef.current ? 1 : 2;
        while (run.pendingPairs.size > limit) {
          const oldest = Math.min(...run.pendingPairs.keys());
          closePair(run.pendingPairs.get(oldest)!);
          run.pendingPairs.delete(oldest);
        }
        void stitchNext();
      },
      onStats(nextStats) {
        if (runRef.current !== run) return;
        setStats(nextStats);
        const now = performance.now();
        setReceiverRates({
          main: recentFps(run.presentationTimes.main, now),
          '360': recentFps(run.presentationTimes['360'], now),
        });
      },
      onError: fail,
    });
    const run: Run = {
      session, pendingPairs: new Map(), stills: {}, presentationTimes: { main: [], '360': [] },
      lastStitchedPts: -Infinity,
    };
    runRef.current = run;
    try {
      const support = await session.start(config);
      if (runRef.current !== run) return;
      if (support.supported) setState('receiving');
      else fail(support.reason);
    } catch (cause) {
      if (runRef.current === run) fail(cause);
    }
  }, [config, engine, refreshReceiver, stop, timeS]);

  return {
    config, setConfig, state, start, stop, outage, setOutage, stats, error,
    receiver, setReceiver, receiverCanvas, receiverHasFrame, receiverFps: receiverRates[receiver],
  };
}
