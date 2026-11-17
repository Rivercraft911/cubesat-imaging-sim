import * as THREE from "three/webgpu";
import { texture, uniform, uv, vec2, vec3, wgslFn } from "three/tsl";

/** A 360° raster is a transport projection. The observer sees a rectilinear
 * window into that sphere; changing this view never changes either sensor. */
export const panoramaViewRayWGSL = /*wgsl*/ `
fn panoramaViewRay(uv:vec2f,view:vec4f,perspective:f32)->vec3f{
 if(perspective<0.5){let longitude=(uv.x-0.5)*6.28318530718;let latitude=(uv.y-0.5)*3.14159265359;return vec3f(sin(longitude)*cos(latitude),cos(longitude)*cos(latitude),sin(latitude));}
 let forward=vec3f(sin(view.x)*cos(view.y),cos(view.x)*cos(view.y),sin(view.y));
 let right=vec3f(cos(view.x),-sin(view.x),0.0);
 let up=vec3f(-sin(view.x)*sin(view.y),-cos(view.x)*sin(view.y),cos(view.y));
 return normalize(forward+right*(uv.x*2.0-1.0)*view.z*view.w+up*(uv.y*2.0-1.0)*view.z);
}`;
const viewRay = wgslFn(panoramaViewRayWGSL);
const equirect = wgslFn(
  `fn equirect(ray:vec3f)->vec2f{return vec2f(atan2(ray.x,ray.y)/6.28318530718+0.5,asin(clamp(ray.z,-1.0,1.0))/3.14159265359+0.5);}`,
);
export function createPanoramaViewer(
  canvas: HTMLCanvasElement,
  enabled: () => boolean,
  onChange: () => void,
) {
  const mode = uniform(1),
    look = uniform(
      new THREE.Vector4(
        (50 * Math.PI) / 180,
        (10 * Math.PI) / 180,
        Math.tan((90 * Math.PI) / 360),
        1,
      ),
    );
  const placeholder = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 255]),
    1,
    1,
  );
  placeholder.needsUpdate = true;
  const receivedNode = texture(placeholder);
  let received: THREE.CanvasTexture | null = null,
    receivedCanvas: HTMLCanvasElement | null = null;
  let fov = 90,
    projection: "perspective" | "equirectangular" = "perspective",
    dragging = false,
    lastX = 0,
    lastY = 0;
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const ray = vec3(viewRay(uv(), look, mode) as ReturnType<typeof vec3>);
  material.colorNode = receivedNode.sample(
    vec2(equirect(ray) as ReturnType<typeof vec2>),
  );
  function setFov(deg: number) {
    fov = THREE.MathUtils.clamp(deg, 30, 120);
    look.value.z = Math.tan((fov * Math.PI) / 360);
    onChange();
  }
  function down(event: PointerEvent) {
    if (enabled() && projection === "perspective") {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    }
  }
  function move(event: PointerEvent) {
    if (!dragging) return;
    const scale = (2 * look.value.z) / Math.max(canvas.clientHeight, 1);
    look.value.x -= (event.clientX - lastX) * scale;
    look.value.y = THREE.MathUtils.clamp(
      look.value.y + (event.clientY - lastY) * scale,
      -Math.PI * 0.495,
      Math.PI * 0.495,
    );
    lastX = event.clientX;
    lastY = event.clientY;
    onChange();
  }
  function up() {
    dragging = false;
  }
  function wheel(event: WheelEvent) {
    if (enabled() && projection === "perspective") {
      event.preventDefault();
      setFov(fov * Math.exp(event.deltaY * 0.001));
    }
  }
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  return {
    mode,
    look,
    material,
    get fov() {
      return fov;
    },
    get hasReceived() {
      return received !== null;
    },
    get projection() {
      return projection;
    },
    configureDisplay(aspect: number) {
      mode.value = projection === "perspective" ? 1 : 0;
      look.value.w = aspect;
    },
    setProjection(value: "perspective" | "equirectangular") {
      projection = value;
      onChange();
    },
    setFov,
    setLookDirection(bodyDirection: THREE.Vector3) {
      const direction = bodyDirection.clone().normalize();
      look.value.x = Math.atan2(direction.x, direction.y);
      look.value.y = Math.asin(THREE.MathUtils.clamp(direction.z, -1, 1));
      onChange();
    },
    setReceived(image: HTMLCanvasElement | null) {
      if (image !== receivedCanvas) {
        received?.dispose();
        receivedCanvas = image;
        received = image ? new THREE.CanvasTexture(image) : null;
        if (received) {
          received.colorSpace = THREE.SRGBColorSpace;
          received.generateMipmaps = false;
          received.minFilter = THREE.LinearFilter;
          received.wrapS = THREE.RepeatWrapping;
        }
        receivedNode.value = received ?? placeholder;
      }
      if (received) received.needsUpdate = true;
      onChange();
    },
    dispose() {
      received?.dispose();
      placeholder.dispose();
      material.dispose();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    },
  };
}
