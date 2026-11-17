import * as THREE from "three/webgpu";
import { Fn, texture, uniform, uv, vec3, vec4, wgslFn } from "three/tsl";
import { projectedPixelWGSL } from "./projection";
const project = wgslFn(projectedPixelWGSL);
import { panoramaViewRayWGSL } from "./panorama-viewer";
const direction = wgslFn(panoramaViewRayWGSL);
export function makeStitch(front: THREE.Texture, rear: THREE.Texture) {
  const a = texture(front),
    b = texture(rear);
  const u = {
    perspective: uniform(0),
    view: uniform(new THREE.Vector4()),
    cropA: uniform(new THREE.Vector4(0, 0, 1, 1)),
    cropB: uniform(new THREE.Vector4(0, 0, 1, 1)),
    sensorA: uniform(new THREE.Vector3()),
    sensorB: uniform(new THREE.Vector3()),
    lensA: uniform(new THREE.Vector4()),
    lensB: uniform(new THREE.Vector4()),
    rotationA: uniform(new THREE.Matrix3()),
    rotationB: uniform(new THREE.Matrix3()),
  };
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.colorNode = Fn(() => {
    const bodyRay = vec3(
      direction(uv(), u.view, u.perspective) as ReturnType<typeof vec3>,
    ).toVar();
    const rayA = vec3(u.rotationA.mul(bodyRay)).toVar(),
      rayB = vec3(u.rotationB.mul(bodyRay)).toVar();
    const pa = vec3(
        project(rayA, u.sensorA, u.lensA) as ReturnType<typeof vec3>,
      ).toVar(),
      pb = vec3(
        project(rayB, u.sensorB, u.lensB) as ReturnType<typeof vec3>,
      ).toVar();
    const wa = pa.z.mul(rayA.z.add(1).max(0.01).pow(4)).toVar(),
      wb = pb.z.mul(rayB.z.add(1).max(0.01).pow(4)).toVar();
    const ua = pa.xy.sub(u.cropA.xy).div(u.cropA.zw),
      ub = pb.xy.sub(u.cropB.xy).div(u.cropB.zw);
    const ca = a.sample(vec3(ua.x, ua.y.oneMinus(), 0).xy).rgb,
      cb = b.sample(vec3(ub.x, ub.y.oneMinus(), 0).xy).rgb;
    return vec4(ca.mul(wa).add(cb.mul(wb)).div(wa.add(wb).max(0.00001)), 1);
  })();
  return { material, u, a, b };
}
