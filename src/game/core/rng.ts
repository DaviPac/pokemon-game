/**
 * Gerador pseudoaleatorio com semente (mulberry32). Ter a semente no save deixa
 * as batalhas reproduziveis nos testes e evita depender de Math.random.
 */
export class RNG {
  private state: number;

  constructor(seed: number = Date.now() >>> 0) {
    this.state = seed >>> 0;
  }

  get seed(): number {
    return this.state;
  }

  /** Float em [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [0, max). */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Inteiro em [min, max], inclusivo dos dois lados. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** True com probabilidade `chance` (0..1). */
  chance(chance: number): boolean {
    return this.next() < chance;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Escolhe um item respeitando pesos relativos. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    const total = items.reduce((acc, item) => acc + weightOf(item), 0);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= weightOf(item);
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }
}
