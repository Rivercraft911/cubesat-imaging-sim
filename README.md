# Field of View

A CubeSat imaging instrument for Stanford SSI. Explore a Stanford pass, square native IMX676 images, three camera mounts, and a real encode–link–decode video path.

[Open the simulator](https://rivercraft911.github.io/cubesat-imaging-sim/). Checked pushes to `main` deploy automatically to GitHub Pages.

```sh
npm ci --legacy-peer-deps
npm run dev
```

Open `http://127.0.0.1:5174` in a WebGPU browser. Node 22.12+ or 24 is recommended. `npm run check` runs numerical/transport tests; `npm run build` checks types and builds the app. Three.js is pinned to r184 for the current Takram atmosphere API.

Choose a lens, then scrub the Stanford pass. The opening scene follows the terminator at 550 km. **Compare lenses** freezes one pass instant and marks Building 200 in the Main Quad. Switch between **Source** and **Received** at 1:1 to inspect the two lenses. On narrow screens, open **Compare lenses** from the scenario menu. Select **Settings → Orbit → Stanford daylight overhead** to compare with local solar noon. **Settings → Orbit** changes altitude, lateral miss distance, date, local solar node time and pointing. **Spacecraft** positions the three cameras and angles the linked wide-camera pair. In Space, click either fisheye, choose **Move** or **Aim**, then drag the lens or its settings pad. The opposite mount follows. Arrow keys on the pad nudge by 1 mm or 1°, and Shift increases the step to 5. Space view shows their FOV guides; drag the focal-length control to update them. Left-drag orbits freely, right-drag pans, and **Frame spacecraft** resets the view. Scroll over the image to zoom around the pointer, drag to pan, or double-click for **1:1** native pixels. **Fit** restores the complete frame. In **360°**, **Look around** is the default; **Panorama** shows the whole transport projection. The linked wide mounts have an **Extra stand-off** slider for clearance studies. The scenario menu saves or loads a study. **Export image** writes native PNG pixels. **Live link → Start live link** enables the encoder and receiver; capture then advances at real time. Switch **Source / Received** to compare, or reopen **Link running** to interrupt or stop it.

While receiving, click the rate readout to tune **Bandwidth**, **Data throughput**, **ModCod**, and the quality limit. Bandwidth and throughput are linked. **Adapt quality to link** selects 144p–2160p within that limit; turn it off to choose an encoded height directly. Settings apply live. The readout reports received payload, not the configured link capacity. Source images remain full resolution.

`src/sim` holds pure orbit/optics models; `src/render` owns WebGPU; `src/imagery` loads and caches aerial imagery; `src/downlink` owns codecs and bounded transport queues; `src/app` connects them. Add sensors in `sim/catalog.ts`, projections in `sim/camera.ts` and `render/projection.ts`.

Main and 360° use the same pass lighting over the WGS 84 ellipsoid. Terrain comes from daylight mosaics, and city lights come from a separate night composite. **Settings → Camera → Main image model** also offers the original daylight reference and a twilight exposure study with adjustable sensitivity, diffuse light and noise. Exposure-study defaults are illustrative. Flight exposure and lens performance require bench calibration. A terminator orbit can see a dark target. The main camera is fixed to the panel-opening face; target imaging rotates the whole spacecraft away from Sun pointing. Two fisheyes do not guarantee unobstructed 360° coverage. [Model assumptions](docs/models.md) and [asset credits](public/assets/NOTICE.md) are part of the instrument.
