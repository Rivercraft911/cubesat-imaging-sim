# Field of View

A CubeSat imaging instrument for Stanford SSI. Explore a Stanford pass, square native IMX676 images, three camera mounts, and a real encode–link–decode video path.

[Open the simulator](https://rivercraft911.github.io/cubesat-imaging-sim/). Checked pushes to `main` deploy automatically to GitHub Pages.

```sh
npm ci --legacy-peer-deps
npm run dev
```

Open `http://127.0.0.1:5174` in a WebGPU browser. Node 22.12+ or 24 is recommended. `npm run check` runs numerical/transport tests; `npm run build` checks types and builds the app. Three.js is pinned to r184 for the current Takram atmosphere API.

Choose a lens, then scrub the Stanford pass. **Settings → Orbit** changes altitude, lateral miss distance, date, local solar node time and pointing. **Spacecraft** positions the three cameras and angles the linked wide-camera pair. Click a camera in Space to edit it. Space view shows their FOV guides; drag the focal-length control to update them. Left-drag orbits freely, right-drag pans, and **Frame spacecraft** resets the view. Scroll over the image to zoom around the pointer, drag to pan, or double-click for **1:1** native pixels. **Fit** restores the complete frame. In **360°**, **Look around** is the default; **Panorama** shows the whole transport projection. The linked wide mounts have an **Extra stand-off** slider for clearance studies. The scenario menu saves or loads a study. **Export image** writes native PNG pixels. **Live link → Start live link** enables the encoder and receiver; capture then advances at real time. Switch **Source / Received** to compare, or reopen **Link running** to interrupt or stop it.

`src/sim` holds pure orbit/optics models; `src/render` owns WebGPU; `src/imagery` loads and caches aerial imagery; `src/downlink` owns codecs and bounded transport queues; `src/app` connects them. Add sensors in `sim/catalog.ts`, projections in `sim/camera.ts` and `render/projection.ts`.

The image view uses daylight aerial mosaics on a WGS 84 ellipsoid. It predicts geometry and approximate optical blur, not calibrated night exposure, shot noise, terrain relief or measured lens performance. A terminator orbit can see a dark target. The main camera is fixed to the panel-opening face; target imaging rotates the whole spacecraft away from Sun pointing. Two fisheyes do not guarantee unobstructed 360° coverage. [Model assumptions](docs/models.md) and [asset credits](public/assets/NOTICE.md) are part of the instrument.
