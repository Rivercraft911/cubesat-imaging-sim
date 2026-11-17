import * as THREE from 'three/webgpu';
import type { CameraId } from '../sim';

const CLICK_DISTANCE_SQUARED = 5 ** 2;

type Press = { id: number; x: number; y: number; dragged: boolean };

function cameraIdOf(object: THREE.Object3D, ship: THREE.Group): CameraId | null | undefined {
  let selected: CameraId | null = null;
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return undefined;
    const id: unknown = node.userData.cameraId;
    if (id === 'main' || id === 'wideA' || id === 'wideB') selected ??= id;
    if (node === ship) return selected;
  }
  return undefined;
}

function movedTooFar(event: PointerEvent, press: Press): boolean {
  const distanceSquared = (event.clientX - press.x) ** 2 + (event.clientY - press.y) ** 2;
  return distanceSquared >= CLICK_DISTANCE_SQUARED;
}

export function createCameraPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  getShip: () => THREE.Group,
  enabled: () => boolean,
  onSelect: (id: CameraId) => void,
) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const cameraPoint = new THREE.Vector3();
  ray.layers.set(0);
  let press: Press | null = null;
  let priorCursor: string | null = null;

  function setCursor(cursor: string) {
    priorCursor ??= canvas.style.cursor;
    canvas.style.cursor = cursor;
  }

  function reset() {
    press = null;
    if (priorCursor !== null) canvas.style.cursor = priorCursor;
    priorCursor = null;
  }

  function pick(event: PointerEvent): CameraId | null {
    const { left, top, width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return null;
    const x = (event.clientX - left) / width;
    const y = (event.clientY - top) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;

    const ship = getShip();
    ship.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    ray.setFromCamera(ndc.set(2 * x - 1, 1 - 2 * y), camera);
    for (const hit of ray.intersectObject(ship, true)) {
      if (hit.object instanceof THREE.Mesh) {
        const { material } = hit.object;
        const visibleMaterial = Array.isArray(material) ? material[hit.face?.materialIndex ?? 0] : material;
        if (!visibleMaterial?.visible) continue;
      }
      if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
        const depth = -cameraPoint.copy(hit.point).applyMatrix4(camera.matrixWorldInverse).z;
        if (depth < camera.near || depth > camera.far) continue;
      }
      // A visible non-camera surface still stops the ray.
      const id = cameraIdOf(hit.object, ship);
      if (id !== undefined) return id;
    }
    return null;
  }

  function pointerDown(event: PointerEvent) {
    if (!enabled()) return reset();
    if (press && press.id !== event.pointerId) {
      press.dragged = true;
      return;
    }
    if (event.button !== 0 || !event.isPrimary) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  }

  function pointerMove(event: PointerEvent) {
    if (!enabled()) return reset();
    if (press?.id === event.pointerId) {
      const current = press;
      current.dragged ||= movedTooFar(event, current)
        || Boolean(event.getCoalescedEvents?.().some(sample => movedTooFar(sample, current)));
      if (current.dragged) setCursor('grabbing');
      return;
    }
    setCursor(event.buttons ? 'grabbing' : pick(event) ? 'pointer' : 'grab');
  }

  function pointerUp(event: PointerEvent) {
    if (!enabled()) return reset();
    if (press?.id !== event.pointerId || event.button !== 0) return;
    const isClick = !press.dragged && !movedTooFar(event, press);
    press = null;
    const id = pick(event);
    setCursor(id ? 'pointer' : 'grab');
    if (isClick && id) onSelect(id);
  }

  function pointerCancel(event: PointerEvent) {
    if (press?.id === event.pointerId) reset();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointerleave', reset);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('lostpointercapture', pointerCancel);
  return {
    reset,
    dispose() {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointerleave', reset);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('lostpointercapture', pointerCancel);
      reset();
    },
  };
}
