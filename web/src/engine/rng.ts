// Seeded PRNG: xoshiro128** seeded through splitmix32. Every random thing in the game draws
// from an Rng, so a seed reproduces a whole session. `fork(name)` gives an independent stream
// (deck, bots, flavor, world), so drawing more flavor text never changes the cards.

function splitmix32(a: number) {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a over a string, for turning names and seed phrases into 32-bit seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class Rng {
  private s = new Uint32Array(4);

  constructor(readonly seed: number | string = (Math.random() * 2 ** 32) >>> 0) {
    const sm = splitmix32(typeof seed === "string" ? hashString(seed) : seed >>> 0);
    for (let i = 0; i < 4; i++) this.s[i] = sm();
  }

  /** Uniform 32-bit unsigned integer. */
  next(): number {
    const s = this.s;
    const r = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return r;
  }

  /** Uniform float in [0, 1) with 53 bits of precision. */
  random(): number {
    return ((this.next() >>> 5) * 67108864 + (this.next() >>> 6)) / 9007199254740992;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.random() * n);
  }

  /** Uniform integer in [lo, hi], inclusive like Python's randint. */
  randint(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = xs[i]; xs[i] = xs[j]; xs[j] = t;
    }
    return xs;
  }

  /** k distinct elements, like Python's random.sample. */
  sample<T>(xs: readonly T[], k: number): T[] {
    const pool = xs.slice();
    for (let i = 0; i < k; i++) {
      const j = i + this.int(pool.length - i);
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, k);
  }

  /** An independent stream derived from this one's seed and a name. */
  fork(name: string): Rng {
    return new Rng(hashString(`${this.seed}/${name}`));
  }

  /** Snapshot and restore, for saving mid-session. */
  state(): number[] {
    return Array.from(this.s);
  }

  restore(state: readonly number[]): this {
    this.s.set(state);
    return this;
  }
}

function rotl(x: number, k: number) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
