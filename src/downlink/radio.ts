export const BANDWIDTH_MIN_HZ = 50_000;
export const BANDWIDTH_MAX_HZ = 50_000_000;

// ETSI EN 302 307-1 V1.4.1 (2014-11), §6 Table 13, p.36:
// useful bits/symbol for normal 64,800-bit FECFRAMEs, no pilots.
// https://www.etsi.org/deliver/etsi_en/302300_302399/30230701/01.04.01_60/en_30230701v010401p.pdf
export const MODCODS = [
  { id: 'qpsk-1/2', label: 'QPSK 1/2', bitsPerSymbol: 0.988858 },
  { id: 'qpsk-3/4', label: 'QPSK 3/4', bitsPerSymbol: 1.487473 },
  { id: '8psk-2/3', label: '8PSK 2/3', bitsPerSymbol: 1.980636 },
  { id: '8psk-3/4', label: '8PSK 3/4', bitsPerSymbol: 2.228124 },
  { id: '16apsk-2/3', label: '16APSK 2/3', bitsPerSymbol: 2.637201 },
  { id: '16apsk-3/4', label: '16APSK 3/4', bitsPerSymbol: 2.966728 },
] as const;
export type Modcod = typeof MODCODS[number]['id'];
export interface RadioSettings {
  bandwidthHz: number;
  modcod: Modcod;
  rollOff: number;
  applicationReserve: number;
}
export const DEFAULT_RADIO: RadioSettings = {
  bandwidthHz: 8_000_000, modcod: 'qpsk-1/2', rollOff: 0.2, applicationReserve: 0.1,
};

/** Occupied RF bandwidth B = Rs(1+α), §5.6. Application reserve is a study
 * assumption beyond DVB framing. No SNR, RF hardware or successful lock is predicted. */
export function netRadioRate(radio: RadioSettings): number {
  const mode = MODCODS.find(mode => mode.id === radio.modcod);
  if (!mode || !Number.isFinite(radio.bandwidthHz) || radio.bandwidthHz <= 0
    || !Number.isFinite(radio.rollOff) || radio.rollOff < 0 || radio.rollOff > 1
    || !Number.isFinite(radio.applicationReserve) || radio.applicationReserve < 0 || radio.applicationReserve >= 1)
    throw new RangeError('Invalid radio bandwidth, ModCod, roll-off or reserve.');
  return radio.bandwidthHz / (1 + radio.rollOff) * mode.bitsPerSymbol * (1 - radio.applicationReserve);
}

/** Editing either bandwidth or throughput changes the same capacity constraint. */
export function bandwidthForRate(rateBps: number, radio: RadioSettings): number {
  if (!Number.isFinite(rateBps) || rateBps <= 0) throw new RangeError('Data rate must be positive.');
  return rateBps / netRadioRate({ ...radio, bandwidthHz: 1 });
}
