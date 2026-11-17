import type { RenderView } from '../render';
import type { CameraId } from '../sim';

export interface SourceSelection {
  view: RenderView;
  imageCameraId: CameraId;
  spaceCameraId: CameraId;
}

export const DEFAULT_SOURCE_SELECTION: SourceSelection = {
  view: 'image', imageCameraId: 'main', spaceCameraId: 'main',
};

export function selectSourceCamera(source: SourceSelection, view: RenderView, id: CameraId): SourceSelection {
  if (view === 'space') return { ...source, view, spaceCameraId: id };
  if (view === 'panorama' && id !== 'main') return { ...source, view };
  return { ...source, view: 'image', imageCameraId: id };
}

export function displaySelection(source: SourceSelection, receiver: 'main' | '360' | null): {
  view: RenderView;
  cameraId: CameraId;
} {
  if (receiver === 'main') return { view: 'image', cameraId: 'main' };
  if (receiver === '360' || source.view === 'panorama') return { view: 'panorama', cameraId: 'wideA' };
  return { view: source.view, cameraId: source.view === 'space' ? source.spaceCameraId : source.imageCameraId };
}
