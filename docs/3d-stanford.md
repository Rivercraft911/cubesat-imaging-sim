# Bay Area relief

**Settings → Orbit → Ground surface** switches between USGS terrain and the reference ellipsoid at the current pass time. New passes open with terrain. Saved scenarios from before this option open on the ellipsoid.

The elevation grid covers 36.55–38.45° N and 123.1–120.8° W, including Stanford, the Santa Cruz Mountains and Mount Diablo. Its 1,536 × 1,792 samples are about 132 × 118 m apart at the center. Mapped marine water sits at zero. NAVD88 heights are treated as relief above the simulator’s sea surface. The model tapers height over 0.04° at each boundary. [USGS source, processing and checksums](../public/assets/NOTICE.md)

**In the camera**, each ground ray searches the local elevation grid for the first terrain crossing and samples the photograph there. This moves ridgelines against the background during an oblique pass. Both wide eyes and their downlink use the same ground model. The bounded search can miss sub-cell ridges. Relief tapers below 27° local viewing elevation and reaches zero near 17°. **In Space**, a mesh sampled roughly every 1.3–1.6 km supplies the regional silhouette. Camera footprint and GSD readouts still refer to WGS 84. The photographs retain shadows from their acquisitions.

## How much depth is visible?

Take a 550 km pass, 2 µm pixels, and a look angle of 45° from local vertical. In a locally flat approximation, slant range is 778 km. A feature of height `h` moves by `h tan(45°)` along the ground. The along-look pixel footprint is `range × pitch / (f × cos(45°))`.

| Focal length | Nadir sampling | 500 m ridge shift | 30 m roof shift |
|---|---:|---:|---:|
| 25 mm | 44 m/px | 5.7 px | 0.34 px |
| 100 mm | 11 m/px | 23 px | 1.36 px |
| 2,000 mm | 0.55 m/px | 455 px | 27 px |

These are geometric predictions near the optical axis. Local slope, actual slant range, camera motion and source resolution affect what can be distinguished in a frame.

## If we add campus buildings

NOAA’s April 2020 Santa Clara lidar tile **07509825** covers Stanford Building 200 and includes ground, vegetation and building classifications. A 2 × 2 km pilot could compare a ground grid with a 1 m roof-and-canopy surface under the same nadir and oblique shots. Allow **2–5 engineering days** for one GIS/rendering developer to process and register the data, check vertical datums, and test against identifiable roof edges. Roof completeness and alignment with the aerial photography still need inspection. [Tile index and datum](https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/9329/index.html) · [Survey metadata](https://www.fisheries.noaa.gov/inport/item/64802)

One 16-bit, 1 m surface occupies 8 MB for the campus pilot or 20 GB for a 100 × 100 km region, before imagery and additional detail levels. Budget several engineering weeks for a tested, streamed regional surface at that resolution. Textured façades and underpasses would additionally require a mesh and imagery with redistribution and recording rights. [USGS 3DEP products](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) · [Google Map Tiles recording and use conditions](https://developers.google.com/maps/documentation/tile/policies)
