import { publicAsset } from '../assets';
import { markSessionActive, prefersPreview, sessionWasInterrupted } from './policy';

const launch = document.querySelector<HTMLElement>('#launch')!;
const note = launch.querySelector<HTMLElement>('#launch-note')!;
const photo = launch.querySelector<HTMLElement>('#launch-photo')!;
const share = launch.querySelector<HTMLButtonElement>('#share-link')!;
const shareStatus = launch.querySelector<HTMLElement>('#share-status')!;
if (typeof navigator.share !== 'function') {
  share.ariaLabel = share.title = 'Copy simulator link';
}
const retry = launch.querySelector<HTMLButtonElement>('#try-simulator')!;
const link = launch.querySelector<HTMLInputElement>('#share-url')!;
const detail = launch.querySelector<HTMLDetailsElement>('#launch-detail')!;
const hasGpu = typeof navigator.gpu?.requestAdapter === 'function';
let active = false;
let unmount: (() => void) | undefined;

function preview(message: string, reason?: string) {
  launch.hidden = false;
  note.textContent = message;
  share.hidden = false;
  shareStatus.textContent = '';
  retry.hidden = !hasGpu;
  detail.hidden = !reason;
  detail.open = false;
  detail.querySelector('p')!.textContent = reason ?? '';
  const img = photo.querySelector('img')!;
  if (!img.hasAttribute('src')) img.src = publicAsset('stanford-preview-100mm.webp');
  photo.hidden = false;
}

async function start() {
  if (active) return;
  active = true;
  markSessionActive(true);
  share.hidden = retry.hidden = photo.hidden = detail.hidden = link.hidden = true;
  shareStatus.textContent = '';
  note.textContent = 'Opening simulator…';
  function failed(reason: string) {
    if (!active) return;
    active = false;
    // Keep the interruption marker until a later run exits cleanly.
    unmount?.();
    unmount = undefined;
    retry.textContent = 'Try again';
    preview('The simulator stopped. Open this link on a laptop or desktop with WebGPU, or try again here.', reason);
    retry.focus({ preventScroll: true });
  }
  try {
    const { mountSimulator } = await import('../main');
    unmount = mountSimulator(document.getElementById('root')!, failed);
    launch.hidden = true;
  } catch (error) {
    failed(error instanceof Error ? error.message : String(error));
  }
}

retry.addEventListener('click', start);
share.addEventListener('click', async () => {
  const url = location.href;
  link.hidden = true;
  shareStatus.textContent = '';
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: document.title, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    shareStatus.textContent = 'Link copied';
  } catch {
    link.value = url;
    link.hidden = false;
    link.focus();
    link.select();
  }
});

window.addEventListener('pagehide', () => { if (active) markSessionActive(false); });
window.addEventListener('pageshow', event => {
  if (event.persisted && active) markSessionActive(true);
});

const compactTouchScreen = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600;
if (hasGpu && sessionWasInterrupted()) {
  preview('The last simulator session was interrupted. Open this link on a laptop or desktop with WebGPU, or try again here.');
} else if (prefersPreview(navigator, compactTouchScreen)) {
  preview('Please open this fellow up on a laptop or something that can handle some hefty WebGPU. The full sim can crash a phone tab.',
    hasGpu ? undefined : 'This browser doesn’t provide WebGPU.');
} else if (!hasGpu) {
  preview('This browser doesn’t provide WebGPU. Open this link on a laptop or desktop with WebGPU to run the simulator.');
} else {
  void start();
}
