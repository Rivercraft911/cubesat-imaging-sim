import * as THREE from "three/webgpu";
import {
  Fn,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  textureSize,
  wgslFn,
} from "three/tsl";
import { stitchCoverageWGSL } from "./stitch-confidence";
const coverage = wgslFn(stitchCoverageWGSL);
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
    featherPixelsA: uniform(2),
    featherPixelsB: uniform(2),
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
    // Convert one decoded texel back to native pixels. This also handles
    // square eye crops and letterboxing without admitting cropped-out rays.
    const scaleA = u.cropA.zw
      .mul(u.sensorA.xy)
      .div(vec2(textureSize(a) as unknown as THREE.Node<"uvec2">));
    const scaleB = u.cropB.zw
      .mul(u.sensorB.xy)
      .div(vec2(textureSize(b) as unknown as THREE.Node<"uvec2">));
    const featherA = u.featherPixelsA.add(scaleA.x.max(scaleA.y).sub(1).max(0));
    const featherB = u.featherPixelsB.add(scaleB.x.max(scaleB.y).sub(1).max(0));
    const edgeA = vec2(
      coverage(pa, u.sensorA, u.lensA, u.cropA, featherA) as ReturnType<
        typeof vec2
      >,
    ).toVar();
    const edgeB = vec2(
      coverage(pb, u.sensorB, u.lensB, u.cropB, featherB) as ReturnType<
        typeof vec2
      >,
    ).toVar();
    const baseA = rayA.z.add(1).max(0.01).pow(4).mul(edgeA.y);
    const baseB = rayB.z.add(1).max(0.01).pow(4).mul(edgeB.y);
    const wa = baseA.mul(edgeA.x).toVar(),
      wb = baseB.mul(edgeB.x).toVar();
    const ua = pa.xy.sub(u.cropA.xy).div(u.cropA.zw),
      ub = pb.xy.sub(u.cropB.xy).div(u.cropB.zw);
    const ca = a.sample(vec3(ua.x, ua.y.oneMinus(), 0).xy).rgb,
      cb = b.sample(vec3(ub.x, ub.y.oneMinus(), 0).xy).rgb;
    const total = wa.add(wb);
    const blended = ca.mul(wa).add(cb.mul(wb)).div(total.max(1e-20));
    // Exactly touching (zero-overlap) fields have no interior confidence at
    // their shared boundary. Use their valid pixels rather than invent a gap.
    // Both weights remain zero for a genuinely uncovered direction.
    const touching = ca
      .mul(baseA)
      .add(cb.mul(baseB))
      .div(baseA.add(baseB).max(1e-20));
    return vec4(total.greaterThan(1e-12).select(blended, touching), 1);
  })();
  return { material, u, a, b };
}
