/**
 * Itens que funcionam dentro da batalha. Ficam fora do motor para que a
 * mochila e a loja possam consulta-los sem carregar o simulador inteiro.
 */
import type { StatusName } from '../data/types.js';

export interface BattleItemUse {
  /** Cura fixa de HP. */
  heal?: number;
  /** Remove status; 'all' limpa qualquer um. */
  cure?: StatusName | 'all';
  /** Revive com metade do HP. */
  revive?: boolean;
  ball?: string;
}

export const BATTLE_ITEMS: Record<string, BattleItemUse & { name: string }> = {
  potion: { name: 'Potion', heal: 20 },
  superpotion: { name: 'Super Potion', heal: 60 },
  hyperpotion: { name: 'Hyper Potion', heal: 120 },
  maxpotion: { name: 'Max Potion', heal: 9999 },
  fullheal: { name: 'Full Heal', cure: 'all' },
  antidote: { name: 'Antidote', cure: 'psn' },
  awakening: { name: 'Awakening', cure: 'slp' },
  paralyzeheal: { name: 'Paralyze Heal', cure: 'par' },
  revive: { name: 'Revive', revive: true },
};
