/**
 * Converte os dados de mapa do decomp `pret/pokefirered` para o formato que o
 * jogo consome: atlas de metatiles em PNG + um JSON compacto por mapa.
 *
 * Saida:
 *   public/assets/tilesets/<tileset>.png
 *   public/assets/data/tilesets.json
 *   public/assets/data/world.json
 *   public/assets/data/maps/<MAP_ID>.json
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fetchJson, fetchSource, fetchText, mapLimit } from './lib/net.js';
import {
  METATILES_IN_PRIMARY,
  METATILE_SIZE,
  PALS_IN_PRIMARY,
  parseAttributes,
  parseMetatiles,
  readIndexedPng,
  readJascPalette,
  renderMetatile,
  type IndexedImage,
  type Palette,
  type TileSource,
} from './lib/gba.js';

const OUT_ROOT = join(process.cwd(), 'public', 'assets');
const OUT_TILESETS = join(OUT_ROOT, 'tilesets');
const OUT_DATA = join(OUT_ROOT, 'data');
const OUT_MAPS = join(OUT_DATA, 'maps');

/** Grupos do FireRed que nao entram no jogo (multiplayer por cabo). */
const SKIPPED_GROUPS = new Set(['gMapGroup_Link']);

interface LayoutJson {
  id: string;
  name: string;
  width: number;
  height: number;
  border_width?: number;
  border_height?: number;
  primary_tileset: string;
  secondary_tileset: string | null;
  border_filepath: string;
  blockdata_filepath: string;
}

interface MapJson {
  id: string;
  name: string;
  layout: string;
  region_map_section: string;
  map_type: string;
  weather?: string;
  allow_running?: boolean;
  allow_cycling?: boolean;
  allow_escaping?: boolean;
  floor_number?: number;
  connections?: { map: string; direction: string; offset: number }[] | null;
  warp_events?: {
    x: number;
    y: number;
    elevation: number;
    dest_map: string;
    dest_warp_id: string | number;
  }[];
  object_events?: {
    type?: string;
    graphics_id: string;
    x: number;
    y: number;
    elevation: number;
    movement_type: string;
    movement_range_x: number;
    movement_range_y: number;
    trainer_type: string;
    script: string;
    flag: string;
  }[];
  bg_events?: {
    x: number;
    y: number;
    elevation: number;
    type: string;
    player_facing_dir?: string;
    script?: string;
    item?: string;
  }[];
}

