import type { RefObject } from 'react';
import { buildStreams } from '../downlink';
import type { ImageryProgress } from '../imagery/provider';
import type { EngineStatus, GroundImage, RenderView, WideMountDragMode } from '../render/types';
import { mainImageModel, type CameraConfig, type CameraMetrics, type SensorProfile, type SimulationSample, type Target } from '../sim';
import { fmt } from './fields';
import { Icon } from './Icon';
import { MAIN_IMAGE_MODEL_LABELS } from './TwilightSettings';
import type { useDownlink } from './useDownlink';

type Downlink = ReturnType<typeof useDownlink>;
export type Feed = 'source' | 'received';

const MAIN_LIGHTING_NOTES = {
  pass: 'Main and 360° share sunlight, clouds and atmospheric scattering.',
  reference: 'The daylight reference keeps the lighting from the source imagery.',
  twilight: 'Twilight brightness uses the local Sun angle and the diffuse light and camera response specified in Camera settings.',
};

function ReceiverCaption({ downlink }: { downlink: Downlink }) {
  const streams = buildStreams(downlink.activeConfig ?? downlink.config).filter(stream => (
    downlink.receiver === 'main' ? stream.id === 'main' : stream.id !== 'main'
  ));
  const first = streams[0];
  const encoded = first ? `${first.width} × ${first.height} px` : '';
  const receivedBytes = streams.reduce((sum, stream) => (
    sum + (downlink.stats?.streams.find(stats => stats.id === stream.id)?.deliveredBytes ?? 0)
  ), 0);
  const received = receivedBytes < 1_000 ? `${receivedBytes} B`
    : receivedBytes < 1_000_000 ? `${fmt(receivedBytes / 1_000, 1)} kB`
      : `${fmt(receivedBytes / 1_000_000, 2)} MB`;
  return (
    <span title={`${fmt(receivedBytes, 0)} encoded bytes received`}>
      {encoded}{streams.length > 1 ? ' per eye' : ''} encoded · {received} received · {downlink.receiverFps} fps
    </span>
  );
}

