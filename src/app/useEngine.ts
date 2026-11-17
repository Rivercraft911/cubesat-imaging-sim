import { useEffect, useRef, useState } from 'react';
import type { EngineStatus, ImagingEngine } from '../render';

export function useEngine(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  host: React.RefObject<HTMLDivElement | null>,
  onRendererFailure: (message: string) => void,
) {
  const engine = useRef<ImagingEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ ready: false, backend: 'WebGPU', message: 'Preparing optics…' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!canvas.current || !host.current) return;
    let stopped = false;
    let animation = 0;
    let firstFrame = true;
    const element = host.current, canvasElement = canvas.current;
    const resize = () => {
      if (!stopped) engine.current?.resize(element.clientWidth, element.clientHeight, Math.min(devicePixelRatio, 2));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(animation);
      observer.disconnect();
    };
    const fail = (reason: unknown) => {
      if (stopped) return;
      stop();
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error(reason);
      onRendererFailure(message);
    };
    const updateStatus = (next: EngineStatus) => {
      if (stopped) return;
      setStatus(next);
      if (next.ready && firstFrame) {
        firstFrame = false;
        setVersion(v => v + 1);
      }
    };
    async function start() {
      const { createImagingEngine } = await import('../render');
      if (stopped) return;
      const instance = await createImagingEngine(canvasElement, updateStatus, fail);
      if (stopped) { instance.dispose(); return; }
      engine.current = instance;
      resize();
      const tick = () => {
        if (stopped) return;
        try {
          if (!document.hidden) instance.render();
        } catch (error) {
          fail(error);
          return;
        }
        if (!stopped) animation = requestAnimationFrame(tick);
      };
      tick();
    }
    void start().catch(fail);
    return () => {
      stop();
      engine.current?.dispose();
      engine.current = null;
    };
  }, [canvas, host, onRendererFailure]);
  return { engine, status, version };
}
