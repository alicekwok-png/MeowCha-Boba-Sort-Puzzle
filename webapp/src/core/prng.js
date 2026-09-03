// core/prng.js — 確定性亂數（mulberry32）。client/server 用同一 seed 必須得出同一盤面。

export function mulberry32(seed) {
  seed |= 0;
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 將任意字串雜湊成 32-bit 整數（FNV-1a）。用於由 seed 字串派生數字 seed。 */
export function hash32(str) {
  let h = 0x811C9DC5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randInt(rng, lo, hi) {   // [lo, hi]
  return lo + Math.floor(rng() * (hi - lo + 1));
}
