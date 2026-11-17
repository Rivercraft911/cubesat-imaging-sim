import { PASS_END_S } from './playback-clock';

export function liveLinkStartAvailability(timeS: number, rendererReady: boolean) {
  const passEnded = timeS >= PASS_END_S;
  return {
    enabled: rendererReady && !passEnded,
    message: passEnded ? 'Move the pass timeline earlier to start the live link.' : null,
  };
}
