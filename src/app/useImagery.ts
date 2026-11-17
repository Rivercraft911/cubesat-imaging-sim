import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GroundImage, ImagingEngine } from '../render';
import type { Scenario } from '../sim';
import { regionalImage } from '../imagery/provider';
import { useGroundDetail } from './useGroundDetail';

export function useImagery(engine: React.RefObject<ImagingEngine | null>, version: number, scenario: Scenario, timeS: number, frozen = false) {
  const [base, setBase] = useState<GroundImage | null>(null);
  const [fine, setFine] = useState<GroundImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retained = useRef<GroundImage[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    let wideReady = false;
    const keep = (image: GroundImage) => {
      if (abort.signal.aborted) {
        if (image.image instanceof ImageBitmap) image.image.close();
        return false;
      }
      retained.current.push(image);
      return true;
    };
    // Both satellite levels share an acquisition; no unrelated aerial preview.
    regionalImage(abort.signal, 'wide').then(image => {
      if (keep(image)) { wideReady = true; setBase(image); }
    }).catch(() => {});
    regionalImage(abort.signal, 'fine').then(image => {
      if (keep(image)) { setFine(image); if (!wideReady) setBase(image); }
    }).catch(reason => { if (!abort.signal.aborted) setError(String(reason)); });
    return () => {
      abort.abort();
      retained.current.forEach(image => { if (image.image instanceof ImageBitmap) image.image.close(); });
      retained.current = [];
    };
  }, []);
  useEffect(() => { if (!frozen) engine.current?.setBaseGroundImage(base?.image.width ? base : null); }, [version, base, engine, frozen]);
  const { detail, progress } = useGroundDetail(scenario, timeS, fine, base);
  useLayoutEffect(() => { if (!frozen) engine.current?.setGroundImage(detail?.image.width ? detail : null); }, [version, detail, engine, frozen]);
  return {
    image: detail ?? base, baseImage: base,
    progress: error && !base ? { state: 'error' as const, message: error } : progress,
  };
}
