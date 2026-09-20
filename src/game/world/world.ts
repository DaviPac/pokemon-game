/**
 * O mundo carregado: o mapa atual mais os vizinhos conectados, num unico
 * sistema de coordenadas. Como no jogo original, atravessar a borda de uma rota
 * nao e uma tela de carregamento -- o mapa vizinho ja esta desenhado do lado.
 */
import { loadMap, loadTilesets } from '../data/assets.js';
import type {
  BehaviorKind,
  Direction,
  GameMap,
  MapObject,
  MapWarp,
  TilesetsFile,
} from '../data/types.js';

export const TILE = 16;

export interface Neighbour {
  map: GameMap;
  /** Deslocamento em tiles do mapa vizinho em relacao ao mapa atual. */
  offsetX: number;
  offsetY: number;
}

export interface TileInfo {
  /** Mapa dono do tile e coordenadas locais nele. */
  map: GameMap;
  localX: number;
  localY: number;
  metatile: number;
  collision: number;
  elevation: number;
  behavior: BehaviorKind;
  /** True quando o tile esta na borda infinita, fora de qualquer mapa. */
  isBorder: boolean;
}

export class World {
  readonly map: GameMap;
  readonly neighbours: Neighbour[];
  private readonly tilesets: TilesetsFile;

  constructor(map: GameMap, neighbours: Neighbour[], tilesets: TilesetsFile) {
    this.map = map;
    this.neighbours = neighbours;
    this.tilesets = tilesets;
  }

  static async load(mapId: string): Promise<World> {
    const [map, tilesets] = await Promise.all([loadMap(mapId), loadTilesets()]);
    const neighbours: Neighbour[] = [];
    await Promise.all(
      map.connections.map(async (conn) => {
        if (conn.dir !== 'up' && conn.dir !== 'down' && conn.dir !== 'left' && conn.dir !== 'right') {
          return;
        }
        try {
          const other = await loadMap(conn.map);
          neighbours.push({ map: other, ...connectionOffset(map, other, conn.dir, conn.offset) });
        } catch {
          // Alguns destinos (dive, emerge) nao existem em Kanto; ignoramos.
        }
      }),
    );
    return new World(map, neighbours, tilesets);
  }

  /** Categoria de comportamento de um metatile (grama alta, agua, porta...). */
  behaviorOf(map: GameMap, metatile: number): BehaviorKind {
    const fromSecondary = metatile >= 640;
    const label = fromSecondary ? map.secondary : map.primary;
    if (!label) return 'normal';
    const meta = this.tilesets.tilesets[label];
    if (!meta) return 'normal';
    const local = fromSecondary ? metatile - 640 : metatile;
    const raw = meta.behaviors[local] ?? 0;
    return this.tilesets.behaviorKinds[raw] ?? 'normal';
  }

  tilesetMetaFor(map: GameMap, metatile: number) {
    const fromSecondary = metatile >= 640;
    const label = fromSecondary ? map.secondary : map.primary;
    return label ? this.tilesets.tilesets[label] : undefined;
  }

  metaByLabel(label: string) {
    return this.tilesets.tilesets[label];
  }

  /** Le um tile em coordenadas do mapa atual, atravessando para os vizinhos. */
  tileAt(x: number, y: number): TileInfo {
    const source = this.resolve(x, y);
    if (source) {
      const { map, localX, localY } = source;
      const index = localY * map.width + localX;
      const metatile = map.metatiles[index];
      return {
        map,
        localX,
        localY,
        metatile,
        collision: map.collision[index],
        elevation: map.elevationData[index],
        behavior: this.behaviorOf(map, metatile),
        isBorder: false,
      };
    }

    // Fora de tudo: repetimos o padrao de borda do mapa atual.
    const border = this.map.border;
    const tiles = border.tiles;
    const metatile =
      tiles.length > 0
        ? tiles[
            (mod(y, border.height) * border.width + mod(x, border.width)) % tiles.length
          ]
        : 0;
    return {
      map: this.map,
      localX: x,
      localY: y,
      metatile,
      collision: 1,
      elevation: 0,
      behavior: this.behaviorOf(this.map, metatile),
      isBorder: true,
    };
  }

  /** Encontra o mapa (atual ou vizinho) que contem a coordenada. */
  resolve(x: number, y: number): { map: GameMap; localX: number; localY: number } | null {
    if (x >= 0 && y >= 0 && x < this.map.width && y < this.map.height) {
      return { map: this.map, localX: x, localY: y };
    }
    for (const n of this.neighbours) {
      const lx = x - n.offsetX;
      const ly = y - n.offsetY;
      if (lx >= 0 && ly >= 0 && lx < n.map.width && ly < n.map.height) {
        return { map: n.map, localX: lx, localY: ly };
      }
    }
    return null;
  }

  /** Vizinho cujo territorio contem a coordenada, se houver. */
  neighbourAt(x: number, y: number): Neighbour | null {
    for (const n of this.neighbours) {
      const lx = x - n.offsetX;
      const ly = y - n.offsetY;
      if (lx >= 0 && ly >= 0 && lx < n.map.width && ly < n.map.height) return n;
    }
    return null;
  }

  warpAt(x: number, y: number): { warp: MapWarp; map: GameMap } | null {
    const source = this.resolve(x, y);
    if (!source) return null;
    const warp = source.map.warps.find((w) => w.x === source.localX && w.y === source.localY);
    return warp ? { warp, map: source.map } : null;
  }

  objectsOf(map: GameMap): MapObject[] {
    return map.objects;
  }
}

export function connectionOffset(
  map: GameMap,
  other: GameMap,
  dir: Direction,
  offset: number,
): { offsetX: number; offsetY: number } {
  switch (dir) {
    case 'up':
      return { offsetX: offset, offsetY: -other.height };
    case 'down':
      return { offsetX: offset, offsetY: map.height };
    case 'left':
      return { offsetX: -other.width, offsetY: offset };
    case 'right':
      return { offsetX: map.width, offsetY: offset };
  }
}

export function directionDelta(dir: Direction): { dx: number; dy: number } {
  switch (dir) {
    case 'up':
      return { dx: 0, dy: -1 };
    case 'down':
      return { dx: 0, dy: 1 };
    case 'left':
      return { dx: -1, dy: 0 };
    case 'right':
      return { dx: 1, dy: 0 };
  }
}

/** Ledges so deixam passar quem vem na direcao certa, e sempre com um pulo. */
export function ledgeDirection(behavior: BehaviorKind): Direction | null {
  switch (behavior) {
    case 'ledge_east':
      return 'right';
    case 'ledge_west':
      return 'left';
    case 'ledge_north':
      return 'up';
    case 'ledge_south':
      return 'down';
    default:
      return null;
  }
}

export function isGrass(behavior: BehaviorKind): boolean {
  return behavior === 'tall_grass' || behavior === 'long_grass';
}

export function isWater(behavior: BehaviorKind): boolean {
  return behavior === 'water' || behavior === 'surfable';
}

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}
