import { useEffect, useRef, useState } from 'react';
import type { EngineStatus, ImagingEngine } from '../render';

export function useEngine(canvas: React.RefObject<HTMLCanvasElement | null>, host: React.RefObject<HTMLDivElement | null>) {
  const engine = useRef<ImagingEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ ready: false, backend: 'WebGPU', message: 'Preparing optics…' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!canvas.current || !host.current) return;
    let cancelled = false, animation = 0;
    const element = host.current, canvasElement = canvas.current;
    const resize = () => engine.current?.resize(element.clientWidth, element.clientHeight, Math.min(devicePixelRatio, 2));
    const observer = new ResizeObserver(resize); observer.observe(element);
    import('../render').then(({ createImagingEngine }) => {
      if (cancelled) return null;
      return createImagingEngine(canvasElement, s => { if (!cancelled) setStatus(s); });
    }).then(instance => {
      if (!instance) return;
      if (cancelled) { instance.dispose(); return; }
      engine.current = instance; resize(); setVersion(v => v + 1);
      const tick = () => { if (!document.hidden) instance.render(); animation = requestAnimationFrame(tick); };
      tick();
    }).catch(error => { console.error(error); if (!cancelled) setStatus({ ready: false, backend: 'WebGPU', message: String(error.message ?? error) }); });
    return () => { cancelled = true; cancelAnimationFrame(animation); observer.disconnect(); engine.current?.dispose(); engine.current = null; };
  }, [canvas, host]);
  return { engine, status, version };
}
