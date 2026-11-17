import * as THREE from "three/webgpu";
import {
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
  updateSpacecraftMounts,
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
import { startWideDrag } from "./wide-mount-drag";
import type { WideMountDragMode, WideMountDragHandler } from "./types";
import { createCameraPicking } from "./camera-picking";
import { createAerialTransfer } from "./aerial-transfer";
import { earthSurfaceCoordinates, earthDayColor, earthNightColor } from "./earth-surface";

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
  western: THREE.Texture,
  westernNight: THREE.Texture,
  stanfordNight: THREE.Texture,
  cloudLayer: CloudLayer,
) {
  const geometryKey = (s: Scenario) => JSON.stringify([s.body,
    s.cameras.map(c => [c.id, c.housingDiameterMm, c.housingLengthMm])]);
  const poseKey = (s: Scenario) => JSON.stringify(s.cameras.map(c =>
    [c.positionBodyM, c.yawDeg, c.pitchDeg, c.rollDeg]));
  let shipKey = geometryKey(scenario), mountKey = poseKey(scenario);
  let cameraSelectionHandler: ((id: CameraId) => void) | null = null;
  let selected: CameraId | null = null,
    currentSample = sample,
    currentScenario = scenario;
  const shipScene = new THREE.Scene();
  const environment = new EarthEnvironment(day);
  shipScene.environment = environment.texture;
  let ship = makeSpacecraft(scenario);
  shipScene.add(ship);
  let guides = createCameraGuides(scenario, null, ship);
  shipScene.add(guides);
  function originRadius(group: THREE.Group) {
    const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
    return sphere.center.length() + sphere.radius;
  }
  let radius = originRadius(ship);
  let guideExtent = radius;
  function updateGuideExtent() {
    guideExtent = Math.max(radius, originRadius(guides));
  }
  const cameraOrigin = new THREE.Vector3();
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  function fitSolarShadow() {
    const bound = radius * 1.05;
    const camera = sunLight.shadow.camera;
    camera.left = camera.bottom = -bound;
    camera.right = camera.top = bound;
    camera.near = Math.max(0.001, 10 - bound);
    camera.far = 10 + bound;
    camera.updateProjectionMatrix();
  }
  fitSolarShadow();
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
    // Frame the actual sunward Earth limb, independently of target-tracking
    // body attitude. A five-degree gap puts the CAD center against space;
    // the Sun-facing azimuth favors the lit limb when the epoch permits it.
    const position = new THREE.Vector3(...currentSample.positionEcefM);
    const nadir = position.clone().normalize().negate();
    const sun = new THREE.Vector3(...currentSample.sunDirectionEcef);
    const bodyUp = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const sunward = sun.clone().addScaledVector(nadir, -sun.dot(nadir));
    if (sunward.lengthSq() < 1e-8) {
      sunward.copy(bodyUp).addScaledVector(nadir, -bodyUp.dot(nadir));
      if (sunward.lengthSq() < 1e-8)
        sunward.set(1, 0, 0).addScaledVector(nadir, -nadir.x);
    }
    sunward.normalize();
    const limbAngle = Math.asin(Math.min(1, 6378137 / position.length()));
    const viewAngle = limbAngle + THREE.MathUtils.degToRad(5);
    const observer = (side: number) =>
      sunward
        .clone()
        .applyAxisAngle(nadir, side * THREE.MathUtils.degToRad(40))
        .multiplyScalar(Math.sin(viewAngle))
        .addScaledVector(nadir, Math.cos(viewAngle))
        .negate();
    const first = observer(-1),
      second = observer(1);
    const direction = first.dot(bodyUp) >= second.dot(bodyUp) ? first : second;
    spaceCamera.position.copy(direction).multiplyScalar(distance);
    spaceCamera.up.copy(bodyUp);
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
    new THREE.SphereGeometry(6_378_137, 512, 256),
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
    new THREE.SphereGeometry(CLOUD_EQUATORIAL_RADIUS_M, 512, 256),
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
  const surfaceCoords = earthSurfaceCoordinates(positionWorld.add(worldOrigin));
  planetMaterial.colorNode = earthDayColor(day, western, surfaceCoords);
  planetMaterial.emissiveNode = earthNightColor(night, westernNight, stanfordNight, surfaceCoords)
    .mul(float(0.1).sub(normalWorld.dot(sunDirection)).smoothstep(0, 0.2))
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
  let dragMode: WideMountDragMode | null = null;
  let onMountChange: WideMountDragHandler | null = null;
  const picking = createCameraPicking(
    canvas,
    spaceCamera,
    () => ship,
    () => controls.enabled,
    (id) => cameraSelectionHandler?.(id),
    (id, firstRay) => {
      if (!dragMode || id !== selected || id === "main") return null;
      const config = currentScenario.cameras.find(camera => camera.id === id);
      if (!config) return null;
      const fromWorld = ship.matrixWorld.clone().invert();
      const update = startWideDrag(dragMode, id, config, currentScenario.body, firstRay.clone().applyMatrix4(fromWorld));
      return worldRay => {
        const patch = update(worldRay.clone().applyMatrix4(fromWorld));
        if (patch) onMountChange?.(id, patch);
      };
    },
  );
  let worldInitialized = false;
  function updateWorld(scenario: Scenario, sample: SimulationSample) {
    // Observer motion changes the projection, not the spacecraft or its shadow.
    if (worldInitialized && scenario === currentScenario && sample === currentSample) return false;
    worldOrigin.value.fromArray(sample.positionEcefM);
    sunDirection.value.fromArray(sample.sunDirectionEcef);
    const nextGeometry = geometryKey(scenario), nextPose = poseKey(scenario);
    const changed = nextGeometry !== shipKey || nextPose !== mountKey;
    if (nextGeometry !== shipKey) {
      disposeObject(ship);
      shipScene.remove(ship);
      ship = makeSpacecraft(scenario);
      shipScene.add(ship);
      setSpacecraftCameraHighlight(ship, selected);
    } else if (nextPose !== mountKey) {
      updateSpacecraftMounts(ship, scenario);
    }
    if (changed) {
      // Measure in the body frame, independent of the current orbital attitude.
      ship.quaternion.identity();
      radius = originRadius(ship);
      fitSolarShadow();
      controls.minDistance = radius * 1.12;
      controls.maxDistance = radius * 25;
      shipKey = nextGeometry;
      mountKey = nextPose;
    }
    // Lens/FOV edits do not rebuild CAD but must update the inspection guides.
    updateCameraGuides(guides, scenario, selected, ship);
    if (changed || scenario !== currentScenario) updateGuideExtent();
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
    currentScenario = scenario;
    currentSample = sample;
    worldInitialized = true;
    return changed;
  }

  return {
    shipScene,
    get spacecraft() { return ship; },
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
    setWideMountDrag(mode: WideMountDragMode | null, handler: WideMountDragHandler) {
      if (mode !== dragMode) picking.reset();
      dragMode = mode;
      onMountChange = handler;
    },
    setSelectedCamera(id: CameraId | null) {
      if (selected === id) return;
      picking.reset();
      selected = id;
      setSpacecraftCameraHighlight(ship, id);
      updateCameraGuides(guides, currentScenario, selected, ship);
      updateGuideExtent();
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
      // The observer can pan off center. Bound visible depth along its actual
      // forward axis to resolve board coatings and hardware during orbit/zoom.
      spaceCamera.updateMatrixWorld();
      const centerDepth = -cameraOrigin.set(0, 0, 0).applyMatrix4(spaceCamera.matrixWorldInverse).z;
      spaceCamera.near = Math.max(0.0001, centerDepth - guideExtent * 1.05);
      spaceCamera.far = Math.max(spaceCamera.near + radius, centerDepth + guideExtent * 1.05);
      spaceCamera.updateProjectionMatrix();
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
