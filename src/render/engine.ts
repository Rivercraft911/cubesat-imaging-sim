import { mainImageModel } from "../sim/exposure";
import { createOpeningScenario } from "../sim/pass-presets";
import * as THREE from "three/webgpu";
import { contains, shotBounds } from "../imagery/bounds";
import { bindSensorCamera, bindPanoramaCameras } from "./camera-bindings";
import { InitializationScope } from "./initialization";
import { loadEarthTextures } from "./earth-textures";
import { createHardwareCapture } from "./hardware-capture";
import { texture, uniform, uv, vec2, vec4, ivec2 } from "three/tsl";
import {
  getSensor,
  cameraPose,
  sampleState,
  computeMetrics,
} from "../sim";
import type { CameraConfig, CameraId, Scenario } from "../sim/types";
import type {
  CaptureOptions,
  GroundImage,
  EngineStatus,
  ImagingEngine,
  RenderView,
} from "./types";
import { makeSensorMaterial } from "./sensor-material";
import { makeStitch } from "./stitch";
import { createOpticsPipeline } from "./native-optics";
import { createCapturePipeline } from "./capture-pipeline";
import { createSpaceContext } from "./space-context";
import { installInspectionControls } from "./inspection-controls";
import { createPanoramaViewer, initialPanoramaDirection } from "./panorama-viewer";
import { createGroundLayers } from "./ground-layers";
import { advanceAerialArrival, aerialArrivalWeight, isAerialImage, settledAerialWeight } from "./aerial-blend";
import { makePlanetSurface } from "./planet-surface";
import { validateNativeAllocation } from "./allocation";
import { installGpuDiagnostics } from "./gpu-diagnostics";
import { createCloudLayer } from "./cloud-layer";
export type * from "./types";

function makeTarget(w: number, h: number) {
  const rt = new THREE.RenderTarget(w, h, { depthBuffer: false });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
}

