import { useEffect, useRef, useState } from 'react';
import { computeMetrics, type Scenario } from '../sim';
import type { GroundImage } from '../render';
import { contains, shotBounds, type Bounds } from '../imagery/bounds';
import { needsAerial } from '../imagery/lod';
import { preparedShot, shotImage, type ImageryProgress } from '../imagery/provider';

const close = (image: GroundImage | null) => {
  if (image?.image instanceof ImageBitmap) image.image.close();
};

/** One request at a time. Playback never cancels a load at a time-bin boundary. */
export function useGroundDetail(scenario: Scenario, timeS: number, fine: GroundImage | null, base: GroundImage | null) {
  const [detail, setDetail] = useState<GroundImage | null>(null);
  const [progress, setProgress] = useState<ImageryProgress>({ state: 'preview', message: 'Opening satellite imagery' });
  const current = useRef<GroundImage | null>(null);
  const owned = useRef(new Set<GroundImage>());
  const retired = useRef<GroundImage[]>([]);
  const latest = useRef({ scenario, timeS });
  latest.current = { scenario, timeS };
  const camera = scenario.cameras.find(c => c.id === 'main')!;
  const key = JSON.stringify([scenario.target, scenario.altitudeM, scenario.passOffsetKm, scenario.epochISO,
    scenario.ltanHours, scenario.ascending, scenario.pointing, scenario.offNadirDeg, scenario.rollDeg,
    camera.sensorId, camera.lens, camera.positionBodyM, scenario.customSensor]);

  // Retired sources were synchronously uploaded when they were first published.
  useEffect(() => { retired.current.splice(0).forEach(image => { close(image); owned.current.delete(image); }); }, [detail]);
  useEffect(() => () => { owned.current.forEach(close); owned.current.clear(); }, []);

  useEffect(() => {
    const abort = new AbortController();
    let busy = false, previousRequest = '';
    const publish = (value: GroundImage | null) => {
      if (current.current !== value) {
        if (current.current && owned.current.has(current.current)) retired.current.push(current.current);
        current.current = value; setDetail(value);
      }
      const displayed = value ?? base;
      if (displayed) setProgress(previous => previous.state === 'ready' && previous.message === displayed.attribution ? previous
        : { state: 'ready', message: displayed.attribution, resolutionM: displayed.sourceResolutionM });
    };
    const tick = async () => {
      if (!fine) return;
      const { scenario: live, timeS: frameTime } = latest.current;
      const metrics = computeMetrics(live, 'main', frameTime);
      const aerial = current.current !== fine && current.current !== null;
      if (!needsAerial(metrics.gsdM, fine.sourceResolutionM, aerial)) {
        previousRequest = ''; publish(fine); return;
      }
      if (busy) return;
      const regionTime = Math.round(frameTime / 30) * 30;
      const edges = [-15, 0, 15].map(dt => shotBounds(live, regionTime + dt));
      const bounds: Bounds = [Math.min(...edges.map(b => b[0])), Math.min(...edges.map(b => b[1])),
        Math.max(...edges.map(b => b[2])), Math.max(...edges.map(b => b[3]))];
      const desired = Math.max(0.6, metrics.gsdM / 1.5);
      if (aerial && contains(current.current!.boundsMercator, bounds) && current.current!.sourceResolutionM <= desired * 1.1) return;
      const request = JSON.stringify([bounds.map(Math.round), Math.round(desired * 10)]);
      if (request === previousRequest) return;
      previousRequest = request; busy = true;
      setProgress(p => ({ ...p, state: 'loading', message: 'Loading aerial detail…' }));
      try {
        let image = await preparedShot(bounds, abort.signal);
        if (!image || image.sourceResolutionM > desired * 1.15) {
          close(image);
          image = await shotImage(bounds, desired, live.target.latitudeDeg, abort.signal);
        }
        const now = latest.current;
        const stillUseful = needsAerial(computeMetrics(now.scenario, 'main', now.timeS).gsdM, fine.sourceResolutionM, true);
        if (abort.signal.aborted || !stillUseful) { close(image); return; }
        owned.current.add(image); publish(image);
      } catch (reason) {
        if (!abort.signal.aborted) setProgress(p => ({ ...p, state: 'error', message: `Detail unavailable. ${String(reason)}` }));
      } finally { busy = false; }
    };
    const start = setTimeout(() => { void tick(); }, 250);
    const poll = setInterval(() => { void tick(); }, 700);
    return () => { abort.abort(); clearTimeout(start); clearInterval(poll); };
  }, [key, fine, base]);
  return { detail, progress };
}
