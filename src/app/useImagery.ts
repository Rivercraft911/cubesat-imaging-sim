import { useEffect, useRef, useState } from 'react';
import type { GroundImage, ImagingEngine } from '../render';
import type { Scenario } from '../sim';
import { computeMetrics } from '../sim';
import { openingImage, preparedShot, regionalImage, shotImage } from '../imagery/provider';
import type { ImageryProgress } from '../imagery/provider';
import { contains, shotBounds } from '../imagery/bounds';

const closeImage = (image: GroundImage | null) => {
  if (image?.image instanceof ImageBitmap) image.image.close();
};

export function useImagery(engine: React.RefObject<ImagingEngine | null>, version: number, scenario: Scenario, timeS: number) {
  const [base, setBase] = useState<GroundImage | null>(null);
  const [detail, setDetail] = useState<GroundImage | null>(null);
  const [progress, setProgress] = useState<ImageryProgress>({ state: 'preview', message: 'Opening Bay Area imagery' });
  const current = useRef<GroundImage | null>(null);
  const baseRef = useRef<GroundImage | null>(null);
  const camera = scenario.cameras.find(c => c.id === 'main')!;
  // Binning pass time prevents a network request at every animation frame.
  const regionTime = Math.round(timeS / 30) * 30;
  const key = JSON.stringify([scenario.target, scenario.altitudeM, scenario.passOffsetKm, scenario.epochISO,
    scenario.ltanHours, scenario.ascending, scenario.pointing, scenario.offNadirDeg, scenario.rollDeg,
    camera.sensorId, camera.lens, camera.positionBodyM, scenario.customSensor, regionTime]);

  useEffect(() => {
    const abort = new AbortController();
    let finalBase = false;
    const acceptBase = (value: GroundImage, final: boolean) => {
      if (abort.signal.aborted || (finalBase && !final)) { closeImage(value); return; }
      finalBase ||= final;
      const old = baseRef.current;
      baseRef.current = value; setBase(value);
      if (!current.current) setProgress({ state: final ? 'ready' : 'preview', message: value.attribution, resolutionM: value.sourceResolutionM });
      // Allow the renderer to upload the replacement before releasing the source bitmap.
      setTimeout(() => closeImage(old), 1500);
    };
    openingImage(abort.signal).then(value => acceptBase(value, false)).catch(() => {});
    regionalImage(abort.signal).then(value => acceptBase(value, true)).catch(() => {});
    return () => { abort.abort(); closeImage(baseRef.current); closeImage(current.current); };
  }, []);
  useEffect(() => { engine.current?.setBaseGroundImage(base); }, [version, base, engine]);
  useEffect(() => { engine.current?.setGroundImage(detail); }, [version, detail, engine]);

  useEffect(() => {
    const abort = new AbortController();
    const acceptDetail = (value: GroundImage) => {
      if (abort.signal.aborted) { closeImage(value); return false; }
      const old = current.current; current.current = value; setDetail(value);
      setProgress({ state: 'ready', message: value.attribution, resolutionM: value.sourceResolutionM });
      setTimeout(() => closeImage(old), 1500);
      return true;
    };
    const timer = setTimeout(async () => {
      try {
        const bounds = shotBounds(scenario, regionTime);
        const metrics = computeMetrics(scenario, 'main', regionTime);
        const desired = Math.max(0.6, (Number.isFinite(metrics.gsdM) ? metrics.gsdM : 20) / 1.5);
        // At continental footprints a resampled aerial survey exposes its
        // acquisition strips. Keep the continuous satellite levels instead.
        if (desired >= 100) {
          const old = current.current; current.current = null; setDetail(null);
          setTimeout(() => closeImage(old), 1500);
          setProgress({ state: 'ready', message: 'Regional satellite imagery', resolutionM: 232 });
          return;
        }
        if (current.current && contains(current.current.boundsMercator, bounds) && current.current.sourceResolutionM <= desired * 1.1) return;
        if (baseRef.current && contains(baseRef.current.boundsMercator, bounds) && baseRef.current.sourceResolutionM <= metrics.gsdM) {
          const old = current.current; current.current = null; setDetail(null);
          setTimeout(() => closeImage(old), 1500);
          setProgress({ state: 'ready', message: baseRef.current.attribution, resolutionM: baseRef.current.sourceResolutionM });
          return;
        }
        const prepared = await preparedShot(bounds, abort.signal);
        if (prepared && (!acceptDetail(prepared) || prepared.sourceResolutionM <= desired * 1.15)) return;
        setProgress(p => ({ ...p, state: 'loading', message: 'Loading aerial detail…' }));
        acceptDetail(await shotImage(bounds, desired, scenario.target.latitudeDeg, abort.signal));
      } catch (error) {
        if (!abort.signal.aborted) setProgress(p => ({ ...p, state: 'error', message: `Detail unavailable. ${error instanceof Error ? error.message : 'Regional imagery retained.'}` }));
      }
    }, 700);
    return () => { clearTimeout(timer); abort.abort(); };
  // The key is the exact footprint-affecting portion of the scenario.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base?.id]);
  return { image: detail ?? base, baseImage: base, progress };
}