async function main(): Promise<void> {
  await rm(OUT_TILESETS, { recursive: true, force: true });
  await rm(OUT_MAPS, { recursive: true, force: true });
  await mkdir(OUT_TILESETS, { recursive: true });
  await mkdir(OUT_MAPS, { recursive: true });

  const behaviorKinds = await buildBehaviorTable();
  const tilesetDirs = await buildTilesetDirMap();

  const layouts = (await required<{ layouts: LayoutJson[] }>('data/layouts/layouts.json')).layouts.filter(
    (l) => l && l.id,
  );
  const layoutById = new Map(layouts.map((l) => [l.id, l]));

  const groups = await required<Record<string, unknown>>('data/maps/map_groups.json');
  const groupOrder = groups.group_order as string[];
  const mapNames: { name: string; group: string }[] = [];
  for (const group of groupOrder) {
    if (SKIPPED_GROUPS.has(group)) continue;
    for (const name of groups[group] as string[]) mapNames.push({ name, group });
  }
  console.log(`[world] ${mapNames.length} mapas, ${layouts.length} layouts`);

  const maps = await mapLimit(mapNames, 16, async ({ name, group }) => {
    const json = await fetchJson<MapJson>('firered', `data/maps/${name}/map.json`);
    return { name, group, json };
  });

  const usable = maps.filter((m): m is { name: string; group: string; json: MapJson } => m.json !== null);
  const encounters = await buildEncounterTable();

  // Tilesets realmente usados pelos mapas que vamos exportar.
  const usedTilesets = new Map<string, string | null>(); // secundario -> primario que o acompanha
  const usedPrimary = new Set<string>();
  for (const { json } of usable) {
    const layout = layoutById.get(json.layout);
    if (!layout || layout.primary_tileset === 'NULL') continue;
    usedPrimary.add(layout.primary_tileset);
    if (layout.secondary_tileset && layout.secondary_tileset !== 'NULL') {
      usedTilesets.set(layout.secondary_tileset, layout.primary_tileset);
    }
  }

  const tilesetsMeta: Record<string, TilesetMeta> = {};
  for (const label of usedPrimary) {
    tilesetsMeta[label] = await buildTilesetAtlas(label, null, tilesetDirs);
  }
  for (const [label, primary] of usedTilesets) {
    tilesetsMeta[label] = await buildTilesetAtlas(label, primary, tilesetDirs);
  }
  console.log(`[world] ${Object.keys(tilesetsMeta).length} tilesets renderizados`);

  const index: WorldIndexEntry[] = [];
  for (const { name, group, json } of usable) {
    const layout = layoutById.get(json.layout);
    if (!layout || layout.primary_tileset === 'NULL') continue;

    const blocks = await fetchSource('firered', layout.blockdata_filepath);
    if (!blocks) continue;
    const border = layout.border_filepath
      ? await fetchSource('firered', layout.border_filepath)
      : null;

    const total = layout.width * layout.height;
    const metatiles = new Uint16Array(total);
    const collision = new Uint8Array(total);
    const elevation = new Uint8Array(total);
    for (let i = 0; i < total && i * 2 + 1 < blocks.length; i++) {
      const value = blocks.readUInt16LE(i * 2);
      metatiles[i] = value & 0x03ff;
      collision[i] = (value >> 10) & 0x03;
      elevation[i] = (value >> 12) & 0x0f;
    }

    const borderWidth = layout.border_width ?? 2;
    const borderHeight = layout.border_height ?? 2;
    const borderTiles: number[] = [];
    if (border) {
      for (let i = 0; i < borderWidth * borderHeight && i * 2 + 1 < border.length; i++) {
        borderTiles.push(border.readUInt16LE(i * 2) & 0x03ff);
      }
    }

    const mapData = {
      id: json.id,
      name,
      section: json.region_map_section,
      group,
      type: json.map_type,
      width: layout.width,
      height: layout.height,
      primary: layout.primary_tileset,
      secondary: layout.secondary_tileset === 'NULL' ? null : layout.secondary_tileset,
      allowRunning: json.allow_running !== false,
      allowCycling: json.allow_cycling !== false,
      floor: json.floor_number ?? 0,
      weather: json.weather ?? 'WEATHER_NONE',
      metatiles: encodeU16(metatiles),
      collision: encodeU8(collision),
      elevation: encodeU8(elevation),
      border: { width: borderWidth, height: borderHeight, tiles: borderTiles },
      connections: (json.connections ?? []).map((c) => ({
        map: c.map,
        dir: c.direction,
        offset: c.offset,
      })),
      warps: (json.warp_events ?? []).map((w) => ({
        x: w.x,
        y: w.y,
        elevation: w.elevation,
        dest: w.dest_map,
        destWarp: Number(w.dest_warp_id),
      })),
      // "clone" copia um objeto do mapa vizinho (as vezes com coordenada
      // negativa); o mapa dono ja o desenha, entao ignoramos.
      objects: (json.object_events ?? [])
        .filter((o) => (o.type ?? 'object') === 'object')
        .map((o) => ({
          gfx: o.graphics_id,
          x: o.x,
          y: o.y,
          elevation: o.elevation ?? 3,
          movement: o.movement_type ?? 'MOVEMENT_TYPE_NONE',
          rangeX: o.movement_range_x ?? 0,
          rangeY: o.movement_range_y ?? 0,
          trainer: o.trainer_type !== 'TRAINER_TYPE_NONE',
          script: o.script ?? '',
          flag: o.flag ?? '0',
        })),
      signs: (json.bg_events ?? []).map((b) => ({
        x: b.x,
        y: b.y,
        type: b.type,
        script: b.script ?? null,
        item: b.item ?? null,
      })),
      encounters: encounters[json.id] ?? null,
    };

    await writeFile(join(OUT_MAPS, `${json.id}.json`), JSON.stringify(mapData));
    index.push({
      id: json.id,
      name,
      section: json.region_map_section,
      group,
      type: json.map_type,
      width: layout.width,
      height: layout.height,
      hasEncounters: mapData.encounters !== null,
      connections: mapData.connections,
    });
  }

  await writeFile(
    join(OUT_DATA, 'tilesets.json'),
    JSON.stringify({ behaviorKinds, tilesets: tilesetsMeta }),
  );
  await writeFile(
    join(OUT_DATA, 'world.json'),
    JSON.stringify({ region: 'kanto', source: 'pret/pokefirered', maps: index }),
  );
  console.log(`[world] ${index.length} mapas exportados`);
}

