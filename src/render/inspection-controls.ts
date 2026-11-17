export interface InspectionFrame {
  width: number;
  height: number;
  pixelRatio: number;
  sensorWidth: number;
  sensorHeight: number;
}
export interface InspectionState {
  mode: "fit" | "native" | "custom";
  /** Physical framebuffer pixels per native sensor pixel. */
  scale: number;
}
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Native-pixel view transform. Rendering/capture resolution never changes. */
export class InspectionTransform {
  mode: InspectionState["mode"] = "fit";
  private zoom = 1;
  private centerX = 0.5;
  private centerY = 0.5;
  reset(mode: "fit" | "native") {
    this.mode = mode;
    this.zoom = 1;
    this.recenter();
  }
  recenter() {
    this.centerX = this.centerY = 0.5;
  }
  state(frame: InspectionFrame): InspectionState {
    return {
      mode: this.mode,
      scale: this.mode === "fit" ? this.fitScale(frame) : this.zoom,
    };
  }
  private fitScale(f: InspectionFrame) {
    return Math.min(
      (f.width * f.pixelRatio) / f.sensorWidth,
      (f.height * f.pixelRatio) / f.sensorHeight,
    );
  }
  private bound(f: InspectionFrame) {
    const scale = this.state(f).scale;
    const hx = (f.width * f.pixelRatio) / (2 * scale * f.sensorWidth);
    const hy = (f.height * f.pixelRatio) / (2 * scale * f.sensorHeight);
    this.centerX = hx >= 0.5 ? 0.5 : clamp(this.centerX, hx, 1 - hx);
    this.centerY = hy >= 0.5 ? 0.5 : clamp(this.centerY, hy, 1 - hy);
  }
  crop(f: InspectionFrame): [number, number, number, number] {
    this.bound(f);
    const scale = this.state(f).scale;
    const width = (f.width * f.pixelRatio) / scale,
      height = (f.height * f.pixelRatio) / scale;
    return [
      this.centerX * f.sensorWidth - width / 2,
      this.centerY * f.sensorHeight - height / 2,
      width,
      height,
    ];
  }
  zoomAt(f: InspectionFrame, factor: number, x: number, y: number) {
    const oldScale = this.state(f).scale;
    const next = clamp(oldScale * factor, Math.min(0.05, this.fitScale(f)), 16);
    const offsetX = (x - f.width / 2) * f.pixelRatio;
    const offsetY = (y - f.height / 2) * f.pixelRatio;
    this.centerX += (offsetX * (1 / oldScale - 1 / next)) / f.sensorWidth;
    this.centerY += (offsetY * (1 / oldScale - 1 / next)) / f.sensorHeight;
    this.mode = "custom";
    this.zoom = next;
    this.bound(f);
  }
  pan(f: InspectionFrame, dx: number, dy: number) {
    const scale = this.state(f).scale;
    this.centerX -= (dx * f.pixelRatio) / (scale * f.sensorWidth);
    this.centerY -= (dy * f.pixelRatio) / (scale * f.sensorHeight);
    this.bound(f);
  }
}

/** Wheel and trackpad pinch zoom around the cursor; drag and two-touch pinch
 * operate in CSS coordinates and convert through the actual renderer DPR. */
export function installInspectionControls(
  canvas: HTMLCanvasElement,
  enabled: () => boolean,
  frame: () => InspectionFrame,
  changed: () => void,
) {
  const transform = new InspectionTransform();
  const pointers = new Map<number, { x: number; y: number }>();
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";
  const local = (x: number, y: number) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: x - bounds.left, y: y - bounds.top };
  };
  function wheel(event: WheelEvent) {
    if (!enabled()) return;
    event.preventDefault();
    const f = frame(),
      point = local(event.clientX, event.clientY);
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? f.height : 1);
    transform.zoomAt(
      f,
      Math.exp(clamp(-delta * (event.ctrlKey ? 0.01 : 0.002), -1, 1)),
      point.x,
      point.y,
    );
    changed();
  }
  function down(event: PointerEvent) {
    if (!enabled() || (event.pointerType !== "touch" && event.button !== 0))
      return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous || !enabled()) return;
    const before = [...pointers.values()];
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.values()],
      f = frame();
    if (before.length >= 2) {
      const mid = (points: typeof before) => ({
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      });
      const distance = (points: typeof before) =>
        Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const oldMid = mid(before),
        newMid = mid(after),
        point = local(oldMid.x, oldMid.y);
      transform.zoomAt(
        f,
        distance(after) / Math.max(1, distance(before)),
        point.x,
        point.y,
      );
      transform.pan(f, newMid.x - oldMid.x, newMid.y - oldMid.y);
    } else
      transform.pan(f, event.clientX - previous.x, event.clientY - previous.y);
    changed();
  }
  function up(event: PointerEvent) {
    pointers.delete(event.pointerId);
  }
  function doubleClick(event: MouseEvent) {
    if (!enabled()) return;
    event.preventDefault();
    const f = frame(),
      point = local(event.clientX, event.clientY);
    transform.zoomAt(f, 1 / transform.state(f).scale, point.x, point.y);
    changed();
  }
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("lostpointercapture", up);
  canvas.addEventListener("dblclick", doubleClick);
  return {
    get state() {
      return transform.state(frame());
    },
    get crop() {
      return transform.crop(frame());
    },
    reset(mode: "fit" | "native") {
      pointers.clear();
      transform.reset(mode);
      changed();
    },
    recenter() {
      pointers.clear();
      transform.recenter();
      changed();
    },
    dispose() {
      canvas.style.touchAction = previousTouchAction;
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up);
      canvas.removeEventListener("dblclick", doubleClick);
    },
  };
}
