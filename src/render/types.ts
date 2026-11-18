import type { CameraConfig, CameraId, Scenario } from "../sim/types";
export type WideMountDragMode = "move" | "aim";
export type WideMountDragHandler = (id: 'wideA' | 'wideB', change: Partial<CameraConfig>) => void;
export interface GroundImage {
  image: ImageBitmap | HTMLCanvasElement;
  /** EPSG:3857 meters: west, south, east, north. */
  boundsMercator: [number, number, number, number];
  sourceResolutionM: number;
  attribution: string;
  id: string;
}
export type RenderView = "image" | "space" | "panorama";
export type CaptureCamera = CameraId | "panorama";
export interface EngineStatus {
  ready: boolean;
  failed?: boolean;
  backend: string;
  message?: string;
  warnings?: string[];
  renderMs?: number;
  inspectionMode?: "fit" | "native" | "custom";
  /** Physical framebuffer pixels per native sensor pixel. */
  inspectionScale?: number;
  width?: number;
  height?: number;
}
export interface CaptureOptions {
  cameraId?: CaptureCamera;
  width?: number;
  height?: number;
  type?: "image/png" | "image/jpeg";
  /** Freeze the render state for this capture without changing the viewfinder. */
  study?: { scenario: Scenario; timeS: number; groundRevision?: number };
}
export interface ImagingEngine {
  updateScenario(scenario: Scenario, timeS?: number): void;
  getGroundRevision(): number;
  setGroundImage(image: GroundImage | null): void;
  setBaseGroundImage(image: GroundImage | null): void;
  setView(view: RenderView, cameraId?: CameraId): void;
  setSelectedCamera(id: CameraId | null): void;
  setWideMountDrag(mode: WideMountDragMode | null, onChange: WideMountDragHandler): void;
  resetSpaceView(): void;
  setCameraSelectHandler(handler: ((id: CameraId) => void) | null): void;
  setReceivedPanorama(image: HTMLCanvasElement | null): void;
  setPanoramaProjection(projection: "perspective" | "equirectangular"): void;
  setPanoramaFov(deg: number): void;
  getPanoramaFov(): number;
  setQuality(quality: "high" | "low"): void;
  getInspectionState(): { mode: "fit" | "native" | "custom"; scale: number };
  setInspection(mode: "fit" | "native"): void;
  resize(width: number, height: number, dpr?: number): void;
  /** Interactive playback may coalesce obsolete draws while the GPU is busy. */
  render(paceDisplay?: boolean): void;
  capture(options?: CaptureOptions): Promise<Blob>;
  getEncoderFrame(id: CaptureCamera, width: number, height: number, captureUs: number, init: VideoFrameInit, study?: CaptureOptions["study"]): Promise<VideoFrame>;
  getEncoderCanvas(
    cameraId: CaptureCamera,
    width?: number,
    height?: number,
    framePTS?: number,
  ): Promise<HTMLCanvasElement>;
  stitchDecodedFrames(
    front: CanvasImageSource,
    rear: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<HTMLCanvasElement>;
  dispose(): void;
}