interface WorldIndexEntry {
  id: string;
  name: string;
  section: string;
  group: string;
  type: string;
  width: number;
  height: number;
  hasEncounters: boolean;
  connections: { map: string; dir: string; offset: number }[];
}

interface TilesetMeta {
  atlas: string;
  count: number;
  columns: number;
  /** Behavior cru de cada metatile, na ordem do atlas. */
  behaviors: number[];
  /** Indice do primeiro metatile deste tileset no espaco global de ids. */
  firstId: number;
}

const ATLAS_COLUMNS = 16;

async function buildTilesetAtlas(
  label: string,
  pairedPrimary: string | null,
  dirs: Map<string, TilesetPaths>,
): Promise<TilesetMeta> {
  const paths = await resolveTileset(label, dirs);

  const tiles = readIndexedPng(await requiredBuffer(`${paths.graphics}/tiles.png`));
  const metatilesBin = await requiredBuffer(`${paths.metatiles}/metatiles.bin`);
  const metatiles = parseMetatiles(metatilesBin);
  const attrsBin = await requiredBuffer(`${paths.metatiles}/metatile_attributes.bin`);
  const attrs = parseAttributes(attrsBin, metatiles.length);

  let primaryTiles: IndexedImage = tiles;
  let secondaryTiles: IndexedImage | null = null;
  const palettes: Palette[] = [];

  if (pairedPrimary) {
    const primaryPaths = await resolveTileset(pairedPrimary, dirs);
    primaryTiles = readIndexedPng(await requiredBuffer(`${primaryPaths.graphics}/tiles.png`));
    secondaryTiles = tiles;
    for (let i = 0; i < 16; i++) {
      const from = i < PALS_IN_PRIMARY ? primaryPaths.graphics : paths.graphics;
      palettes.push(await loadPalette(from, i));
    }
  } else {
    for (let i = 0; i < 16; i++) palettes.push(await loadPalette(paths.graphics, i));
  }

  const source: TileSource = { primaryTiles, secondaryTiles, palettes };
  const count = metatiles.length;
  const rows = Math.ceil(count / ATLAS_COLUMNS);
  const png = new PNG({
    width: ATLAS_COLUMNS * METATILE_SIZE,
    height: rows * METATILE_SIZE,
    colorType: 6,
  });
  png.data.fill(0);
  const pixels = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);

  for (let i = 0; i < count; i++) {
    const ox = (i % ATLAS_COLUMNS) * METATILE_SIZE;
    const oy = Math.floor(i / ATLAS_COLUMNS) * METATILE_SIZE;
    renderMetatile(metatiles[i], source, pixels, png.width, ox, oy);
  }

  const fileName = `${labelToSlug(label)}.png`;
  await writeFile(join(OUT_TILESETS, fileName), PNG.sync.write(png));

  return {
    atlas: fileName,
    count,
    columns: ATLAS_COLUMNS,
    behaviors: attrs.map((a) => a.behavior),
    firstId: pairedPrimary ? METATILES_IN_PRIMARY : 0,
  };
}

async function loadPalette(dir: string, index: number): Promise<Palette> {
  const name = String(index).padStart(2, '0');
  const text = await fetchText('firered', `${dir}/palettes/${name}.pal`);
  return text ? readJascPalette(text) : new Uint8Array(48);
}

