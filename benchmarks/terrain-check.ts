// Start Vite and open /benchmarks/terrain-check.html in a WebGPU browser.
// Exercise the same WGSL and packed, linearly filtered height format as the camera.
import { bayHeightWGSL, bayIntersectionWGSL } from '../src/render/bay-terrain';
import { BAY_ELEVATION as dem } from '../src/data/bay-elevation';

async function checkTerrain() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  try {
    const module = device.createShaderModule({ code: bayHeightWGSL + bayIntersectionWGSL + `
      @group(0) @binding(0) var grid: texture_2d<f32>;
      @group(0) @binding(1) var linearSampler: sampler;
      @group(0) @binding(2) var<storage,read_write> answer: array<vec2f>;
      @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
        let longitude = array<f32,6>(-122.0,-122.0,-126.0,-122.8,-121.5,-122.0);
        let geo = vec2f(longitude[id.x],37.5);
        let l = radians(geo);
        let normal = vec3f(cos(l.x)*cos(l.y),sin(l.x)*cos(l.y),sin(l.y));
        let foot = vec3f(normal.xy,0.9933056200098587*normal.z);
        let east = vec3f(-sin(l.x),cos(l.x),0.0);
        let ray = select(normalize(east-normal), -normal, id.x == 1u);
        let hit = vec4f(foot,select(650000.0,0.0,id.x == 5u));
        answer[id.x] = bayIntersection(hit,ray,geo,grid,linearSampler);
      }` });
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto', compute: { module, entryPoint: 'main' },
    });
    const grid = device.createTexture({
      size: [dem.width, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const pixels = new Uint8Array(dem.width * 4);
    for (let i = 0; i < dem.width; i++) {
      const lon = dem.west + (i + 0.5) * (dem.east - dem.west) / dem.width;
      const plateau = lon > -122.2 && lon < -121.9;
      const ridge = lon > -121.5055 && lon < -121.5015;
      const height = plateau || ridge ? 640 : 0;
      pixels.set([height >> 8, height & 255, 0, 255], i * 4);
    }
    device.queue.writeTexture({ texture: grid }, pixels, { bytesPerRow: dem.width * 4 }, [dem.width, 1]);
    const output = device.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: grid.createView() },
      { binding: 1, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) },
      { binding: 2, resource: { buffer: output } },
    ] });
    const commands = device.createCommandEncoder();
    const pass = commands.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(6);
    pass.end();
    commands.copyBufferToBuffer(output, 0, readback, 0, 48);
    device.queue.submit([commands.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const [oblique, h1, nadir, h2, outside, h3, sea, h4, ridge, h5, miss, h6] =
      new Float32Array(readback.getMappedRange());
    const checks = {
      'Oblique plateau, 640 m high': Math.abs(h1 - 640) < 0.05 && Math.abs(oblique - 640 * Math.SQRT2) < 0.1,
      'Nadir plateau, 640 m high': Math.abs(nadir - 640) < 0.05 && Math.abs(h2 - 640) < 0.05,
      'Outside the raster': outside === 0 && h3 === 0,
      'Unobstructed open water': sea === 0 && h4 === 0,
      'Ridge in front of water': ridge > 300 && ridge < 910 && h5 > 200 && h5 <= 640,
      'Earth miss': miss === 0 && h6 === 0,
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok);
    if (failed.length) throw new Error(failed.map(([name]) => name).join(', '));
    return Object.keys(checks).map(name => 'PASS  ' + name).join('\n');
  } finally {
    device.destroy();
  }
}
const report = document.querySelector('pre')!;
checkTerrain().then(message => { report.textContent = message; })
  .catch(error => { report.textContent = 'FAIL  ' + error; throw error; });