export async function createImagingEngine(
  canvas: HTMLCanvasElement,
  onStatus?: (s: EngineStatus) => void,
  onGpuFailure?: (message: string) => void,
): Promise<ImagingEngine> {
  onStatus?.({
    ready: false,
    backend: "WebGPU",
    message: "Preparing GPU and atmosphere…",
  });
  const initialization = new InitializationScope();
  const renderer = initialization.own(
    new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
      forceWebGL: false,
    }),
  );
  let disposed = false;
  let gpuFailure: Error | undefined;
  const failGpu = (message: string) => {
    if (disposed || gpuFailure) return;
    gpuFailure = new Error(message);
    onGpuFailure?.(message);
  };
  const onDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    if (disposed || gpuFailure || info.reason === "destroyed") return;
    onDeviceLost(info);
    failGpu(`${info.api} device lost: ${info.message}`);
  };
  try {
    await renderer.init();
    if (gpuFailure) throw gpuFailure;
    if (
      !(
        "isWebGPUBackend" in renderer.backend &&
        renderer.backend.isWebGPUBackend
      )
    ) {
      throw new Error(
        "This simulator requires WebGPU. Open it in a browser with WebGPU enabled.",
      );
    }
    const removeGpuDiagnostics = installGpuDiagnostics(renderer, failGpu);
    initialization.defer(removeGpuDiagnostics);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const earthTextures = initialization.own(await loadEarthTextures());
    if (gpuFailure) throw gpuFailure;
    const {
      day,
      night,
      cloud,
      western,
      westernNight,
      stanfordNight,
      regionalCloud,
      fallback,
    } = earthTextures;
    const cloudLayer = createCloudLayer(cloud, regionalCloud);
    let scenario = createOpeningScenario(),
      sample = sampleState(scenario),
      timeS = 0;
    let view: RenderView = "image",
      cameraId: CameraId = "main",
      quality: "high" | "low" = "high";
    let width = 800,
      height = 600,
      dpr = 1,
      hasDrawn = false,
      dirty = true;
    let spaceVisited = false,
      panoramaVisited = false;
    let currentDetail: GroundImage | null = null;
    let currentBase: GroundImage | null = null;
    let aerialLastUpdatedMs = 0;
    let aerialProgressMs = 0;
    let aerialArrivalStartWeight = 0;
    let blendGeometry: { scenario: Scenario; timeS: number; detail: GroundImage; base: GroundImage | null; weight: number } | null = null;
    function updateGroundWeight(settled = false) {
      let weight = 1;
      if (currentDetail && isAerialImage(currentDetail.id)) {
        if (!blendGeometry || blendGeometry.scenario !== scenario || blendGeometry.timeS !== timeS || blendGeometry.detail !== currentDetail || blendGeometry.base !== currentBase) {
          const footprint = shotBounds(scenario, timeS);
          const satelliteSpacing = currentBase && contains(currentBase.boundsMercator, footprint)
            ? currentBase.sourceResolutionM : undefined;
          blendGeometry = { scenario, timeS, detail: currentDetail, base: currentBase,
            weight: settledAerialWeight(currentDetail.boundsMercator, footprint, computeMetrics(scenario, "main", timeS).gsdM, satelliteSpacing) };
        }
        const support = blendGeometry.weight;
        if (!settled) {
          const now = performance.now();
          aerialProgressMs = advanceAerialArrival(aerialProgressMs, now - aerialLastUpdatedMs);
          aerialLastUpdatedMs = now;
        }
        const arrival = aerialArrivalWeight(aerialProgressMs);
        // Keep continuity across NAIP replacements without retaining another texture.
        weight = settled ? support : Math.min(support, aerialArrivalStartWeight + (support - aerialArrivalStartWeight) * arrival);
      }
      if (sensor.u.groundWeight.value !== weight) {
        sensor.u.groundWeight.value = weight;
        dirty = true;
      }
    }
    let sceneRevision = 0,
      groundRevision = 0;
    const space = initialization.own(
      await createSpaceContext(
        renderer,
        canvas,
        scenario,
        sample,
        day,
        night,
        western,
        westernNight,
        stanfordNight,
        cloudLayer,
      ),
    );
    if (gpuFailure) throw gpuFailure;
    const { shipScene, spaceCamera, controls } = space;
    const hardware = initialization.own(
      createHardwareCapture(renderer, shipScene),
    );
    const sensor = makeSensorMaterial(
      day,
      fallback,
      night,
      cloud,
      hardware.front,
      western,
      westernNight,
      stanfordNight,
      cloudLayer,
      space.sensorAerial,
    );
    initialization.defer(() => {
      sensor.referenceMaterial.dispose();
      sensor.passMaterial.dispose();
    });
    const groundLayers = initialization.own(
      createGroundLayers(
        sensor,
        fallback,
        (texture) => {
          const device = (renderer.backend as unknown as { device: GPUDevice })
            .device;
          void device.queue.onSubmittedWorkDone().then(
            () => texture.dispose(),
            () => texture.dispose(),
          );
        },
        (texture) => renderer.initTexture(texture),
      ),
    );
    space.setSurface(makePlanetSurface(day, western, sensor));
    const quadScene = new THREE.Scene(),
      quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(
      initialization.own(new THREE.PlaneGeometry(2, 2)),
      sensor.referenceMaterial,
    );
    quad.frustumCulled = false;
    quadScene.add(quad);
    const frontTarget = initialization.own(makeTarget(1, 1)),
      rearTarget = initialization.own(makeTarget(1, 1)),
      mainTarget = initialization.own(makeTarget(1, 1));
    const nativeTargets = {
      main: mainTarget,
      wideA: frontTarget,
      wideB: rearTarget,
    };
    const nativeKeys = new Map<CameraId, string>();
    const presentationTexture = texture(mainTarget.texture),
      presentationCrop = uniform(new THREE.Vector4(0, 0, 1, 1)),
      presentationSize = uniform(new THREE.Vector2(1, 1)),
      presentationNearest = uniform(0);
    const presentation = initialization.own(
      new THREE.MeshBasicNodeMaterial({
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const presentationUV = uv()
      .mul(presentationCrop.zw)
      .add(presentationCrop.xy);
    const insideImage = presentationUV.x
      .greaterThanEqual(0)
      .and(presentationUV.x.lessThan(1))
      .and(presentationUV.y.greaterThanEqual(0))
      .and(presentationUV.y.lessThan(1));
    const pixel = ivec2(
      presentationUV
        .mul(presentationSize)
        .floor()
        .clamp(vec2(0), presentationSize.sub(1)),
    );
    const presented = presentationNearest
      .greaterThan(0.5)
      .select(
        presentationTexture.load(pixel),
        presentationTexture.sample(presentationUV),
      );
    presentation.colorNode = insideImage.select(presented, vec4(0, 0, 0, 1));
    const optics = initialization.own(
      createOpticsPipeline(renderer, quadScene, quadCamera, quad),
    );
    const stitch = makeStitch(frontTarget.texture, rearTarget.texture);
    initialization.defer(() => stitch.material.dispose());
    const panoramaViewer = initialization.own(
      createPanoramaViewer(
        canvas,
        () => view === "panorama",
        () => {
          dirty = true;
        },
      ),
    );
    let warnings = new Set<string>();
    function config(id: CameraId) {
      return scenario.cameras.find((c) => c.id === id)!;
    }
    function sensorInfo(c: CameraConfig) {
      return getSensor(c.sensorId, scenario.customSensor);
    }
    let hardwareGeometryRevision = 0;
    function updateWorld() {
      if (space.updateWorld(scenario, sample)) hardwareGeometryRevision++;
    }
    function configureSensor(id: CameraId) {
      const c = config(id),
        s = sensorInfo(c),
        pose = cameraPose(sample, c);
      space.setSensorPose(pose, sample);
      bindSensorCamera(
        sensor,
        sample,
        c,
        s,
        id === "wideB" ? hardware.rear : hardware.front,
      );
      sensor.u.crop.value.set(0, 0, s.width, s.height);
      return s;
    }
    function configureStitch() {
      bindPanoramaCameras(stitch, scenario, sample);
    }
    function renderSensorTo(id: CameraId, target: THREE.RenderTarget) {
      const s = configureSensor(id);
      const camera = config(id);
      const passLighting = id !== "main" || mainImageModel(camera) === "pass";
      optics.render({
        material: passLighting ? sensor.passMaterial : sensor.referenceMaterial,
        crop: sensor.u.crop.value,
        scenario,
        camera,
        sensor: s,
        sample,
        timeS,
        target,
        warnings,
      });
    }

    function ensureNative(id: CameraId) {
      const key = `${sceneRevision}:${groundRevision}:${sample.timeS}:${sensor.u.groundWeight.value}`;
      const target = nativeTargets[id];
      if (nativeKeys.get(id) === key) return target;
      const s = sensorInfo(config(id));
      const device = (renderer.backend as unknown as { device: GPUDevice })
        .device;
      const limit = device.limits.maxTextureDimension2D;
      validateNativeAllocation(s.width, s.height, limit);
      target.texture.generateMipmaps = true;
      target.texture.minFilter = THREE.LinearMipmapLinearFilter;
      target.setSize(s.width, s.height);
      hardware.update(config(id), sample, hardwareGeometryRevision);
      renderSensorTo(id, target);
      nativeKeys.set(id, key);
      return target;
    }
    function presentNative(
      id: CameraId,
      crop?: THREE.Vector4,
      nearest = false,
    ) {
      const source = ensureNative(id);
      presentationTexture.value = source.texture;
      presentationSize.value.set(source.width, source.height);
      presentationNearest.value = nearest ? 1 : 0;
      const c = crop ?? new THREE.Vector4(0, 0, source.width, source.height);
      presentationCrop.value.set(
        c.x / source.width,
        1 - (c.y + c.w) / source.height,
        c.z / source.width,
        c.w / source.height,
      );
      quad.material = presentation;
    }
    function renderPanorama() {
      stitch.u.perspective.value = 0;
      ensureNative("wideA");
      ensureNative("wideB");
      configureStitch();
      stitch.a.value = frontTarget.texture;
      stitch.b.value = rearTarget.texture;
      quad.material = stitch.material;
    }
    function setDisplayViewport(aspect: number) {
      const actual = width / height;
      let w = width,
        h = height;
      if (actual > aspect) w = height * aspect;
      else h = width / aspect;
      renderer.setViewport((width - w) / 2, (height - h) / 2, w, h);
    }
    function draw() {
      if (disposed || captures.busy) return;
      const started = performance.now();
      updateWorld();
      renderer.toneMapping =
        view === "space" ? THREE.AgXToneMapping : THREE.NoToneMapping;
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, width, height);
      renderer.setClearColor(0x060708, 1);
      renderer.clear();
      if (view === "space") {
        space.render(width, height);
      } else {
        if (view === "panorama") {
          if (panoramaViewer.hasReceived)
            quad.material = panoramaViewer.material;
          else renderPanorama();
          panoramaViewer.configureDisplay(width / height);
          stitch.u.perspective.value = panoramaViewer.mode.value;
          stitch.u.view.value.copy(panoramaViewer.look.value);
          renderer.setRenderTarget(null);
          setDisplayViewport(
            panoramaViewer.projection === "perspective" ? width / height : 2,
          );
        } else {
          const crop = new THREE.Vector4(...inspectionControls.crop);
          presentNative(cameraId, crop, inspectionControls.state.scale >= 1);
          renderer.setRenderTarget(null);
          setDisplayViewport(width / height);
        }
        renderer.render(quadScene, quadCamera);
      }
      renderer.setViewport(0, 0, width, height);
      dirty = false;
      hasDrawn = true;
      onStatus?.({
        ready: true,
        backend: "WebGPU",
        warnings: [...warnings],
        renderMs: performance.now() - started,
        inspectionMode: inspectionControls.state.mode,
        inspectionScale: inspectionControls.state.scale,
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
      });
    }
    const captures = initialization.own(
      createCapturePipeline({
        renderer,
        quadScene,
        quadCamera,
        quad,
        stitch,
        frontTarget,
        rearTarget,
        config,
        sensorInfo,
        configureStitch,
        changed: () => {
          dirty = true;
        },
        sources: { panorama: renderPanorama, native: presentNative },
        withTime(pts, drawSource, study) {
          if (study?.groundRevision !== undefined && study.groundRevision !== groundRevision) {
            throw new Error("Ground imagery changed during capture. Capture both lenses again.");
          }
          const detailEnabled = sensor.u.hasGround.value;
          const displayGroundWeight = sensor.u.groundWeight.value;
          const displayScenario = scenario;
          const displaySample = sample,
            displayTime = timeS;
          try {
            if (study) {
              scenario = study.scenario;
              timeS = study.timeS;
              sample = sampleState(scenario, timeS);
              // A telephoto crop can be resident while a wider lens is being compared.
              if (currentDetail && !contains(currentDetail.boundsMercator, shotBounds(scenario, timeS))) {
                sensor.u.hasGround.value = 0;
              }
              sceneRevision++;
            } else if (pts !== undefined) {
              timeS = pts / 1e6;
              sample = sampleState(scenario, timeS);
            }
            // Live PTS frames follow the viewfinder fade. Still exports and
            // frozen studies use only deterministic footprint/GSD support.
            updateGroundWeight(pts === undefined || study !== undefined);
            updateWorld();
            drawSource();
          } finally {
            if (study) {
              sensor.u.hasGround.value = detailEnabled;
              scenario = displayScenario;
              sceneRevision++;
            }
            sensor.u.groundWeight.value = displayGroundWeight;
            sample = displaySample;
            timeS = displayTime;
          }
        },
      }),
    );
    const inspectionControls = initialization.own(
      installInspectionControls(
        canvas,
        () => view === "image",
        () => {
          const sensor = sensorInfo(config(cameraId));
          return {
            width,
            height,
            pixelRatio: renderer.getPixelRatio(),
            sensorWidth: sensor.width,
            sensorHeight: sensor.height,
          };
        },
        () => {
          dirty = true;
        },
      ),
    );
    // Never render synchronously inside OrbitControls.change; its state is committed
    // after dispatch and a nested update can emit the same event recursively.
    controls.addEventListener("change", () => {
      dirty = true;
    });
    const engine: ImagingEngine = {
      updateScenario(next, t = 0) {
        warnings.clear();
        if (next !== scenario) sceneRevision++;
        scenario = next;
        timeS = t;
        sample = sampleState(scenario, t);
        dirty = true;
      },
      getGroundRevision: () => groundRevision,
      setGroundImage(image) {
        if (image === currentDetail) return;
        const wasAerial = currentDetail && isAerialImage(currentDetail.id);
        const previousWeight = sensor.u.groundWeight.value;
        groundLayers.setDetail(image);
        currentDetail = image;
        aerialArrivalStartWeight = wasAerial ? previousWeight : 0;
        aerialLastUpdatedMs = performance.now();
        aerialProgressMs = 0;
        groundRevision++;
        dirty = true;
      },
      setBaseGroundImage(image) {
        if (image === currentBase) return;
        groundLayers.setBase(image);
        currentBase = image;
        groundRevision++;
        dirty = true;
      },
      setView(next, id = "main") {
        const previousView = view;
        const previousCamera = cameraId;
        view = next;
        cameraId = id;
        space.setActive(next === "space");
        if (next === "space" && !spaceVisited) {
          space.resetView();
          spaceVisited = true;
        }
        if (next === "panorama" && !panoramaVisited) {
          panoramaViewer.setLookDirection(initialPanoramaDirection(
            sample, previousView === "image" ? config(previousCamera) : undefined,
          ));
          panoramaVisited = true;
        }
        inspectionControls.selectCamera(id);
        dirty = true;
      },
      setWideMountDrag(mode, handler) {
        space.setWideMountDrag(mode, handler);
      },
      setCameraSelectHandler(handler) {
        space.setCameraSelectHandler(handler);
      },
      setSelectedCamera(id) {
        space.setSelectedCamera(id);
        dirty = true;
      },
      resetSpaceView() {
        space.resetView();
        dirty = true;
      },
      setReceivedPanorama(image) {
        panoramaViewer.setReceived(image);
      },
      setPanoramaProjection(projection) {
        panoramaViewer.setProjection(projection);
      },
      getPanoramaFov() {
        return panoramaViewer.fov;
      },
      setPanoramaFov(deg) {
        panoramaViewer.setFov(deg);
      },
      setQuality(next) {
        quality = next;
        renderer.setPixelRatio(quality === "low" ? Math.min(dpr, 1) : dpr);
        renderer.setSize(width, height, false);
        dirty = true;
      },
      getInspectionState() {
        return inspectionControls.state;
      },
      setInspection(mode) {
        inspectionControls.reset(mode);
      },
      resize(w, h, pixelRatio = window.devicePixelRatio) {
        width = Math.max(1, w);
        height = Math.max(1, h);
        dpr = Math.min(2, pixelRatio);
        renderer.setPixelRatio(quality === "low" ? Math.min(dpr, 1) : dpr);
        renderer.setSize(width, height, false);
        spaceCamera.aspect = width / height;
        spaceCamera.updateProjectionMatrix();
        space.resize();
        dirty = true;
      },
      render() {
        if (disposed || gpuFailure) return;
        if (!captures.busy) updateGroundWeight();
        if (view === "space") space.updateControls();
        if (dirty) {
          try {
            draw();
          } catch (error) {
            dirty = false;
            if (!hasDrawn) throw error;
            console.error(error);
            onStatus?.({
              ready: false,
              failed: true,
              backend: "WebGPU",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
      getEncoderFrame(id, w, h, captureUs, init, study) {
        return captures.encoderFrame(id, w, h, captureUs, init, study);
      },
      getEncoderCanvas(id, w, h, pts) {
        return captures.canvas(id, w, h, pts);
      },
      capture(options: CaptureOptions = {}) {
        return captures.capture(
          options.cameraId ?? (view === "panorama" ? "panorama" : cameraId),
          options,
        );
      },
      stitchDecodedFrames(front, rear, w, h) {
        return captures.stitchDecodedFrames(front, rear, w, h);
      },
      dispose() {
        disposed = true;
        inspectionControls.dispose();
        space.setActive(false);
        captures.dispose(() => {
          panoramaViewer.dispose();
          groundLayers.dispose();
          space.dispose();
          hardware.dispose();
          quad.geometry.dispose();
          sensor.referenceMaterial.dispose();
          sensor.passMaterial.dispose();
          removeGpuDiagnostics();
          stitch.material.dispose();
          optics.dispose();
          presentation.dispose();
          earthTextures.dispose();
          for (const rt of [frontTarget, rearTarget, mainTarget]) rt.dispose();
          renderer.dispose();
        });
      },
    };
    engine.resize(canvas.clientWidth || 800, canvas.clientHeight || 600);
    if (gpuFailure) throw gpuFailure;
    initialization.commit();
    return engine;
  } catch (error) {
    disposed = true;
    initialization.rollback();
    throw error;
  }
}
