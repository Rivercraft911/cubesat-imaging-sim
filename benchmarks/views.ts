// Start Vite and open /benchmarks/views.html. Timings include GPU completion.
import { createImagingEngine, type GroundImage, type ImagingEngine, type RenderView } from '../src/render';
import { regionalImage } from '../src/imagery/provider';
import { createDefaultScenario, type CameraId } from '../src/sim';
import { applyStanfordPassPreset } from '../src/sim/pass-presets';

const button = document.querySelector('button')!;
const report = document.querySelector('pre')!;

// Observe the first submit in this dedicated page to fence Three's actual queue.
function renderingQueue(engine: ImagingEngine): GPUQueue {
  let queue: GPUQueue | undefined;
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    queue = this;
    return submit.call(this, buffers);
  };
  try { engine.render(); } finally { GPUQueue.prototype.submit = submit; }
  if (!queue) throw new Error('The initial draw did not submit GPU work.');
  return queue;
}

function medianMs(values: number[]) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return Number(((values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2).toFixed(2));
}

button.onclick = async () => {
  button.disabled = true;
  let engine: ImagingEngine | undefined;
  let ground: GroundImage | undefined;
  try {
    report.textContent = 'Preparing WebGPU…';
    engine = await createImagingEngine(document.querySelector('canvas')!);
    engine.resize(960, 720, 1);
    const scenario = applyStanfordPassPreset(createDefaultScenario(), 'terminator');
    ground = await regionalImage(new AbortController().signal);
    engine.setBaseGroundImage(ground);
    const queue = renderingQueue(engine);
    await queue.onSubmittedWorkDone();
    const results = [];
    for (const name of ['Main', 'Wide A', '360°', 'Space', 'Main lens edit', 'Main → Wide B']) {
      const cpu = [], elapsed = [];
      for (let i = 0; i < 30; i++) {
        const time = -120 + i;
        const view: RenderView = name === '360°' ? 'panorama' : name === 'Space' ? 'space' : 'image';
        const id: CameraId = name === 'Wide A' ? 'wideA' : name === 'Main → Wide B' ? 'wideB' : 'main';
        if (name === 'Main → Wide B') {
          engine.updateScenario(scenario, time);
          engine.setView('image', 'main');
          engine.render();
          await queue.onSubmittedWorkDone();
        }
        const start = performance.now();
        if (name === 'Main lens edit') {
          const cameras = scenario.cameras.map(c => c.id === 'main'
            ? { ...c, lens: { ...c.lens, focalLengthMm: i % 2 ? 50 : 25 } } : c);
          engine.updateScenario({ ...scenario, cameras }, 0);
        } else if (name !== 'Main → Wide B') engine.updateScenario(scenario, time);
        engine.setView(view, id);
        engine.render();
        const submitted = performance.now();
        await queue.onSubmittedWorkDone();
        if (i >= 6) {
          cpu.push(submitted - start);
          elapsed.push(performance.now() - start);
        }
      }
      results.push({ workload: name, frames: elapsed.length, cpuMs: medianMs(cpu), throughGpuMs: medianMs(elapsed) });
      report.textContent = JSON.stringify(results, null, 2);
    }
  } catch (error) {
    report.textContent = String(error);
  } finally {
    engine?.dispose();
    if (ground?.image instanceof ImageBitmap) ground.image.close();
    button.disabled = false;
  }
};
