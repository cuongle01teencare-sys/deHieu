/**
 * Kênh dữ liệu của một dòng kèo. Mỗi tenant luôn có 3 khái niệm: descriptor (metadata),
 * live và prematch — chỉ live/prematch sinh ra odds nên phase chỉ có 2 giá trị.
 */
export const PHASES = ['live', 'prematch'] as const;

export type Phase = (typeof PHASES)[number];

/** Kèo có bất kỳ chân nào live thì tính là live. */
export const combinePhases = (a: Phase, b: Phase): Phase =>
  a === 'live' || b === 'live' ? 'live' : 'prematch';