function labelToSlug(label: string): string {
  return label
    .replace(/^gTileset_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

interface TilesetPaths {
  /** Diretorio de onde vem tiles.png e as paletas (pode ser compartilhado). */
  graphics: string;
  /** Diretorio dos metatiles/atributos, sempre o do proprio tileset. */
  metatiles: string;
}

/**
 * headers.h e a fonte autoritativa: diz quais graficos cada tileset usa. Varios
 * tilesets do FireRed compartilham tiles (SilphCo usa os de Condominiums), entao
 * nao da para deduzir o caminho so pelo nome.
 */
async function buildTilesetDirMap(): Promise<Map<string, TilesetPaths>> {
  const graphicsText = await requiredText('src/data/tilesets/graphics.h');
  const graphicsDirs = new Map<string, string>();
  const graphicsRe =
    /gTilesetTiles_(\w+)\[\]\s*=\s*INCBIN_U32\("(data\/tilesets\/[^"]+)\/tiles\.4bpp\.lz"\)/g;
  for (const match of graphicsText.matchAll(graphicsRe)) {
    graphicsDirs.set(match[1], match[2]);
  }

  const headersText = await requiredText('src/data/tilesets/headers.h');
  const map = new Map<string, TilesetPaths>();
  const headerRe = /const struct Tileset gTileset_(\w+)\s*=\s*\{([^}]*)\}/g;
  for (const match of headersText.matchAll(headerRe)) {
    const label = `gTileset_${match[1]}`;
    const body = match[2];
    const tilesLabel = /\.tiles\s*=\s*gTilesetTiles_(\w+)/.exec(body)?.[1];
    const metatilesLabel = /\.metatiles\s*=\s*gMetatiles_(\w+)/.exec(body)?.[1];
    if (!tilesLabel || !metatilesLabel) continue;

    const graphics = graphicsDirs.get(tilesLabel) ?? (await probeDir(tilesLabel));
    const metatiles =
      graphicsDirs.get(metatilesLabel) ?? (await probeDir(metatilesLabel, 'metatiles.bin'));
    if (!graphics || !metatiles) continue;
    map.set(label, { graphics, metatiles });
  }
  return map;
}

/** Quando o header nao revela o diretorio, testamos as convencoes de nome. */
async function probeDir(label: string, probe = 'tiles.png'): Promise<string | null> {
  const base = labelToSlug(`gTileset_${label}`);
  // GenericBuilding1 vira generic_building_1 num diretorio e generic_building1 noutro.
  const slugs = [...new Set([base, base.replace(/([a-z])(\d)/g, '$1_$2')])];
  for (const kind of ['primary', 'secondary']) {
    for (const slug of slugs) {
      const candidate = `data/tilesets/${kind}/${slug}`;
      if (await fetchSource('firered', `${candidate}/${probe}`)) return candidate;
    }
  }
  return null;
}

async function resolveTileset(label: string, dirs: Map<string, TilesetPaths>): Promise<TilesetPaths> {
  const known = dirs.get(label);
  if (known) return known;
  const bare = label.replace(/^gTileset_/, '');
  const graphics = await probeDir(bare);
  const metatiles = await probeDir(bare, 'metatiles.bin');
  if (!graphics || !metatiles) throw new Error(`tileset sem diretorio conhecido: ${label}`);
  const paths = { graphics, metatiles };
  dirs.set(label, paths);
  return paths;
}

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

/**
 * Traduz os ~240 behaviors do FireRed para as poucas categorias que o jogo usa.
 * O runtime so carrega o array resultante (valor -> categoria).
 */
