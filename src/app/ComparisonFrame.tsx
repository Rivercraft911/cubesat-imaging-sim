import { useEffect, useRef } from 'react';

type Props = {
  image: ImageBitmap | HTMLCanvasElement;
  point: [number, number] | null;
  fit: boolean;
  label: string;
};

/** Keep annotations on the viewfinder canvases, outside the camera and codec. */
export function ComparisonFrame({ image, point, fit, label }: Props) {
  const overview = useRef<HTMLCanvasElement>(null);
  const crop = useRef<HTMLCanvasElement>(null);
  const x = point?.[0] ?? image.width / 2;
  const y = point?.[1] ?? image.height / 2;
  useEffect(() => {
    const detail = crop.current!;
    const full = overview.current!;
    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [detail, full]) {
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      }
      const left = Math.round(x - detail.width / 2);
      const top = Math.round(y - detail.height / 2);
      const context = detail.getContext('2d')!;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, -left, -top);
      const ctx = full.getContext('2d')!;
      const scale = Math.min(full.width / image.width, full.height / image.height);
      const dx = (full.width - image.width * scale) / 2;
      const dy = (full.height - image.height * scale) / 2;
      ctx.drawImage(image, dx, dy, image.width * scale, image.height * scale);
      ctx.lineWidth = dpr;
      ctx.strokeStyle = '#fff7df';
      ctx.shadowColor = '#161410';
      ctx.shadowBlur = 2 * dpr;
      ctx.strokeRect(dx + left * scale, dy + top * scale, detail.width * scale, detail.height * scale);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(detail);
    observer.observe(full);
    window.addEventListener('resize', paint);
    paint();
    return () => { observer.disconnect(); window.removeEventListener('resize', paint); };
  }, [image, x, y, fit]);
  return <div className={`comparison-photo ${fit ? 'fit' : ''}`}>
    <canvas className="comparison-crop" ref={crop} aria-label={`${label}, one image pixel per display pixel`} />
    <canvas className="comparison-overview" ref={overview} aria-label={`${label}, full frame with crop outline`} />
    {!fit && point && <i className="comparison-reticle" aria-hidden="true" />}
  </div>;
}
