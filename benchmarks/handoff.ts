// Run with npm run dev, then open /benchmarks/handoff.html in a WebGPU browser.
import { createImagingEngine } from '../src/render';
import { createDefaultScenario } from '../src/sim';
const button = document.querySelector('button')!;
const report = document.querySelector('pre')!;
button.onclick = async () => {
  button.disabled = true;
  let engine: Awaited<ReturnType<typeof createImagingEngine>> | undefined;
  try {
    const canvas = document.createElement('canvas');
    report.textContent = 'Opening GPU…';
    engine = await createImagingEngine(canvas);
    engine.updateScenario(createDefaultScenario(), 0);
    const context = document.createElement('canvas').getContext('2d', {willReadFrequently:true})!;
    const results = [];
    for (const size of [144, 1080]) {
      context.canvas.width = context.canvas.height = size;
      const durations: number[][] = [[], []];
      let peakDifference = 0;
      for (let i = 0; i < 15; i++) {
        const pts = Math.round(1e6 * i / 15);
        // Prime the same native frame so both routes measure only handoff work.
        await engine.getEncoderCanvas('main',size,size,pts);
        const pixels: Uint8ClampedArray[] = [];
        for (const route of i % 2 ? [0,1] : [1,0]) {
          const start = performance.now();
          const frame = route === 0
            ? new VideoFrame(await engine.getEncoderCanvas('main',size,size,pts), {timestamp:pts})
            : await engine.getEncoderFrame('main',size,size,pts,{timestamp:pts});
          try {
            if (i >= 3) durations[route].push(performance.now() - start);
            context.drawImage(frame,0,0);
            pixels[route] = context.getImageData(0,0,size,size).data;
          } finally { frame.close(); }
        }
        for (let j=0;j<pixels[0].length;j++) peakDifference = Math.max(peakDifference,Math.abs(pixels[0][j]-pixels[1][j]));
      }
      const median = (a:number[]) => { const v=a.sort((x,y)=>x-y);return (v[5]+v[6])/2; };
      results.push({size, framesPerRoute:12, readbackMedianMs:median(durations[0]), frameMedianMs:median(durations[1]), peakRGBADifference:peakDifference});
      report.textContent = JSON.stringify(results,null,2);
    }
  } catch (error) { report.textContent = String(error); }
  finally { engine?.dispose(); button.disabled = false; }
};
