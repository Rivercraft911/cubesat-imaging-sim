import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeMetrics, createDefaultScenario, getSensor, parseScenario, sampleState,
} from '../sim';
import type { CameraConfig, CameraId, Scenario } from '../sim';
import type { RenderView } from '../render';
import { download } from './fields';
import { ImageWorkspace, type Feed } from './ImageWorkspace';
import { InspectorDrawer, OpticalControls, type Panel } from './InstrumentControls';
import { Masthead } from './Masthead';
import { Timeline } from './Timeline';
import { useDownlink } from './useDownlink';
import { useEngine } from './useEngine';
import { useImagery } from './useImagery';
import { editCamera } from '../sim/camera-edit';

const PASS_END_S = 360;

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(createDefaultScenario);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<RenderView>('image');
  const [cameraId, setCameraId] = useState<CameraId>('main');
  const [inspection, setInspection] = useState<'fit' | 'native'>('fit');
  const [panoramaProjection, setPanoramaProjection] = useState<'perspective' | 'equirectangular'>('perspective');
  const [panoramaFov, setPanoramaFov] = useState(90);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [feed, setFeed] = useState<Feed>('source');
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);

  const { engine, status, version } = useEngine(canvas, host);
  const advanceDownlink = useCallback((timeS: number) => setTime(Math.min(timeS, PASS_END_S)), []);
  const receivedFrame = useRef<{ canvas: HTMLCanvasElement | null; receiver: 'main' | '360' }>({ canvas: null, receiver: 'main' });
  const currentFeed = useRef(feed);
  currentFeed.current = feed;
  const receiveFrame = useCallback((image: HTMLCanvasElement | null, receiver: 'main' | '360') => {
    receivedFrame.current = { canvas: image, receiver };
    engine.current?.setReceivedPanorama(currentFeed.current === 'received' && receiver === '360' ? image : null);
  }, [engine]);
  const downlink = useDownlink(engine, scenario, time, advanceDownlink, receiveFrame);
  const stopDownlink = downlink.stop;
  const linkActive = downlink.state === 'receiving' || downlink.state === 'starting';
  const received = linkActive && feed === 'received';
  const displayView = received ? (downlink.receiver === '360' ? 'panorama' : 'image') : view;
  const { image, baseImage, progress } = useImagery(engine, version, scenario, time);

  const activeCameraId = received && downlink.receiver === 'main' ? 'main' : cameraId;
  const camera = scenario.cameras.find(item => item.id === activeCameraId)!;
  const sensor = getSensor(camera.sensorId, scenario.customSensor);
  const sample = useMemo(() => sampleState(scenario, time), [scenario, time]);
  const metrics = useMemo(() => computeMetrics(scenario, activeCameraId, time), [scenario, activeCameraId, time]);

  useEffect(() => { engine.current?.updateScenario(scenario, time); }, [scenario, time, version, engine]);
  useEffect(() => { engine.current?.setView(displayView, received && downlink.receiver === 'main' ? 'main' : cameraId); }, [displayView, received, downlink.receiver, cameraId, version, engine]);
  useEffect(() => { engine.current?.setSelectedCamera?.(displayView === 'space' ? activeCameraId : null); }, [displayView, activeCameraId, version, engine]);
  useEffect(() => {
    const instance = engine.current;
    instance?.setCameraSelectHandler?.(id => { setCameraId(id === 'main' ? id : 'wideA'); setFeed('source'); setPanel('optics'); });
    return () => instance?.setCameraSelectHandler?.(null);
  }, [version, engine]);
  useEffect(() => { engine.current?.setInspection(inspection); }, [inspection, version, engine]);
  useEffect(() => { engine.current?.setQuality(quality); }, [quality, version, engine]);
  useEffect(() => { engine.current?.setPanoramaProjection(panoramaProjection); }, [panoramaProjection, version, engine]);
  useEffect(() => { engine.current?.setPanoramaFov(panoramaFov); }, [panoramaFov, version, engine]);
  useEffect(() => {
    const frame = receivedFrame.current;
    engine.current?.setReceivedPanorama(received && frame.receiver === '360' ? frame.canvas : null);
  }, [received, downlink.receiver, version, engine]);
  useEffect(() => {
    const element = canvas.current;
    let update = 0;
    const syncFov = () => {
      cancelAnimationFrame(update);
      update = requestAnimationFrame(() => {
        if (engine.current) setPanoramaFov(engine.current.getPanoramaFov());
      });
    };
    element?.addEventListener('wheel', syncFov, { passive: true });
    return () => { element?.removeEventListener('wheel', syncFov); cancelAnimationFrame(update); };
  }, [engine, version]);
  useEffect(() => {
    if (linkActive) setPlaying(false);
    setFeed(linkActive ? 'received' : 'source');
  }, [linkActive]);
  useEffect(() => {
    if (linkActive && time >= PASS_END_S) stopDownlink();
  }, [linkActive, stopDownlink, time]);

  const changePlayback = useCallback((next: boolean) => {
    if (next) stopDownlink();
    setPlaying(next);
  }, [stopDownlink]);

  const scrubTime = useCallback((next: number) => {
    if (linkActive) stopDownlink();
    setTime(next);
  }, [linkActive, stopDownlink]);

  const change = (next: Scenario) => {
    setScenario(next);
    setNotice('');
  };

  const changeCamera = (changes: Partial<CameraConfig>) => {
    change(editCamera(scenario, activeCameraId, changes));
  };

  const save = () => {
    const data = {
      scenario,
      timeS: time,
      source: image ? {
        id: image.id,
        boundsMercator: image.boundsMercator,
        rasterSpacingM: image.sourceResolutionM,
        attribution: image.attribution,
      } : null,
      backgroundSource: baseImage ? {
        id: baseImage.id,
        boundsMercator: baseImage.boundsMercator,
        rasterSpacingM: baseImage.sourceResolutionM,
        attribution: baseImage.attribution,
      } : null,
      model: 'wgs84-circular-sso-v1',
    };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `field-of-view-${scenario.target.id}.json`);
  };

  const capture = async () => {
    if (!engine.current || capturing) return;
    setCapturing(true);
    setNotice('');
    const id = displayView === 'panorama' ? 'panorama' : received ? 'main' : cameraId;
    try {
      const blob = await engine.current.capture({ cameraId: id });
      download(blob, `${scenario.target.id}-${id === 'panorama' ? '360' : id}-${Math.round(time)}s.png`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setCapturing(false);
    }
  };

  const importScenario = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const next = parseScenario(data.scenario ?? data);
      setPlaying(false);
      change(next);
      setTime(Math.max(-PASS_END_S, Math.min(PASS_END_S, Number(data.timeS) || 0)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not read this scenario.');
    }
  };

  const selectView = (next: RenderView) => {
    setFeed('source'); setView(next);
    if (next === 'panorama' || (next === 'space' && cameraId === 'wideB')) setCameraId('wideA');
  };
  const selectFeed = (next: Feed) => {
    if (next === 'source' && linkActive) {
      setView(downlink.receiver === '360' ? 'panorama' : 'image');
      if (downlink.receiver === 'main') setCameraId('main');
    }
    setFeed(next);
  };

  return (
    <main className="instrument">
      <Masthead view={displayView} onViewChange={selectView} onImport={importScenario} onSave={save}
        onCapture={capture} ready={status.ready} capturing={capturing} />
      <div className={`workspace ${panel ? 'has-inspector' : ''}`}>
        <ImageWorkspace view={displayView} camera={camera} sensor={sensor} sample={sample}
          target={scenario.target} altitudeM={scenario.altitudeM} bodyWidthM={scenario.body.widthM}
          canvas={canvas} host={host} status={status} metrics={metrics} image={image} progress={progress}
          feed={feed} setFeed={selectFeed} linkActive={linkActive} downlink={downlink}
          inspection={inspection} setInspection={mode => { engine.current?.setInspection(mode); setInspection(mode); }} quality={quality} setQuality={setQuality}
          panoramaProjection={panoramaProjection} setPanoramaProjection={setPanoramaProjection}
          panoramaFov={panoramaFov} setPanoramaFov={setPanoramaFov}
          resetSpaceView={() => engine.current?.resetSpaceView?.()} />
        {panel && <InspectorDrawer panel={panel} scenario={scenario} cameraId={activeCameraId}
          onChange={change} onClose={() => setPanel(null)} onPanel={setPanel} downlink={downlink} ready={status.ready} />}
      </div>
      <OpticalControls camera={camera} cameras={scenario.cameras} panel={panel} pairedView={displayView !== 'image'}
        onCamera={id => { setCameraId(id); selectView(displayView === 'space' ? 'space' : displayView === 'panorama' && id !== 'main' ? 'panorama' : 'image'); }}
        onFocalLength={focalLengthMm => changeCamera({ lens: { ...camera.lens, focalLengthMm } })}
        onPanel={id => setPanel(current => current === id ? null : id)} />
      <Timeline time={time} setTime={scrubTime} playing={playing} setPlaying={changePlayback}
        speed={speed} setSpeed={setSpeed} rangeM={sample.targetSlantRangeM} elevation={sample.targetElevationDeg} />
      {notice && <div className="status-notice" role="status" onClick={() => setNotice('')}>{notice}</div>}
    </main>
  );
}
