import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_SELECTION, displaySelection, selectSourceCamera } from './view-selection';

describe('viewfinder camera selection', () => {
  it('edits the physical rear lens when it is picked in Space', () => {
    const rear = selectSourceCamera(DEFAULT_SOURCE_SELECTION, 'space', 'wideB');
    expect(displaySelection(rear, null).cameraId).toBe('wideB');
    expect(displaySelection({ ...rear, view: 'image' }, null).cameraId).toBe('main');
  });
  it('keeps the raw Wide B camera when visiting 360 and editing a camera in Space', () => {
    const image = selectSourceCamera(DEFAULT_SOURCE_SELECTION, 'image', 'wideB');
    const panorama = { ...image, view: 'panorama' } as const;
    const space = selectSourceCamera(panorama, 'space', 'wideA');
    const restoredImage = { ...space, view: 'image' } as const;

    expect(displaySelection(panorama, null)).toEqual({ view: 'panorama', cameraId: 'wideA' });
    expect(displaySelection(space, null)).toEqual({ view: 'space', cameraId: 'wideA' });
    expect(displaySelection(restoredImage, null)).toEqual({ view: 'image', cameraId: 'wideB' });
    expect(displaySelection({ ...restoredImage, view: 'space' }, null)).toEqual({ view: 'space', cameraId: 'wideA' });
  });

  it('lets the panorama camera control explicitly open the raw Main image', () => {
    const wide = selectSourceCamera(DEFAULT_SOURCE_SELECTION, 'image', 'wideB');
    const pair = selectSourceCamera(wide, 'panorama', 'wideA');
    const main = selectSourceCamera(pair, 'panorama', 'main');

    expect(pair.imageCameraId).toBe('wideB');
    expect(displaySelection(main, null)).toEqual({ view: 'image', cameraId: 'main' });
  });

  it('shows each receiver in its own context and restores the source choice', () => {
    const image = selectSourceCamera(DEFAULT_SOURCE_SELECTION, 'image', 'wideB');
    const space = { ...image, view: 'space' } as const;

    expect(displaySelection(image, 'main')).toEqual({ view: 'image', cameraId: 'main' });
    expect(displaySelection(image, null)).toEqual({ view: 'image', cameraId: 'wideB' });
    expect(displaySelection(space, '360')).toEqual({ view: 'panorama', cameraId: 'wideA' });
    expect(displaySelection(space, null)).toEqual({ view: 'space', cameraId: 'main' });
  });
});
