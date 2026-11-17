import { afterEach, expect, it, vi } from 'vitest';
import { markSessionActive, prefersPreview, sessionWasInterrupted } from './policy';

afterEach(() => vi.unstubAllGlobals());
const mac = { platform: 'MacIntel', maxTouchPoints: 0, userAgent: 'Macintosh' };

it('recognizes phones, desktop-UA iPads, and compact touch screens', () => {
  expect(prefersPreview({ ...mac, userAgent: 'iPhone' }, false)).toBe(true);
  expect(prefersPreview({ ...mac, userAgentData: { mobile: true } }, false)).toBe(true);
  expect(prefersPreview({ ...mac, maxTouchPoints: 5 }, false)).toBe(true);
  expect(prefersPreview({ ...mac, platform: 'Linux' }, true)).toBe(true);
  expect(prefersPreview(mac, false)).toBe(false);
  expect(prefersPreview({ ...mac, platform: 'Win32', maxTouchPoints: 10 }, false)).toBe(false);
});

it('records an active tab and clears it on a clean exit', () => {
  const values = new Map();
  vi.stubGlobal('sessionStorage', { getItem: values.get.bind(values), setItem: values.set.bind(values), removeItem: values.delete.bind(values) });
  markSessionActive(true);
  expect(sessionWasInterrupted()).toBe(true);
  markSessionActive(false);
  expect(sessionWasInterrupted()).toBe(false);
});

it('still starts when the browser blocks site storage', () => {
  const denied = () => { throw new Error('Storage denied'); };
  vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied });
  expect(sessionWasInterrupted()).toBe(false);
  expect(() => { markSessionActive(true); markSessionActive(false); }).not.toThrow();
});
