/* ============================================================
   Diamond Duel - Seeded RNG
   All randomness in the game flows through one seeded generator
   so runs are reproducible and bugs are repeatable.
   xmur3 (seed hashing) -> mulberry32 (generator).
   ============================================================ */
(function (global) {
  "use strict";

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  // makeRNG(seed) starts fresh; makeRNG(seed, savedState) resumes mid-stream so a
  // refreshed game continues with the same sequence of outcomes.
  function makeRNG(seedStr, savedState) {
    const seedFn = xmur3(String(seedStr));
    let a = (savedState != null) ? (savedState | 0) : seedFn();
    function rand() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const api = {
      seed: String(seedStr),
      state: () => a,         // snapshot for save/resume
      float: () => rand(),
      // inclusive integer in [min, max]
      int: (min, max) => Math.floor(rand() * (max - min + 1)) + min,
      range: (min, max) => rand() * (max - min) + min,
      chance: (p) => rand() < p,
      pick: (arr) => arr[Math.floor(rand() * arr.length)],
      shuffle: (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          const t = arr[i];
          arr[i] = arr[j];
          arr[j] = t;
        }
        return arr;
      },
      // entries: [{ v: value, w: weight }] -> picks v proportional to w
      weighted: (entries) => {
        let total = 0;
        for (let i = 0; i < entries.length; i++) total += Math.max(0, entries[i].w);
        if (total <= 0) return entries[entries.length - 1].v;
        let r = rand() * total;
        for (let i = 0; i < entries.length; i++) {
          r -= Math.max(0, entries[i].w);
          if (r <= 0) return entries[i].v;
        }
        return entries[entries.length - 1].v;
      },
      // pick n distinct items from arr (does not mutate arr)
      sample: (arr, n) => {
        const copy = arr.slice();
        api.shuffle(copy);
        return copy.slice(0, Math.min(n, copy.length));
      },
    };
    return api;
  }

  // A simple non-random unique id counter (deterministic, not part of game RNG)
  let _uid = 0;
  function uid(prefix) {
    _uid += 1;
    return (prefix || "id") + "_" + _uid;
  }

  global.makeRNG = makeRNG;
  global.uid = uid;
})(window);
