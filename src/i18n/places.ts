/**
 * Nomes de lugar em pt-BR. Cidades e rotas de Kanto sao nomes proprios e ficam
 * como no jogo oficial; o que e generico (rota, caverna, ginasio) e traduzido.
 */
import type { GameMap } from '../game/data/types.js';

const SECTION_OVERRIDES: Record<string, string> = {
  MAPSEC_PALLET_TOWN: 'Pallet Town',
  MAPSEC_VIRIDIAN_CITY: 'Viridian City',
  MAPSEC_PEWTER_CITY: 'Pewter City',
  MAPSEC_CERULEAN_CITY: 'Cerulean City',
  MAPSEC_LAVENDER_TOWN: 'Lavender Town',
  MAPSEC_VERMILION_CITY: 'Vermilion City',
  MAPSEC_CELADON_CITY: 'Celadon City',
  MAPSEC_FUCHSIA_CITY: 'Fuchsia City',
  MAPSEC_CINNABAR_ISLAND: 'Cinnabar Island',
  MAPSEC_INDIGO_PLATEAU: 'Planalto Indigo',
  MAPSEC_SAFFRON_CITY: 'Saffron City',
  MAPSEC_VIRIDIAN_FOREST: 'Floresta de Viridian',
  MAPSEC_MT_MOON: 'Monte Moon',
  MAPSEC_ROCK_TUNNEL: 'Tunel de Rocha',
  MAPSEC_POWER_PLANT: 'Usina Abandonada',
  MAPSEC_SEAFOAM_ISLANDS: 'Ilhas Seafoam',
  MAPSEC_POKEMON_TOWER: 'Torre Pokemon',
  MAPSEC_POKEMON_MANSION: 'Mansao Pokemon',
  MAPSEC_SAFARI_ZONE: 'Zona Safari',
  MAPSEC_VICTORY_ROAD: 'Estrada da Vitoria',
  MAPSEC_DIGLETTS_CAVE: 'Caverna dos Diglett',
  MAPSEC_CERULEAN_CAVE: 'Caverna de Cerulean',
  MAPSEC_UNDERGROUND_PATH: 'Passagem Subterranea',
  MAPSEC_SS_ANNE: 'S.S. Anne',
  MAPSEC_BERRY_FOREST: 'Floresta das Berries',
  MAPSEC_MT_EMBER: 'Monte Ember',
  MAPSEC_NAVEL_ROCK: 'Rocha Navel',
  MAPSEC_BIRTH_ISLAND: 'Ilha do Nascimento',
  MAPSEC_ONE_ISLAND: 'Ilha Um',
  MAPSEC_TWO_ISLAND: 'Ilha Dois',
  MAPSEC_THREE_ISLAND: 'Ilha Tres',
  MAPSEC_FOUR_ISLAND: 'Ilha Quatro',
  MAPSEC_FIVE_ISLAND: 'Ilha Cinco',
  MAPSEC_SIX_ISLAND: 'Ilha Seis',
  MAPSEC_SEVEN_ISLAND: 'Ilha Sete',
};

/** Termos genericos que aparecem no nome interno dos mapas. */
const INTERIOR_TERMS: [RegExp, string][] = [
  [/PokemonCenter/i, 'Centro Pokemon'],
  [/Mart\b/i, 'Loja Pokemon'],
  [/Gym\b/i, 'Ginasio'],
  [/GameCorner/i, 'Cassino'],
  [/Lab\b/i, 'Laboratorio'],
  [/Museum/i, 'Museu'],
  [/House/i, 'Casa'],
  [/Hotel/i, 'Hotel'],
  [/Dojo/i, 'Dojo'],
  [/BikeShop/i, 'Loja de Bicicletas'],
  [/DepartmentStore/i, 'Shopping'],
  [/Condominiums?/i, 'Condominio'],
  [/Cafe/i, 'Cafe'],
  [/Daycare/i, 'Creche Pokemon'],
];

export function sectionName(section: string): string {
  const override = SECTION_OVERRIDES[section];
  if (override) return override;
  const bare = section.replace(/^MAPSEC_/, '');
  const route = /^ROUTE_?(\d+)/.exec(bare);
  if (route) return `Rota ${Number(route[1])}`;
  return titleCase(bare.replace(/_/g, ' '));
}

export function mapDisplayName(map: GameMap): string {
  const place = sectionName(map.section);
  if (map.type === 'MAP_TYPE_TOWN' || map.type === 'MAP_TYPE_CITY' || map.type === 'MAP_TYPE_ROUTE') {
    return place;
  }
  for (const [pattern, label] of INTERIOR_TERMS) {
    if (pattern.test(map.name)) {
      const floor = /_(\d+)F$/.exec(map.name)?.[1];
      const basement = /_B(\d+)F$/.exec(map.name)?.[1];
      const suffix = basement ? ` · Subsolo ${basement}` : floor && floor !== '1' ? ` · ${floor}º andar` : '';
      return `${label}${suffix}`;
    }
  }
  return place;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
