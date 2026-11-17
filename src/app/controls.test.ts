import { expect, it } from 'vitest';
import { commitNumberDraft } from './fields';
import { liveLinkStartAvailability } from './live-link-start';
import { PASS_END_S } from './playback-clock';

it('restores the displayed bound when the clamped edit leaves the applied value unchanged', () => {
  expect(commitNumberDraft('150', 100, 2, 0.1, 100)).toEqual({ value: 100, text: '100' });
});

it('keeps the precise applied value when an untouched rounded number loses focus', () => {
  expect(commitNumberDraft('1.23', 1.2345, 2)).toEqual({ value: 1.2345, text: '1.23' });
});

it('restores the displayed value when a numeric draft is cleared', () => {
  expect(commitNumberDraft('', 4.256, 2)).toEqual({ value: 4.256, text: '4.26' });
});

it('prevents live-link startup at the pass endpoint and tells the operator how to proceed', () => {
  expect(liveLinkStartAvailability(PASS_END_S, true)).toEqual({
    enabled: false,
    message: 'Move the pass timeline earlier to start the live link.',
  });
  expect(liveLinkStartAvailability(PASS_END_S - 0.001, true)).toEqual({ enabled: true, message: null });
  expect(liveLinkStartAvailability(0, false)).toEqual({ enabled: false, message: null });
});
