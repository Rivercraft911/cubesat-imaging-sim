import { publicAsset } from '../assets';
import { markSessionActive, prefersPreview, sessionWasInterrupted } from './policy';

const launch = document.querySelector<HTMLElement>('#launch')!;
const note = launch.querySelector<HTMLElement>('#launch-note')!;
const photo = launch.querySelector<HTMLElement>('#launch-photo')!;
const controls = launch.querySelector<HTMLElement>('.launch-actions')!;
const copy = launch.querySelector<HTMLButtonElement>('#copy-link')!;
const retry = launch.querySelector<HTMLButtonElement>('#try-simulator')!;
const link = launch.querySelector<HTMLInputElement>('#share-url')!;
const detail = launch.querySelector<HTMLDetailsElement>('#launch-detail')!;
const hasGpu = typeof navigator.gpu?.requestAdapter === 'function';
let active = false;
let unmount: (() => void) | undefined;

function preview(message: string, reason?: string) {
  launch.hidden = false;
  note.textContent = message;
  controls.hidden = false;
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
  controls.hidden = photo.hidden = detail.hidden = link.hidden = true;
  note.textContent = 'Opening simulator…';
  function failed(reason: string) {
    if (!active) return;
    active = false;
    // Keep the interruption marker until a later run exits cleanly.
    unmount?.();
    unmount = undefined;
    retry.textContent = 'Try again';
    preview('The simulator stopped. Open this link on a laptop or desktop with WebGPU, or try again here.', reason);
    copy.focus({ preventScroll: true });
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
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    copy.textContent = 'Link copied';
  } catch {
    link.value = location.href;
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
if (!hasGpu) {
  preview('This browser doesn’t provide WebGPU. Open this link on a laptop or desktop with WebGPU to run the simulator.');
} else if (sessionWasInterrupted()) {
  preview('The last simulator session was interrupted. Open this link on a laptop or desktop with WebGPU, or try again here.');
} else if (prefersPreview(navigator, compactTouchScreen)) {
  preview('For the full-resolution simulator, open this link on a laptop or desktop with WebGPU. Running it here may close the tab.');
} else {
  void start();
}
