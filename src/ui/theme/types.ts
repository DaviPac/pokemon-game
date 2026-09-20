import type { PokemonType } from '../../game/data/types.js';

/** Cores por tipo, usadas em cards, badges e nas animacoes de golpe. */
export const TYPE_COLORS: Record<PokemonType, string> = {
  Normal: '#9099a1',
  Fire: '#ff6b3d',
  Water: '#3f8fe0',
  Electric: '#f4c430',
  Grass: '#56b04a',
  Ice: '#61d3d3',
  Fighting: '#d3425f',
  Poison: '#a95cc9',
  Ground: '#cfa14c',
  Flying: '#8fa8e6',
  Psychic: '#f5568a',
  Bug: '#9dc130',
  Rock: '#bfa762',
  Ghost: '#6c5aa8',
  Dragon: '#4d6fd1',
  Dark: '#5c5366',
  Steel: '#7fa6b5',
  Fairy: '#ed8ac6',
};

export const TYPE_NAMES_PT: Record<PokemonType, string> = {
  Normal: 'Normal',
  Fire: 'Fogo',
  Water: 'Agua',
  Electric: 'Eletrico',
  Grass: 'Planta',
  Ice: 'Gelo',
  Fighting: 'Lutador',
  Poison: 'Venenoso',
  Ground: 'Terrestre',
  Flying: 'Voador',
  Psychic: 'Psiquico',
  Bug: 'Inseto',
  Rock: 'Pedra',
  Ghost: 'Fantasma',
  Dragon: 'Dragao',
  Dark: 'Sombrio',
  Steel: 'Metalico',
  Fairy: 'Fada',
};

export const STATUS_LABELS: Record<string, string> = {
  brn: 'QUE',
  par: 'PAR',
  slp: 'SON',
  frz: 'CON',
  psn: 'VEN',
  tox: 'VEN',
};

export const STATUS_COLORS: Record<string, string> = {
  brn: '#ff6b3d',
  par: '#f4c430',
  slp: '#9099a1',
  frz: '#61d3d3',
  psn: '#a95cc9',
  tox: '#8b3fb0',
};

export const CATEGORY_LABELS: Record<string, string> = {
  Physical: 'Fisico',
  Special: 'Especial',
  Status: 'Status',
};
