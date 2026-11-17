import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SetStateAction } from 'react';
import { DEFAULT_DOWNLINK_CONFIG, DownlinkSession, type DownlinkConfig, type DownlinkStats } from '../downlink';
import { FramePairs, closePair } from '../downlink/frame-pairs';
import type { ImagingEngine } from '../render';
import { getSensor, type Scenario } from '../sim';
import { EncoderChanges, LiveCaptureClock, linkOptions, sameSessionSettings } from './live-downlink';

type Receiver = 'main' | '360';
type State = 'off' | 'starting' | 'receiving' | 'error';

interface Run {
  session: DownlinkSession;
  pendingPairs: FramePairs<VideoFrame>;
  config: DownlinkConfig;
  ready: boolean;
  presentationTimes: Record<Receiver, number[]>;
}

interface LiveLink {
  source: ImagingEngine;
  clock: LiveCaptureClock;
  encoding: EncoderChanges;
  lastWorking?: DownlinkConfig;
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
  const [activeConfig, setActiveConfig] = useState<DownlinkConfig | null>(null);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [outage, setOutageValue] = useState(false);
  const [stats, setStats] = useState<DownlinkStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiverValue] = useState<Receiver>('main');
  const [receiverWidth, setReceiverWidth] = useState<number | null>(null);
  const [receiverHeight, setReceiverHeight] = useState<number | null>(null);
  const [receiverRates, setReceiverRates] = useState<Record<Receiver, number>>({ main: 0, '360': 0 });
  const configRef = useRef(config);
  const linkRef = useRef<LiveLink | null>(null);
  const runRef = useRef<Run | null>(null);
  const stillsRef = useRef<Partial<Record<Receiver, HTMLCanvasElement>>>({});
  const outageRef = useRef(false);
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
    const source = stillsRef.current[receiverRef.current];
    if (canvas && source) paint(canvas, source);
    if (canvas && !source) {
      canvas.width = 1;
      canvas.height = 1;
    }
    setReceiverWidth(source?.width ?? null);
    setReceiverHeight(source?.height ?? null);
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

  const releaseRun = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (!run) return;
    run.session.stop();
    run.pendingPairs.clear();
  }, []);

  const release = useCallback(() => {
    linkRef.current?.encoding.cancel();
    linkRef.current = null;
    releaseRun();
    stillsRef.current = {};
  }, [releaseRun]);

  const stop = useCallback(() => {
    release();
    setState('off');
    setActiveConfig(null);
    setReconfiguring(false);
    setStats(null);
    setError(null);
    outageRef.current = false;
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
    if (!linkRef.current) {
      setError(null);
      setState('off');
    }
    setConfigValue(previous => typeof next === 'function' ? next({ ...previous, mainAspectRatio }) : next);
  }, [mainAspectRatio]);

  const setOutage = useCallback((active: boolean) => {
    outageRef.current = active;
    runRef.current?.session.setOutage(active);
    setOutageValue(active);
  }, []);

  const launch = useCallback(async function launchRun(link: LiveLink, encoding: DownlinkConfig) {
    if (linkRef.current !== link) return;
    releaseRun();
    setStats(null);
    setReceiverRates({ main: 0, '360': 0 });

    const source = link.source;
    const settings = { ...encoding, ...linkOptions(configRef.current) };

    const fail = (cause: unknown) => {
      if (runRef.current !== run) return;
      stop();
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    };

    const present = (id: Receiver, frame: VideoFrame | HTMLCanvasElement) => {
      if (runRef.current !== run) return;
      const still = stillsRef.current[id] ?? document.createElement('canvas');
      paint(still, frame);
      stillsRef.current[id] = still;
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
      const pair = run.pendingPairs.takeLatest();
      if (!pair) return;
      stitchingRef.current = true;
      try {
        const height = settings.resolution;
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
        const { captureUs, advanced } = link.clock.capture(ptsUs);
        if (advanced) onFrameTimeRef.current?.(captureUs / 1_000_000);
        capturingRef.current = true;
        try {
          const canvas = await source.getEncoderCanvas(stream.id, stream.width, stream.height, captureUs);
          if (runRef.current !== run || engine.current !== source) return null;
          return new VideoFrame(canvas, { timestamp: ptsUs, duration: Math.round(1_000_000 / settings.fps) });
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
        run.pendingPairs.add(stream.id, frame);
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
      session, pendingPairs: new FramePairs(), config: settings, ready: false,
      presentationTimes: { main: [], '360': [] },
    };
    runRef.current = run;
    session.setOutage(outageRef.current);
    try {
      const support = await session.start(settings);
      if (runRef.current !== run) return;
      if (!support.supported) {
        if (link.lastWorking && !sameSessionSettings(settings, link.lastWorking)) {
          setError(`${support.reason} Returning to the previous encoding settings.`);
          void launchRun(link, link.lastWorking);
        } else fail(support.reason);
        return;
      }
      run.ready = true;
      link.lastWorking = run.config;
      setActiveConfig(run.config);
      setReconfiguring(false);
      if (settings.program !== 'both' && receiverRef.current !== settings.program) setReceiver(settings.program);
      setState('receiving');
    } catch (cause) {
      if (runRef.current === run) fail(cause);
    }
  }, [engine, refreshReceiver, releaseRun, setReceiver, stop]);

  useLayoutEffect(() => {
    const previous = configRef.current;
    configRef.current = config;
    const link = linkRef.current;
    if (!link) {
      if (config.program !== 'both' && receiverRef.current !== config.program) setReceiver(config.program);
      return;
    }
    const run = runRef.current;
    if (run && (previous.linkBitrateBps !== config.linkBitrateBps || previous.propagationMs !== config.propagationMs
      || previous.maxQueueMs !== config.maxQueueMs)) {
      try {
        const options = linkOptions(config);
        run.session.setLinkOptions(options);
        run.config = { ...run.config, ...options };
        if (run.ready) setActiveConfig(run.config);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    const change = link.encoding.request(config, run?.config, next => void launch(link, next));
    if (change === 'unchanged') return;
    setError(null);
    if (change === 'current') {
      setReconfiguring(!run?.ready && Boolean(link.lastWorking));
      return;
    }
    // A pending probe has no frames to retain. Cancel it immediately so it cannot win the race.
    if (run && !run.ready) releaseRun();
    setReconfiguring(true);
  }, [config, launch, releaseRun, setReceiver]);

  const start = useCallback(async () => {
    stop();
    const source = engine.current;
    if (!source) {
      setError('The imaging renderer is still initializing.');
      setState('error');
      return;
    }
    const requested = configRef.current;
    const link: LiveLink = { source, clock: new LiveCaptureClock(timeS), encoding: new EncoderChanges(requested) };
    linkRef.current = link;
    setState('starting');
    await launch(link, requested);
  }, [engine, launch, stop, timeS]);

  return {
    config, setConfig, activeConfig, reconfiguring, state, start, stop, outage, setOutage, stats, error,
    receiver, setReceiver, receiverCanvas, receiverWidth, receiverHeight,
    receiverHasFrame: receiverHeight !== null, receiverFps: receiverRates[receiver],
  };
}