async function buildBehaviorTable(): Promise<BehaviorKind[]> {
  const text = await requiredText('include/constants/metatile_behaviors.h');
  const byValue: BehaviorKind[] = new Array(0x100).fill('normal');
  for (const match of text.matchAll(/#define MB_(\w+)\s+0x([0-9A-Fa-f]+)/g)) {
    const name = match[1];
    const value = Number.parseInt(match[2], 16);
    if (value >= 0x100) continue;
    byValue[value] = classifyBehavior(name);
  }
  return byValue;
}

function classifyBehavior(name: string): BehaviorKind {
  if (name === 'TALL_GRASS' || name === 'CYCLING_ROAD_PULL_DOWN_GRASS') return 'tall_grass';
  if (name === 'LONG_GRASS') return 'long_grass';
  if (name.endsWith('_WATER') || name === 'WATERFALL' || name === 'SEAWEED') {
    return name === 'SHALLOW_WATER' || name === 'PUDDLE' ? 'normal' : 'water';
  }
  if (name === 'JUMP_EAST') return 'ledge_east';
  if (name === 'JUMP_WEST') return 'ledge_west';
  if (name === 'JUMP_NORTH') return 'ledge_north';
  if (name === 'JUMP_SOUTH') return 'ledge_south';
  if (name.startsWith('IMPASSABLE')) return 'blocked';
  if (name.includes('STAIR') || name === 'LADDER' || name.includes('ESCALATOR')) return 'stairs';
  if (name.includes('DOOR')) return 'door';
  if (name.includes('WARP')) return 'warp';
  if (name === 'COUNTER') return 'counter';
  if (name === 'PC' || name === 'COMPUTER') return 'pc';
  if (name === 'CAVE' || name === 'SAND_CAVE') return 'cave';
  if (name === 'SAND') return 'sand';
  if (name === 'ICE' || name === 'THIN_ICE' || name === 'CRACKED_ICE') return 'ice';
  if (name === 'RUNNING_DISALLOWED') return 'no_running';
  if (
    name === 'SIGNPOST' ||
    name === 'BOOKSHELF' ||
    name === 'TELEVISION' ||
    name === 'REGION_MAP' ||
    name.endsWith('_SIGN') ||
    name.endsWith('_SIGN_1') ||
    name.endsWith('_SIGN_2')
  ) {
    return 'sign';
  }
  return 'normal';
}

/** Tabela de encontros selvagens indexada pelo constante do mapa. */
async function buildEncounterTable(): Promise<Record<string, MapEncounters>> {
  interface Slot {
    min_level: number;
    max_level: number;
    species: string;
  }
  interface Header {
    map: string;
    base_label?: string;
    land_mons?: { encounter_rate: number; mons: Slot[] };
    water_mons?: { encounter_rate: number; mons: Slot[] };
    rock_smash_mons?: { encounter_rate: number; mons: Slot[] };
    fishing_mons?: { encounter_rate: number; mons: Slot[] };
  }
  interface Group {
    label: string;
    for_maps: boolean;
    fields: { type: string; encounter_rates: number[]; groups?: Record<string, number[]> }[];
    encounters: Header[];
  }

  const file = await required<{ wild_encounter_groups: Group[] }>('src/data/wild_encounters.json');
  const group = file.wild_encounter_groups.find((g) => g.for_maps);
  if (!group) return {};

  const ratesByType = new Map(group.fields.map((f) => [f.type, f.encounter_rates]));
  const fishingGroups = group.fields.find((f) => f.type === 'fishing_mons')?.groups ?? {};

  const out: Record<string, MapEncounters> = {};
  for (const header of group.encounters) {
    // Cada mapa pode ter varias entradas (versoes FR/LG); a primeira basta.
    if (out[header.map]) continue;
    const entry: MapEncounters = {};
    if (header.land_mons) {
      entry.land = {
        rate: header.land_mons.encounter_rate,
        slots: header.land_mons.mons.map((m, i) => ({
          species: m.species,
          min: m.min_level,
          max: m.max_level,
          weight: ratesByType.get('land_mons')?.[i] ?? 1,
        })),
      };
    }
    if (header.water_mons) {
      entry.water = {
        rate: header.water_mons.encounter_rate,
        slots: header.water_mons.mons.map((m, i) => ({
          species: m.species,
          min: m.min_level,
          max: m.max_level,
          weight: ratesByType.get('water_mons')?.[i] ?? 1,
        })),
      };
    }
    if (header.fishing_mons) {
      const rods: MapEncounters['fishing'] = {};
      for (const [rod, indices] of Object.entries(fishingGroups)) {
        rods[rod] = indices
          .map((i) => header.fishing_mons!.mons[i])
          .filter(Boolean)
          .map((m) => ({ species: m.species, min: m.min_level, max: m.max_level, weight: 1 }));
      }
      entry.fishing = rods;
    }
    if (header.rock_smash_mons) {
      entry.rockSmash = {
        rate: header.rock_smash_mons.encounter_rate,
        slots: header.rock_smash_mons.mons.map((m) => ({
          species: m.species,
          min: m.min_level,
          max: m.max_level,
          weight: 1,
        })),
      };
    }
    out[header.map] = entry;
  }
  return out;
}

interface EncounterSlot {
  species: string;
  min: number;
  max: number;
  weight: number;
}
interface EncounterTable {
  rate: number;
  slots: EncounterSlot[];
}
interface MapEncounters {
  land?: EncounterTable;
  water?: EncounterTable;
  rockSmash?: EncounterTable;
  fishing?: Record<string, EncounterSlot[]>;
}

function encodeU16(data: Uint16Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
}
function encodeU8(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

async function required<T>(path: string): Promise<T> {
  const json = await fetchJson<T>('firered', path);
  if (!json) throw new Error(`arquivo obrigatorio nao encontrado: ${path}`);
  return json;
}
async function requiredText(path: string): Promise<string> {
  const text = await fetchText('firered', path);
  if (!text) throw new Error(`arquivo obrigatorio nao encontrado: ${path}`);
  return text;
}
async function requiredBuffer(path: string): Promise<Buffer> {
  const buf = await fetchSource('firered', path);
  if (!buf) throw new Error(`arquivo obrigatorio nao encontrado: ${path}`);
  return buf;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
