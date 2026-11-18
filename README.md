# Field of View

[Open the simulator](https://rivercraft911.github.io/cubesat-imaging-sim/)

Fly a simulated CubeSat over Stanford. Look around through two stitched fisheye cameras, change the main lens, or compare a native sensor frame with the video received over the downlink.

![Daylight pass over Stanford from the stitched fisheye cameras and the nadir-pointing main camera](docs/media/stanford-daylight-pass.webp)

## Run locally

Install dependencies and start the dev server with Node.js 22.12 or newer.

```sh
npm ci --legacy-peer-deps
npm run dev
```

Open [localhost:5174](http://127.0.0.1:5174/) in a WebGPU-capable browser.

The timelapse contains modified Copernicus Sentinel data 2025. [Imagery credits](public/assets/NOTICE.md) · [Model assumptions](docs/models.md)
