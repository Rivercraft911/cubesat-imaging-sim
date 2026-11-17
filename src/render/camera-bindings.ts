import * as THREE from "three/webgpu";
import {
  cameraPose,
  getSensor,
  type CameraConfig,
  type SensorProfile,
  type Scenario,
  type SimulationSample,
} from "../sim";
import type { makeSensorMaterial } from "./sensor-material";
import type { makeStitch } from "./stitch";

/** Explicit CPU → GPU projection bindings, shared by display and recording. */
function matrix(q: THREE.Quaternion) {
  return new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(q),
  );
}
function lensVector(c: CameraConfig) {
  return new THREE.Vector4(
    c.lens.focalLengthMm,
    c.lens.projection === "rectilinear"
      ? 0
      : c.lens.projection === "equidistant"
        ? 1
        : 2,
    (Math.min(
      c.lens.maxFovDeg / 2,
      c.lens.projection === "rectilinear" ? 89.999 : 180,
    ) *
      Math.PI) /
      180,
    c.lens.imageCircleMm,
  );
}
export function bindSensorCamera(
  sensor: ReturnType<typeof makeSensorMaterial>,
  sample: SimulationSample,
  c: CameraConfig,
  s: SensorProfile,
  cube: THREE.CubeTexture,
) {
  const pose = cameraPose(sample, c);
  sensor.u.sensor.value.set(s.width, s.height, s.pixelPitchUm / 1000);
  sensor.u.lens.value.copy(lensVector(c));
  sensor.u.rotation.value.copy(
    matrix(new THREE.Quaternion(...pose.qEcefFromCamera)),
  );
  sensor.u.origin.value.fromArray(pose.positionEcefM);
  sensor.u.sun.value.fromArray(sample.sunDirectionEcef);
  const o = pose.positionEcefM;
  sensor.u.earthC.value =
    (o[0] / 6378137) ** 2 +
    (o[1] / 6378137) ** 2 +
    (o[2] / 6356752.314245179) ** 2 -
    1;
  sensor.u.localOrigin.value.fromArray(o).sub(sensor.u.groundReference.value);
  // Source-normalized brightness. Exposure affects the shutter PSF, not invented radiometry.
  sensor.u.exposure.value = 1;
  sensor.u.space.value = c.id === "main" ? 0 : 1;
  sensor.u.showShip.value = 1;
  sensor.shipNode.value = cube;
  return pose;
}
export function bindPanoramaCameras(
  stitch: ReturnType<typeof makeStitch>,
  scenario: Scenario,
  sample: SimulationSample,
) {
  const config = (id: string) => scenario.cameras.find((c) => c.id === id)!;
  const sensorInfo = (camera: CameraConfig) =>
    getSensor(camera.sensorId, scenario.customSensor);
  stitch.u.perspective.value = 0;
  stitch.u.cropA.value.set(0, 0, 1, 1);
  stitch.u.cropB.value.set(0, 0, 1, 1);
  const bodyQ = new THREE.Quaternion(...sample.qEcefFromBody);
  for (const [id, side] of [
    ["wideA", "A"],
    ["wideB", "B"],
  ] as const) {
    const c = config(id),
      s = sensorInfo(c);
    stitch.u[`sensor${side}`].value.set(
      s.width,
      s.height,
      s.pixelPitchUm / 1000,
    );
    stitch.u[`lens${side}`].value.copy(lensVector(c));
    const inverse = new THREE.Quaternion(
      ...cameraPose(sample, c).qEcefFromCamera,
    )
      .invert()
      .multiply(bodyQ);
    stitch.u[`rotation${side}`].value.copy(matrix(inverse));
  }
}
