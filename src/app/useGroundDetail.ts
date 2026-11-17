import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeMetrics, type Scenario } from "../sim";
import type { GroundImage } from "../render";
import { contains, shotBounds, type Bounds } from "../imagery/bounds";
import { needsAerial } from "../imagery/lod";
import { DetailLoader } from "../imagery/detail-loader";
import type { ImageryProgress } from "../imagery/provider";

// Warm the prepared coverage used for a typical telephoto change.
const PREFETCH_FOCAL_LENGTH_MM = 100;

/** Reconcile current coverage immediately on optical edits, then continue useful
 * requests through playback. A fixed source grid replaces arbitrary time bins. */
export function useGroundDetail(
  scenario: Scenario,
  timeS: number,
  fine: GroundImage | null,
  base: GroundImage | null,
) {
  const [detail, setDetail] = useState<GroundImage | null>(null);
  const [progress, setProgress] = useState<ImageryProgress>({
    state: "preview",
    message: "Opening satellite imagery",
  });
  const latest = useRef({ scenario, timeS, fine, base });
  latest.current = { scenario, timeS, fine, base };
  const reconcile = useRef<(changed?: boolean) => void>(() => {});
  const track = useRef<() => void>(() => {});
  const prefetch = useRef<() => void>(() => {});
  const geometryKey = useMemo(() => {
    const camera = scenario.cameras.find((c) => c.id === "main")!;
    return JSON.stringify([
      scenario.target,
      scenario.altitudeM,
      scenario.passOffsetKm,
      scenario.epochISO,
      scenario.ltanHours,
      scenario.ascending,
      scenario.pointing,
      scenario.offNadirDeg,
      scenario.rollDeg,
      camera.sensorId,
      camera.lens.focalLengthMm,
      camera.lens.projection,
      camera.lens.maxFovDeg,
      camera.lens.imageCircleMm,
      camera.positionBodyM,
      camera.yawDeg,
      camera.pitchDeg,
      camera.rollDeg,
      scenario.customSensor,
    ]);
  }, [scenario]);

  useEffect(() => {
    const loader = new DetailLoader(setDetail, (value) =>
      setProgress((previous) =>
        previous.state === value.state &&
        previous.message === value.message &&
        previous.resolutionM === value.resolutionM
          ? previous
          : value,
      ),
    );
    let geometry: {
      scenario: Scenario;
      timeS: number;
      gsdM: number;
      bounds: Bounds;
    } | undefined;
    const view = () => {
      const { scenario: live, timeS: frameTime, fine, base } = latest.current;
      const regional = fine?.image.width
        ? fine
        : base?.image.width
          ? base
          : null;
      if (!regional) return;
      // Track, reconcile and poll all read the same geometry between frames.
      if (geometry?.scenario !== live || geometry.timeS !== frameTime) {
        geometry = {
          scenario: live,
          timeS: frameTime,
          gsdM: computeMetrics(live, "main", frameTime).gsdM,
          bounds: shotBounds(live, frameTime),
        };
      }
      const { bounds, gsdM } = geometry;
      const satellite = contains(regional.boundsMercator, bounds)
        ? regional
        : base?.image.width
          ? base
          : regional;
      return {
        bounds,
        satellite,
        latitudeDeg: live.target.latitudeDeg,
        desiredPixelM: Math.max(0.6, gsdM / 1.5),
        sensorSpacingM: gsdM,
        aerial: needsAerial(
          gsdM,
          regional.sourceResolutionM,
          loader.hasAerial(bounds),
        ),
      };
    };
    const tick = (changed = false) => {
      const current = view();
      if (current) loader.update(current, changed);
    };
    reconcile.current = tick;
    track.current = () => {
      const current = view();
      if (current) loader.track(current);
    };
    prefetch.current = () => {
      const { scenario: live, timeS: frameTime } = latest.current;
      const main = live.cameras.find((item) => item.id === "main")!;
      if (main.lens.focalLengthMm >= PREFETCH_FOCAL_LENGTH_MM) return;
      const zoomed = {
        ...live,
        cameras: live.cameras.map((item) =>
          item === main
            ? {
                ...main,
                lens: { ...main.lens, focalLengthMm: PREFETCH_FOCAL_LENGTH_MM },
              }
            : item,
        ),
      };
      const { gsdM } = computeMetrics(zoomed, "main", frameTime);
      loader.prefetch(shotBounds(zoomed, frameTime), gsdM);
    };
    tick();
    const poll = setInterval(tick, 350);
    return () => {
      reconcile.current = () => {};
      track.current = () => {};
      prefetch.current = () => {};
      clearInterval(poll);
      loader.dispose();
    };
  }, []);
  // Playback and seeking can leave the current raster between network polls.
  useLayoutEffect(() => {
    track.current();
  }, [timeS, geometryKey, fine, base]);
  useEffect(() => {
    reconcile.current();
  }, [fine, base]);
  useEffect(() => {
    prefetch.current();
    reconcile.current(true);
  }, [geometryKey]);
  return { detail, progress };
}
