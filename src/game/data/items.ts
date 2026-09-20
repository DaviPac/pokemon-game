/**
 * Catalogo de itens: nome em pt-BR, descricao, preco e onde cada um serve.
 * As bolas e os remedios de batalha vem dos modulos que ja os implementam.
 */
import { BALLS } from '../battle/capture.js';
import { BATTLE_ITEMS } from '../battle/engine.js';

export type ItemCategory = 'ball' | 'medicine' | 'other';

export interface ItemInfo {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  /** Preco de venda na loja; 0 quando nao se compra. */
  price: number;
  usableInBattle: boolean;
  usableOnParty: boolean;
}

const MEDICINE: Record<string, { name: string; description: string; price: number; party: boolean }> = {
  potion: { name: 'Potion', description: 'Recupera 20 de HP.', price: 200, party: true },
  superpotion: { name: 'Super Potion', description: 'Recupera 60 de HP.', price: 700, party: true },
  hyperpotion: { name: 'Hyper Potion', description: 'Recupera 120 de HP.', price: 1500, party: true },
  maxpotion: { name: 'Max Potion', description: 'Recupera todo o HP.', price: 2500, party: true },
  fullheal: { name: 'Full Heal', description: 'Cura qualquer condicao.', price: 600, party: true },
  antidote: { name: 'Antidote', description: 'Cura envenenamento.', price: 100, party: true },
  awakening: { name: 'Awakening', description: 'Acorda um Pokemon.', price: 250, party: true },
  paralyzeheal: { name: 'Paralyze Heal', description: 'Cura paralisia.', price: 200, party: true },
  revive: { name: 'Revive', description: 'Revive com metade do HP.', price: 1500, party: true },
};

export const ITEMS: Record<string, ItemInfo> = buildCatalog();

function buildCatalog(): Record<string, ItemInfo> {
  const catalog: Record<string, ItemInfo> = {};

  for (const ball of Object.values(BALLS)) {
    catalog[ball.id] = {
      id: ball.id,
      name: ball.name,
      description: ball.description,
      category: 'ball',
      price: ball.price,
      usableInBattle: true,
      usableOnParty: false,
    };
  }

  for (const [id, data] of Object.entries(MEDICINE)) {
    catalog[id] = {
      id,
      name: data.name,
      description: data.description,
      category: 'medicine',
      price: data.price,
      usableInBattle: id in BATTLE_ITEMS,
      usableOnParty: data.party,
    };
  }

  return catalog;
}

export function itemInfo(id: string): ItemInfo {
  return (
    ITEMS[id] ?? {
      id,
      name: id,
      description: '',
      category: 'other',
      price: 0,
      usableInBattle: false,
      usableOnParty: false,
    }
  );
}

/** O que cada Loja Pokemon vende; melhora conforme voce ganha insignias. */
export function shopStock(badges: number): string[] {
  const stock = ['pokeball', 'potion', 'antidote', 'paralyzeheal', 'awakening'];
  if (badges >= 1) stock.push('greatball', 'superpotion');
  if (badges >= 3) stock.push('revive', 'fullheal');
  if (badges >= 5) stock.push('ultraball', 'hyperpotion');
  if (badges >= 7) stock.push('maxpotion');
  return stock;
}
