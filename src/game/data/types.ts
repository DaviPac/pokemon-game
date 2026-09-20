/** Tipos dos dados gerados por `npm run assets`. */

export type BehaviorKind =
  | 'normal'
  | 'tall_grass'
  | 'long_grass'
  | 'water'
  | 'surfable'
  | 'ledge_east'
  | 'ledge_west'
  | 'ledge_north'
  | 'ledge_south'
  | 'blocked'
  | 'warp'
  | 'door'
  | 'stairs'
  | 'counter'
  | 'sign'
  | 'pc'
  | 'cave'
  | 'sand'
  | 'ice'
  | 'no_running';

export interface TilesetMeta {
  atlas: string;
  count: number;
  columns: number;
  behaviors: number[];
  firstId: number;
}

export interface TilesetsFile {
  behaviorKinds: BehaviorKind[];
  tilesets: Record<string, TilesetMeta>;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface MapConnection {
  map: string;
  dir: string;
  offset: number;
}

export interface MapWarp {
  x: number;
  y: number;
  elevation: number;
  dest: string;
  destWarp: number;
}

export interface MapObject {
  gfx: string;
  x: number;
  y: number;
  elevation: number;
  movement: string;
  rangeX: number;
  rangeY: number;
  trainer: boolean;
  script: string;
  flag: string;
}

export interface MapSign {
  x: number;
  y: number;
  type: string;
  script: string | null;
  item: string | null;
}

export interface EncounterSlot {
  species: string;
  min: number;
  max: number;
  weight: number;
}

export interface EncounterTable {
  rate: number;
  slots: EncounterSlot[];
}

export interface MapEncounters {
  land?: EncounterTable;
  water?: EncounterTable;
  rockSmash?: EncounterTable;
  fishing?: Record<string, EncounterSlot[]>;
}

export interface RawMapData {
  id: string;
  name: string;
  section: string;
  group: string;
  type: string;
  width: number;
  height: number;
  primary: string;
  secondary: string | null;
  allowRunning: boolean;
  allowCycling: boolean;
  floor: number;
  weather: string;
  metatiles: string;
  collision: string;
  elevation: string;
  border: { width: number; height: number; tiles: number[] };
  connections: MapConnection[];
  warps: MapWarp[];
  objects: MapObject[];
  signs: MapSign[];
  encounters: MapEncounters | null;
}

/** Mapa ja decodificado, pronto para o renderer e a colisao. */
export interface GameMap extends Omit<RawMapData, 'metatiles' | 'collision' | 'elevation'> {
  metatiles: Uint16Array;
  collision: Uint8Array;
  elevationData: Uint8Array;
}

export interface WorldIndexEntry {
  id: string;
  name: string;
  section: string;
  group: string;
  type: string;
  width: number;
  height: number;
  hasEncounters: boolean;
  connections: MapConnection[];
}

export interface WorldIndex {
  region: string;
  source: string;
  maps: WorldIndexEntry[];
}

export interface OverworldSpriteMeta {
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  inanimate: boolean;
  /** Folha de corrida, quando o personagem tem uma: 9 quadros, como a de andar. */
  run?: string;
}

// --- Pokemon --------------------------------------------------------------

export type StatName = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export const STATS: StatName[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export type PokemonType =
  | 'Normal'
  | 'Fire'
  | 'Water'
  | 'Electric'
  | 'Grass'
  | 'Ice'
  | 'Fighting'
  | 'Poison'
  | 'Ground'
  | 'Flying'
  | 'Psychic'
  | 'Bug'
  | 'Rock'
  | 'Ghost'
  | 'Dragon'
  | 'Dark'
  | 'Steel'
  | 'Fairy';

export type GrowthRate = 'slow' | 'medium' | 'fast' | 'medium-slow' | 'erratic' | 'fluctuating';

export interface Evolution {
  to: number;
  kind: string;
  level: number | null;
  item: string | null;
  condition: string | null;
}

export interface SpeciesData {
  n: string;
  t: PokemonType[];
  bs: [number, number, number, number, number, number];
  ab: string[];
  hidden: string | null;
  eg: string[];
  gr: number;
  w: number;
  h: number;
  catch: number;
  baseExp: number;
  growth: GrowthRate;
  ev: number[];
  hatch: number;
  friendship: number;
  evos: Evolution[];
  prevo: number | null;
  legendary: boolean;
  mythical: boolean;
}

export type MoveCategory = 'Physical' | 'Special' | 'Status';
export type StatusName = 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';

export interface BoostTable {
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
  accuracy?: number;
  evasion?: number;
}

export interface SecondaryEffect {
  chance: number;
  status: StatusName | null;
  volatile: string | null;
  boosts: BoostTable | null;
  self: BoostTable | null;
}

export interface MoveData {
  n: string;
  t: PokemonType;
  cat: MoveCategory;
  bp: number;
  acc: number | null;
  pp: number;
  pri: number;
  target: string;
  contact: boolean;
  protect: boolean;
  sound: boolean;
  punch: boolean;
  crit: number;
  multihit: number | [number, number] | null;
  drain: [number, number] | null;
  recoil: [number, number] | null;
  heal: [number, number] | null;
  status: StatusName | null;
  volatile: string | null;
  boosts: BoostTable | null;
  self: { boosts: BoostTable } | null;
  secondary: SecondaryEffect | null;
  ohko: boolean;
  forceSwitch: boolean;
  selfSwitch: string | boolean | null;
  selfdestruct: string | null;
  breaksProtect: boolean;
  thaws: boolean;
  willCrit: boolean;
  ignoreImmunity: boolean;
  desc: string;
}

export type SpeciesFile = Record<string, SpeciesData>;
export type MovesFile = Record<string, MoveData>;
export type LearnsetsFile = Record<string, [number, string][]>;
export type TypeChart = Record<PokemonType, Record<PokemonType, number>>;
export type NaturesFile = Record<string, { plus: StatName | null; minus: StatName | null }>;
