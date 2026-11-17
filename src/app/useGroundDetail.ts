import { useEffect, useRef, useState } from "react";
import { computeMetrics, type Scenario } from "../sim";
import type { GroundImage } from "../render";
import { contains, shotBounds } from "../imagery/bounds";
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
  const prefetch = useRef<() => void>(() => {});
  const camera = scenario.cameras.find((c) => c.id === "main")!;
  const geometryKey = JSON.stringify([
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
    const tick = (changed = false) => {
      const { scenario: live, timeS: frameTime, fine, base } = latest.current;
      const regional = fine?.image.width
        ? fine
        : base?.image.width
          ? base
          : null;
      if (!regional) return;
      const metrics = computeMetrics(live, "main", frameTime);
      const bounds = shotBounds(live, frameTime);
      const satellite = contains(regional.boundsMercator, bounds)
        ? regional
        : base?.image.width
          ? base
          : regional;
      loader.update(
        {
          bounds,
          satellite,
          latitudeDeg: live.target.latitudeDeg,
          desiredPixelM: Math.max(0.6, metrics.gsdM / 1.5),
          aerial: needsAerial(
            metrics.gsdM,
            regional.sourceResolutionM,
            loader.hasAerial(bounds),
          ),
        },
        changed,
      );
    };
    reconcile.current = tick;
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
      loader.prefetch(shotBounds(zoomed, frameTime));
    };
    tick();
    const poll = setInterval(tick, 350);
    return () => {
      reconcile.current = () => {};
      prefetch.current = () => {};
      clearInterval(poll);
      loader.dispose();
    };
  }, []);
  useEffect(() => {
    reconcile.current();
  }, [fine, base]);
  useEffect(() => {
    prefetch.current();
    reconcile.current(true);
  }, [geometryKey]);
  return { detail, progress };
}
