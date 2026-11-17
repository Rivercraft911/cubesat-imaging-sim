import * as THREE from "three/webgpu";
import {
  texture,
  uniform,
  positionWorld,
  normalWorld,
  output,
  vec3,
  vec4,
  float,
} from "three/tsl";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import type { Scenario, SimulationSample, CameraId, CameraPose } from "../sim";
import { AtmosphereAdapter } from "./atmosphere";
import { EarthEnvironment } from "./environment";
import {
  makeSpacecraft,
  disposeObject,
  setSpacecraftCameraHighlight,
} from "./spacecraft";
import {
  createCameraGuides,
  updateCameraGuides,
  disposeCameraGuides,
} from "./camera-guides";
import type { CloudLayer } from "./cloud-layer";
import { CLOUD_EQUATORIAL_RADIUS_M, CLOUD_POLAR_RADIUS_M } from "./cloud-layer";
import { createCameraPicking } from "./camera-picking";
import { createAerialTransfer } from "./aerial-transfer";

/** Aesthetic context is isolated from native sensor formation and radiometry.
 * Two depth ranges keep a millimeter-scale spacecraft and planetary geometry
 * in meters without sacrificing spacecraft depth precision. */
export async function createSpaceContext(
  renderer: THREE.WebGPURenderer,
  canvas: HTMLCanvasElement,
  scenario: Scenario,
  sample: SimulationSample,
  day: THREE.Texture,
  night: THREE.Texture,
  cloud: THREE.Texture,
  cloudLayer: CloudLayer,
) {
  let shipKey = "";
  let cameraSelectionHandler: ((id: CameraId) => void) | null = null;
  let selected: CameraId | null = null,
    currentSample = sample,
    currentScenario = scenario;
  const shipScene = new THREE.Scene();
  const environment = new EarthEnvironment();
  shipScene.environment = environment.texture;
  let ship = makeSpacecraft(scenario);
  shipScene.add(ship);
  let guides = createCameraGuides(scenario, null, ship);
  shipScene.add(guides);
  let radius = new THREE.Box3()
    .setFromObject(ship)
    .getBoundingSphere(new THREE.Sphere()).radius;
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -0.24;
  sunLight.shadow.camera.right = 0.24;
  sunLight.shadow.camera.top = 0.24;
  sunLight.shadow.camera.bottom = -0.24;
  sunLight.shadow.camera.near = 8;
  sunLight.shadow.camera.far = 12;
  sunLight.shadow.bias = -0.000025;
  sunLight.shadow.normalBias = 0.0001;
  sunLight.shadow.autoUpdate = false;
  shipScene.add(sunLight);
  shipScene.add(new THREE.AmbientLight(0xe4e7ea, 0.3));
  const spaceCamera = new THREE.PerspectiveCamera(50, 1, 0.001, 50),
    planetCamera = new THREE.PerspectiveCamera(50, 1, 1, 30_000_000);
  spaceCamera.layers.enable(1);
  const controls = new TrackballControls(spaceCamera, canvas);
  controls.staticMoving = true;
  controls.rotateSpeed = 1.5;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.45;
  controls.noPan = false;
  controls.keys = ["", "", ""];
  controls.enabled = false;
  function resetView() {
    const q = new THREE.Quaternion(...currentSample.qEcefFromBody);
    const halfFov = Math.atan(
      Math.tan((spaceCamera.fov * Math.PI) / 360) *
        Math.min(1, spaceCamera.aspect),
    );
    const guideBounds = new THREE.Box3().setFromObject(guides);
    const guideSphere = guideBounds.getBoundingSphere(new THREE.Sphere());
    const framingRadius = guideBounds.isEmpty()
      ? radius
      : Math.max(radius, guideSphere.radius + guideSphere.center.length());
    const distance = (framingRadius / Math.sin(halfFov)) * 1.12;
    controls.target.set(0, 0, 0);
    spaceCamera.position
      .set(0.13, 0.38, 0.18)
      .normalize()
      .multiplyScalar(distance)
      .applyQuaternion(q);
    spaceCamera.up.set(0, 0, 1).applyQuaternion(q);
    spaceCamera.lookAt(controls.target);
    controls.minDistance = radius * 1.12;
    controls.maxDistance = radius * 25;
    controls.handleResize();
    controls.update();
  }
  resetView();
  const planetScene = new THREE.Scene();
  const worldOrigin = uniform(new THREE.Vector3(...sample.positionEcefM)),
    sunDirection = uniform(new THREE.Vector3(...sample.sunDirectionEcef));
  const planetMaterial = new THREE.MeshStandardNodeMaterial({
    map: day,
    roughness: 1,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: night,
    emissiveIntensity: 0.035,
  });
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(6_378_137, 128, 64),
    planetMaterial,
  );
  planet.rotation.x = Math.PI / 2;
  planet.scale.y = 0.9966471893352525; // scale must be local polar Y before rotation
  planetScene.add(planet);
  const cloudsMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    roughness: 1,
  });
  cloudsMaterial.opacityNode = cloudLayer
    .opacity(positionWorld.add(worldOrigin))
    .mul(0.82);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(CLOUD_EQUATORIAL_RADIUS_M, 128, 64),
    cloudsMaterial,
  );
  clouds.rotation.x = Math.PI / 2;
  clouds.scale.y = CLOUD_POLAR_RADIUS_M / CLOUD_EQUATORIAL_RADIUS_M;
  planetScene.add(clouds);
  const planetSun = new THREE.DirectionalLight(0xffffff, 3);
  planetScene.add(planetSun);
  planetScene.add(new THREE.AmbientLight(0x526686, 0.05));
  const atmosphere = new AtmosphereAdapter();
  const atmosphereContext = atmosphere.context(
    "space",
    planetCamera,
    new THREE.Vector3(...sample.positionEcefM),
    new THREE.Vector3(...sample.sunDirectionEcef),
  );
  planetScene.backgroundNode = atmosphere.sky(atmosphereContext);
  const aerial = createAerialTransfer(atmosphereContext);
  const contextCamera =
    atmosphereContext.cameraPositionECEF as unknown as THREE.Node<"vec3">;
  planetMaterial.emissiveNode = texture(night)
    .rgb.mul(float(0.1).sub(normalWorld.dot(sunDirection)).smoothstep(0, 0.2))
    .mul(0.035);
  planetMaterial.outputNode = vec4(
    aerial.toPoint(
      output.rgb,
      contextCamera,
      positionWorld.add(worldOrigin),
      sunDirection,
    ),
    output.a,
  );
  cloudsMaterial.outputNode = vec4(
    aerial.toPoint(
      output.rgb,
      contextCamera,
      positionWorld.add(worldOrigin),
      sunDirection,
    ),
    output.a,
  );
  const sensorCamera = new THREE.PerspectiveCamera();
  const sensorContext = atmosphere.context(
    "sensor",
    sensorCamera,
    new THREE.Vector3(...sample.positionEcefM),
    new THREE.Vector3(...sample.sunDirectionEcef),
  );
  const sensorAerial = createAerialTransfer(sensorContext);
  try {
    await atmosphere.initialize(renderer, planetScene, planetCamera);
  } catch (error) {
    controls.dispose();
    disposeCameraGuides(guides);
    disposeObject(ship);
    disposeObject(planetScene);
    atmosphere.dispose();
    environment.dispose();
    throw error;
  }
  const picking = createCameraPicking(
    canvas,
    spaceCamera,
    () => ship,
    () => controls.enabled,
    (id) => cameraSelectionHandler?.(id),
  );
  function updateWorld(scenario: Scenario, sample: SimulationSample) {
    currentScenario = scenario;
    currentSample = sample;
    worldOrigin.value.fromArray(sample.positionEcefM);
    sunDirection.value.fromArray(sample.sunDirectionEcef);
    let changed = false;
    const nextKey = JSON.stringify([
      scenario.body,
      scenario.cameras.map((c) => [
        c.positionBodyM,
        c.yawDeg,
        c.pitchDeg,
        c.rollDeg,
        c.housingDiameterMm,
        c.housingLengthMm,
      ]),
    ]);
    if (nextKey !== shipKey) {
      disposeObject(ship);
      shipScene.remove(ship);
      ship = makeSpacecraft(scenario);
      shipScene.add(ship);
      radius = new THREE.Box3()
        .setFromObject(ship)
        .getBoundingSphere(new THREE.Sphere()).radius;
      controls.minDistance = radius * 1.12;
      controls.maxDistance = radius * 25;
      setSpacecraftCameraHighlight(ship, selected);
      shipKey = nextKey;
      changed = true;
    }
    // Lens/FOV edits do not rebuild CAD but must update the inspection guides.
    updateCameraGuides(guides, scenario, selected, ship);
    guides.quaternion.fromArray(sample.qEcefFromBody);
    ship.quaternion.fromArray(sample.qEcefFromBody);
    ship.updateMatrixWorld(true);
    environment.update(sample);
    const sun = new THREE.Vector3(...sample.sunDirectionEcef);
    sunLight.position.copy(sun).multiplyScalar(10);
    sunLight.shadow.needsUpdate = true;
    planetSun.position.copy(sun).multiplyScalar(10);
    planet.position.fromArray(sample.positionEcefM).negate();
    clouds.position.copy(planet.position);
    atmosphere.context(
      "space",
      planetCamera,
      new THREE.Vector3(...sample.positionEcefM),
      sun,
    );
    return changed;
  }

  return {
    shipScene,
    sensorAerial,
    setSensorPose(pose: CameraPose, sample: SimulationSample) {
      sensorCamera.position
        .fromArray(pose.positionEcefM)
        .sub(new THREE.Vector3(...sample.positionEcefM));
      sensorCamera.updateMatrixWorld();
      atmosphere.context(
        "sensor",
        sensorCamera,
        new THREE.Vector3(...sample.positionEcefM),
        new THREE.Vector3(...sample.sunDirectionEcef),
      );
    },
    spaceCamera,
    controls,
    updateWorld,
    resetView,
    resize() {
      controls.handleResize();
    },
    updateControls() {
      if (controls.enabled) {
        controls.update();
        const minimum = radius * 1.12;
        if (spaceCamera.position.length() < minimum) {
          spaceCamera.position.setLength(minimum);
          spaceCamera.lookAt(controls.target);
        }
      }
    },
    setActive(active: boolean) {
      controls.enabled = active;
      if (!active) picking.reset();
    },
    setCameraSelectHandler(handler: ((id: CameraId) => void) | null) {
      cameraSelectionHandler = handler;
    },
    setSelectedCamera(id: CameraId | null) {
      selected = id;
      setSpacecraftCameraHighlight(ship, id);
      updateWorld(currentScenario, currentSample);
    },
    setSurface(node: THREE.MeshStandardNodeMaterial["colorNode"]) {
      planetMaterial.colorNode = node;
      planetMaterial.needsUpdate = true;
    },
    render(width: number, height: number) {
      // The planet pass is independent of the millimeter-range hardware pass.
      // A 1 m near plane quantizes Earth and the 8 km cloud shell to one depth.
      planetCamera.near = Math.max(
        1000,
        Math.min(50000, currentScenario.altitudeM * 0.1),
      );
      planetCamera.position.copy(spaceCamera.position);
      planetCamera.quaternion.copy(spaceCamera.quaternion);
      planetCamera.aspect = width / height;
      planetCamera.updateProjectionMatrix();
      renderer.render(planetScene, planetCamera);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(shipScene, spaceCamera);
      renderer.autoClear = true;
    },
    dispose() {
      picking.dispose();
      controls.dispose();
      disposeCameraGuides(guides);
      disposeObject(ship);
      disposeObject(planetScene);
      atmosphere.dispose();
      environment.dispose();
    },
  };
}