export function ImageWorkspace({
  view, camera, sensor, sample, target, altitudeM, bodyWidthM, canvas, host, status, metrics, image, progress,
  feed, setFeed, linkActive, downlink, inspection, setInspection, quality, setQuality,
  panoramaProjection, setPanoramaProjection, panoramaFov, setPanoramaFov,
  resetSpaceView, spaceMountMode,
}: {
  view: RenderView;
  camera: CameraConfig;
  sensor: SensorProfile;
  sample: SimulationSample;
  target: Target;
  altitudeM: number;
  bodyWidthM: number;
  canvas: RefObject<HTMLCanvasElement | null>;
  host: RefObject<HTMLDivElement | null>;
  status: EngineStatus;
  metrics: CameraMetrics;
  image: GroundImage | null;
  progress: ImageryProgress;
  feed: Feed;
  setFeed: (feed: Feed) => void;
  linkActive: boolean;
  downlink: Downlink;
  inspection: 'fit' | 'native';
  setInspection: (inspection: 'fit' | 'native') => void;
  panoramaProjection: 'perspective' | 'equirectangular';
  setPanoramaProjection: (projection: 'perspective' | 'equirectangular') => void;
  panoramaFov: number;
  setPanoramaFov: (degrees: number) => void;
  quality: 'high' | 'low';
  setQuality: (quality: 'high' | 'low') => void;
  resetSpaceView: () => void;
  spaceMountMode: WideMountDragMode | null;
}) {
  const model = view === 'image' && camera.id === 'main' ? mainImageModel(camera) : undefined;
  const received = feed === 'received' && linkActive;
  const inspectionMode = status.inspectionMode ?? inspection;
  const receivedPanorama = received && downlink.receiver === '360';
  const interactivePanorama = view === 'panorama' && panoramaProjection === 'perspective';
  const nativeSize = view === 'panorama' ? '4096 × 2048' : `${sensor.width} × ${sensor.height}`;
  const coarseRaster = !received && view === 'image' && image && Number.isFinite(metrics.gsdM)
    && image.sourceResolutionM > metrics.gsdM;
  const latitude = `${fmt(Math.abs(target.latitudeDeg), 4)}° ${target.latitudeDeg < 0 ? 'S' : 'N'}`;
  const longitude = `${fmt(Math.abs(target.longitudeDeg), 4)}° ${target.longitudeDeg < 0 ? 'W' : 'E'}`;

  return (
    <section className="image-workspace" aria-label="Viewfinder">
      <div className={`image-stage ${!received && view === 'image' ? 'native' : ''}`} ref={host}>
        <canvas ref={canvas} style={{ visibility: received && (!receivedPanorama || !downlink.receiverHasFrame) ? 'hidden' : undefined }}
          aria-label={view === 'space' ? 'External spacecraft view' : view === 'panorama'
            ? receivedPanorama ? 'Decoded downlink panorama' : 'Stitched 360° panorama' : `${camera.name} simulated sensor image`} />
        {received && <>
          {!receivedPanorama && <canvas ref={downlink.receiverCanvas} className="received-canvas" aria-label="Decoded downlink image" />}
        </>}
        {!status.ready && <div className="engine-message" role={status.failed ? "alert" : "status"}>
          <p>{status.message}</p>
          <small>{status.failed ? "Viewfinder frame failed" : "Preparing the viewfinder"}</small>
        </div>}
      </div>
      <div className="target-heading">
        <span className="target-label">{target.name}</span>
        {!received && model && <small className="image-model-label">{MAIN_IMAGE_MODEL_LABELS[model]}</small>}
      </div>
      <div className="image-tools">
        {view === 'space' && <div className="inspection-buttons"><button onClick={resetSpaceView}>Frame spacecraft</button></div>}
        {linkActive && <div className="source-toggle" aria-label="Image feed">
          <button className={received ? '' : 'active'} aria-pressed={!received} onClick={() => setFeed('source')}>Source</button>
          <button className={received ? 'active' : ''} aria-pressed={received} onClick={() => setFeed('received')}>Received</button>
        </div>}
        {view === 'image' && <div className="inspection-buttons" aria-label="Image scale">
          <button className={!received && inspectionMode === 'fit' ? 'active' : ''} disabled={received}
            title="Fit the complete image" onClick={() => setInspection('fit')}>Fit</button>
          <button className={!received && inspectionMode === 'native' ? 'active' : ''} disabled={received}
            title="One sensor pixel per display pixel" onClick={() => setInspection('native')}>1:1</button>
          {!received && status.inspectionScale !== undefined && <output className="inspection-scale" aria-label="Image zoom"
            title="Display pixels per sensor pixel. Scroll to zoom; drag to pan.">{fmt(status.inspectionScale * 100, 0)}%</output>}
        </div>}
        {view === 'panorama' && <div className="panorama-controls">
          <div className="inspection-buttons" aria-label="360 projection">
            <button className={panoramaProjection === 'equirectangular' ? 'active' : ''}
              aria-pressed={panoramaProjection === 'equirectangular'} onClick={() => setPanoramaProjection('equirectangular')}>Panorama</button>
            <button className={panoramaProjection === 'perspective' ? 'active' : ''}
              aria-pressed={panoramaProjection === 'perspective'} onClick={() => setPanoramaProjection('perspective')}>Look around</button>
          </div>
          {interactivePanorama && <label className="view-angle" title="Viewer vertical field of view; does not change the camera lenses">
            <span>{fmt(panoramaFov, 0)}°</span>
            <input aria-label="360 view angle" aria-valuetext={`${fmt(panoramaFov, 0)} degrees vertical`} type="range"
              min="30" max="120" step="1" value={panoramaFov} onChange={event => setPanoramaFov(Number(event.target.value))} />
          </label>}
        </div>}
        <details className="image-info" onKeyDown={event => {
          if (event.key === 'Escape') event.currentTarget.open = false;
        }}>
          <summary aria-label="Image information" title="Image information"><Icon name="info" size={17} /></summary>
          <div className="image-information">
            <h2>{received ? 'Received image' : view === 'space' ? 'Scene information' : 'Image information'}</h2>
            {received ? <ReceiverCaption downlink={downlink} /> : <dl>
              <div><dt>Recording</dt><dd>{nativeSize} px</dd></div>
              {view === 'image' && <>
              <div><dt>Entrance pupil</dt><dd>{fmt(metrics.apertureMm, 1)} mm</dd></div>
              <div><dt>Center GSD</dt><dd>{fmt(metrics.gsdM, 2)} m/px</dd></div>
              <div><dt>Field of view</dt><dd>{fmt(metrics.horizontalFovDeg, 2)} × {fmt(metrics.verticalFovDeg, 2)}°</dd></div>
              <div><dt>Footprint</dt><dd>{fmt(metrics.footprintWidthM / 1000, 1)} × {fmt(metrics.footprintHeightM / 1000, 1)} km</dd></div>
              <div><dt>Airy diameter</dt><dd>{fmt(metrics.airyDiameterPx, 2)} px</dd></div>
              <div><dt>Center smear</dt><dd>{fmt(metrics.smearPx, 2)} px</dd></div>
              </>}
            </dl>}
            <dl>
              <div><dt>Altitude</dt><dd>{fmt(altitudeM / 1000, 0)} km</dd></div>
              <div><dt>Inclination</dt><dd>{fmt(sample.inclinationDeg, 2)}°</dd></div>
              <div><dt>Ground Sun</dt><dd>{fmt(sample.sunElevationDeg, 1)}°</dd></div>
              <div><dt>Time</dt><dd>{sample.epochISO.slice(11, 19)} UTC</dd></div>
            </dl>
            <p>{latitude}, {longitude}</p>
            {!received && view === 'image' && (metrics.apertureMm > camera.housingDiameterMm || metrics.apertureMm > bodyWidthM * 1000) && <p>
              The {fmt(metrics.apertureMm, 1)} mm entrance pupil (focal length ÷ f-number)
              exceeds {metrics.apertureMm > camera.housingDiameterMm
                ? `the ${fmt(camera.housingDiameterMm, 1)} mm lens housing`
                : `the ${fmt(bodyWidthM * 1000, 0)} mm spacecraft width`}.
              Housing dimensions are provisional and editable in Spacecraft settings; optical packaging is not modeled.
            </p>}
            {coarseRaster && <p className="raster-warning">
              Raster spacing of {fmt(image.sourceResolutionM, 1)} m exceeds the {fmt(metrics.gsdM, 2)} m center GSD.
              The source cannot resolve sensor-scale detail.
            </p>}
            <p title={progress.message}>
              {view === 'space' ? 'Earth imagery from NASA MODIS and Solar System Scope. Cloud imagery from NASA Goddard.'
                : progress.state === 'loading' ? 'Retrieving aerial detail…'
                  : (image?.attribution ?? 'Solar System Scope / NASA Goddard')}
              {view !== 'space' && image && ` · ${fmt(image.sourceResolutionM, 1)} m raster`}
            </p>
            {progress.state === 'error' && view !== 'space' && <p>Detail unavailable; retained the loaded imagery.</p>}
            {!received && (view !== 'image' || camera.id !== 'main' || model === 'pass') && sample.sunElevationDeg < 6 && <p>Near Stanford, city lights use a NASA ISS photograph sampled at about 32 m. Wider coverage uses EOG VIIRS data from T. Hengl. Night brightness is illustrative.</p>}
            {view === 'image' && <p>Aerial coverage blends over dated satellite imagery. Source detail varies across the frame.</p>}
            {view === 'panorama' && <p>The viewer looks into a 360° image. Export saves a 4096 × 2048 equirectangular PNG; changing the view angle does not change the camera lenses.</p>}
            {!received && <p>{model ? MAIN_LIGHTING_NOTES[model] : 'Sun, cloud and limb lighting are illustrative.'}</p>}
            {view === 'panorama' && <p>The angular stitch does not correct nearby spacecraft parallax.</p>}
            {view === 'space' && <p>Filled FOV guides show nominal lens coverage. Red sectors mark sampled spacecraft obstruction. Green selection and red obstruction guides are excluded from captures.</p>}
            {status.warnings?.length ? <p>{status.warnings.join(' · ')}</p> : null}
            <button className="display-quality" title="Display quality does not change sensor resolution"
              onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
              Display: {quality === 'high' ? 'high quality' : 'economy'}
            </button>
          </div>
        </details>
      </div>
      {view === 'panorama' && interactivePanorama && <span className="image-hint">Drag to look around · Scroll to zoom</span>}
      {!received && view === 'space' && <span className="image-hint">{spaceMountMode
        ? `Drag the selected lens to ${spaceMountMode} · Drag elsewhere to orbit`
        : 'Click a camera to edit · Drag to orbit · Scroll to approach'}</span>}
      {!received && view === 'image' && progress.state !== 'loading' && <span className="image-hint">Scroll to zoom · Drag to pan · Double-click for 1:1</span>}
      {progress.state === 'loading' && view === 'image' && <span className="image-hint" role="status">{progress.message}</span>}
    </section>
  );
}
